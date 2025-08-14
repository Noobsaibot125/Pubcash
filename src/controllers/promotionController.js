// pubcash-api/src/controllers/promotionController.js
const pool = require('../config/db');

exports.getPromotionsForUser = async (req, res) => {
    const userId = req.user.id;
    const userCommune = req.user.commune_choisie;
    const filter = req.query.filter || 'ma_commune';

    try {
        // Récupérer l'âge de l'utilisateur
        const [userData] = await pool.execute(
            'SELECT date_naissance FROM utilisateurs WHERE id = ?',
            [userId]
        );
        const user = userData[0];
        
        if (!user) {
            return res.status(404).json({ message: 'Utilisateur non trouvé.' });
        }
        
        // Calculer l'âge
        const birthDate = new Date(user.date_naissance);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        // Construire l'URL de base
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        
        // Construire la requête SQL avec les conditions de tranche d'âge et de filtre
        let query = `
            SELECT p.*, c.commune 
            FROM promotions p
            JOIN clients c ON p.id_client = c.id
            WHERE p.statut = 'en_cours' 
            AND p.budget_restant > 0
            AND (
                p.tranche_age = 'tous'
                OR (p.tranche_age = '12-17' AND ? BETWEEN 12 AND 17)
                OR (p.tranche_age = '18+' AND ? >= 18)
            )
        `;

        let params = [age, age];

        // Condition sur la commune en fonction du ciblage
        query += `
            AND (
                (p.ciblage_commune = 'toutes')
                OR 
                (p.ciblage_commune = 'ma_commune' AND c.commune = ?)
            )
        `;
        params.push(userCommune);

        // Condition supplémentaire pour le filtre
        if (filter === 'ma_commune') {
            query += ` AND c.commune = ? `;
            params.push(userCommune);
        }

        query += `
            AND NOT EXISTS (
                SELECT 1 FROM interactions i
                WHERE i.id_utilisateur = ? AND i.id_promotion = p.id AND i.type_interaction = 'like'
            )
            AND NOT EXISTS (
                SELECT 1 FROM interactions i
                WHERE i.id_utilisateur = ? AND i.id_promotion = p.id AND i.type_interaction = 'partage'
            )
            ORDER BY p.date_creation DESC
        `;

        params.push(userId, userId);

        const [promotions] = await pool.execute(query, params);
        
        // Construire les URLs complètes pour les vidéos et thumbnails
        const promotionsWithUrls = promotions.map(promo => ({
            ...promo,
            url_video: promo.url_video 
                ? `${baseUrl}/uploads/videos/${promo.url_video}`
                : null,
            thumbnail_url: promo.thumbnail_url 
                ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}`
                : null
        }));
        
        res.status(200).json(promotionsWithUrls);
    } catch (error) {
        console.error("Erreur getPromotionsForUser:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
const handleInteraction = async (req, res, interactionType) => {
    const { promotionId } = req.params;
    const userId = req.user.id;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Vérifier si CETTE interaction spécifique (like ou partage) a déjà été faite
        const [existing] = await connection.execute(
            'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
            [userId, promotionId, interactionType]
        );
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(200).json({ message: `Interaction '${interactionType}' déjà enregistrée.` });
        }

        // 2. Si elle n'existe pas, on l'enregistre
        await connection.execute(
            'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
            [userId, promotionId, interactionType]
        );
        // On met à jour le compteur de likes ou de partages sur la promotion
        const columnName = interactionType === 'partage' ? 'partages' : 'likes';
        await connection.execute(`UPDATE promotions SET ${columnName} = ${columnName} + 1 WHERE id = ?`, [promotionId]);
        
        // 3. On vérifie maintenant si l'utilisateur a fait les DEUX interactions
        const [interactions] = await connection.execute(
            'SELECT COUNT(DISTINCT type_interaction) as count FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction IN (?, ?)',
            [userId, promotionId, 'like', 'partage']
        );
        
        // 4. Si le compte est à 2 (like + partage), on déclenche la logique de la "vue"
        if (interactions[0].count === 2) {
            
            // On s'assure qu'on n'a pas déjà compté une "vue" pour cet utilisateur
            const [existingView] = await connection.execute(
                'SELECT id FROM interactions WHERE id_utilisateur=? AND id_promotion=? AND type_interaction=?', 
                [userId, promotionId, 'vue']
            );
            
            if (existingView.length === 0) {
                // On récupère les infos nécessaires pour le calcul du budget
                const [promoRows] = await connection.execute(
                    `SELECT p.budget_restant, p.vues_potentielles, p.vues, pk.remuneration 
                     FROM promotions p 
                     JOIN packs pk ON p.id_pack = pk.id 
                     WHERE p.id = ? AND p.statut = 'en_cours' FOR UPDATE`,
                    [promotionId]
                );
                const promotion = promoRows[0];

                // On procède uniquement si la promotion existe et a assez de budget
                if (promotion && promotion.budget_restant >= promotion.remuneration) {
                    await connection.execute(
                        'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
                        [userId, promotionId, 'vue']
                    );
                    
                    const newVues = promotion.vues + 1;
                    const newBudget = promotion.budget_restant - promotion.remuneration;
                    
                    await connection.execute(
                        'UPDATE promotions SET vues = ?, budget_restant = ? WHERE id = ?',
                        [newVues, newBudget, promotionId]
                    );

                    // LOGIQUE MODIFIÉE : Terminer la campagne si les vues atteignent les vues potentielles
                    if (newVues >= promotion.vues_potentielles) {
                        await connection.execute(
                            'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
                            ['termine', promotionId]
                        );
                    }
                    // Si le budget devient insuffisant après cette vue
                    else if (newBudget < promotion.remuneration) {
                        await connection.execute(
                            'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
                            ['termine', promotionId]
                        );
                    }
                }
            }
        }

        await connection.commit();
        res.status(200).json({ message: `Interaction '${interactionType}' enregistrée !` });
    } catch (error) {
        await connection.rollback();
        console.error(`Erreur handleInteraction (${interactionType}):`, error);
        res.status(500).json({ message: 'Erreur serveur' });
    } finally {
        connection.release();
    }
};

exports.likePromotion = (req, res) => handleInteraction(req, res, 'like');
exports.sharePromotion = (req, res) => handleInteraction(req, res, 'partage');

exports.addComment = async (req, res) => {
    const { promotionId } = req.params;
    const userId = req.user.id;
    const { commentaire } = req.body;

    if (!commentaire || commentaire.trim() === '') {
        return res.status(400).json({ message: 'Le commentaire ne peut pas être vide.' });
    }
    try {
        await pool.execute(
            'INSERT INTO commentaires (id_utilisateur, id_promotion, commentaire) VALUES (?, ?, ?)',
            [userId, promotionId, commentaire]
        );
        res.status(201).json({ message: 'Commentaire ajouté.' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
// --- NOUVELLE FONCTION CRUCIALE POUR LES VUES ET LE BUDGET ---
exports.viewPromotion = async (req, res) => {
    const { promotionId } = req.params;
    const userId = req.user.id;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Vérifier si une 'vue' a déjà été enregistrée pour cet utilisateur et cette promo
        const [existing] = await connection.execute(
            'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
            [userId, promotionId, 'vue']
        );
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(200).json({ message: 'Vue déjà comptabilisée.' });
        }

        // 2. Récupérer les infos de la promotion et du pack associé
        const [promoRows] = await connection.execute(
            `SELECT p.budget_restant, p.vues, p.vues_potentielles, pk.remuneration 
             FROM promotions p 
             JOIN packs pk ON p.id_pack = pk.id 
             WHERE p.id = ? FOR UPDATE`,
            [promotionId]
        );
        const promotion = promoRows[0];
        if (!promotion) throw new Error('Promotion non trouvée.');

        // 3. Vérifier si le budget restant est suffisant pour une vue
        if (promotion.budget_restant < promotion.remuneration) {
            // LOGIQUE MODIFIÉE : Mettre à jour la date de fin lors de la terminaison
            await connection.execute(
                'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?', 
                ['termine', promotionId]
            );
            await connection.commit();
            return res.status(400).json({ message: 'Budget de la promotion épuisé.' });
        }

        // 4. Enregistrer la vue dans la table des interactions
        await connection.execute(
            'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
            [userId, promotionId, 'vue']
        );

        // 5. Mettre à jour les compteurs et le budget
        const newVues = promotion.vues + 1;
        const newBudget = promotion.budget_restant - promotion.remuneration;
        
        await connection.execute(
            'UPDATE promotions SET vues = ?, budget_restant = ? WHERE id = ?',
            [newVues, newBudget, promotionId]
        );
        
        // 6. LOGIQUE MODIFIÉE : Vérifier si la campagne doit se terminer
        if (newVues >= promotion.vues_potentielles || newBudget < promotion.remuneration) {
            await connection.execute(
                'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?', 
                ['termine', promotionId]
            );
        }

        await connection.commit();
        res.status(200).json({ message: 'Vue comptabilisée et budget déduit.' });

    } catch (error) {
        await connection.rollback();
        console.error("Erreur viewPromotion:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    } finally {
        connection.release();
    }
};
// Récupère l'historique des promotions que l'utilisateur a likées ou partagées
exports.getPromotionsHistorique = async (req, res) => {
    if (req.user.role !== 'utilisateur') {
        return res.status(403).json({ message: 'Accès non autorisé' });
    }
    const userId = req.user.id;
  
    try {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
  
        // Récupérer les promotions avec leurs commentaires
        const [promotions] = await pool.execute(
            `SELECT DISTINCT p.* 
             FROM promotions p
             JOIN interactions i ON p.id = i.id_promotion
             WHERE i.id_utilisateur = ? 
               AND i.type_interaction IN ('like', 'partage')
             ORDER BY i.id DESC`,
            [userId]
        );
  
        if (promotions.length === 0) {
            return res.status(200).json([]);
        }

        // Récupérer les IDs des promotions pour charger les commentaires
        const promoIds = promotions.map(p => p.id);
        const placeholders = promoIds.map(() => '?').join(',');
        
        const [commentaires] = await pool.execute(
            `SELECT 
                c.id_promotion, 
                c.commentaire, 
                c.date_commentaire,
                u.nom_utilisateur
             FROM commentaires c
             JOIN utilisateurs u ON c.id_utilisateur = u.id
             WHERE c.id_promotion IN (${placeholders})`,
            promoIds
        );

        // Associer les commentaires aux promotions
        const promotionsWithComments = promotions.map(promo => {
            const promoComments = commentaires.filter(c => c.id_promotion === promo.id);
            
            return {
                ...promo,
                url_video: promo.url_video 
                    ? `${baseUrl}/uploads/videos/${promo.url_video}`
                    : null,
                thumbnail_url: promo.thumbnail_url 
                    ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}`
                    : null,
                commentaires: promoComments
            };
        });
  
        return res.status(200).json(promotionsWithComments);
    } catch (error) {
      console.error('Erreur getPromotionsHistorique:', error);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
};