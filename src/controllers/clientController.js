// pubcash-api/src/controllers/clientController.js
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
// Fonction pour récupérer les infos du profil du client connecté
exports.getProfile = async (req, res) => {
    try {
        const clientId = req.user.id;
        // On sélectionne maintenant les nouveaux champs
        const [rows] = await pool.execute(
            'SELECT id, nom, prenom, nom_utilisateur, email, commune, solde_recharge, description, profile_image_url, background_image_url FROM clients WHERE id = ?',
            [clientId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Client non trouvé.' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error("Erreur getProfile:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
exports.updateProfile = async (req, res) => {
    const clientId = req.user.id;
    const { nom, prenom, nom_utilisateur, description, newPassword, currentPassword } = req.body;

    try {
        // Validation des champs de base
        if (!nom || !prenom || !nom_utilisateur) {
            return res.status(400).json({ message: 'Le nom, le prénom et le nom d\'utilisateur sont requis.' });
        }

        // Mise à jour des informations de base
        await pool.execute(
            'UPDATE clients SET nom = ?, prenom = ?, nom_utilisateur = ?, description = ? WHERE id = ?',
            [nom, prenom, nom_utilisateur, description || null, clientId]
        );

        // Logique de mise à jour du mot de passe
        if (newPassword && currentPassword) {
            const [rows] = await pool.execute('SELECT mot_de_passe FROM clients WHERE id = ?', [clientId]);
            const user = rows[0];

            const isMatch = await bcrypt.compare(currentPassword, user.mot_de_passe);
            if (!isMatch) {
                return res.status(401).json({ message: 'Le mot de passe actuel est incorrect.' });
            }

            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            await pool.execute('UPDATE clients SET mot_de_passe = ? WHERE id = ?', [hashedNewPassword, clientId]);
        }

        res.status(200).json({ message: 'Profil mis à jour avec succès !' });

    } catch (error) {
        console.error("Erreur updateProfile:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
// Fonction pour gérer le rechargement du compte
exports.rechargeAccount = async (req, res) => {
    const { amount } = req.body;
    const clientId = req.user.id;

    if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Le montant doit être un nombre positif.' });
    }

    // --- SIMULATION D'UN PAIEMENT ---
    // Dans une vraie application, c'est ici que vous appelleriez l'API d'un
    // service de paiement (Stripe, CinetPay, FedaPay, etc.) avec le montant.
    // Pour notre exemple, nous allons considérer que le paiement a réussi.
    // ---------------------------------

    try {
        await pool.execute(
            'UPDATE clients SET solde_recharge = solde_recharge + ? WHERE id = ?',
            [amount, clientId]
        );

        // On récupère le nouveau solde pour le renvoyer
        const [rows] = await pool.execute('SELECT solde_recharge FROM clients WHERE id = ?', [clientId]);
        const newBalance = rows[0].solde_recharge;

        res.status(200).json({ message: 'Compte rechargé avec succès !', newBalance: newBalance });
    } catch (error) {
        console.error("Erreur rechargeAccount:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// --- NOUVELLE FONCTION POUR CRÉER UNE PROMOTION ---
// --- FONCTION CREATEPROMOTION MISE À JOUR ---
// pubcash-api/src/controllers/clientController.js

exports.createPromotion = async (req, res) => {
    const clientId = req.user.id;
    let { titre, description, url_video, budget, duree_secondes, thumbnail_url, tranche_age, ciblage_commune } = req.body;
    
    // VALIDATION DES NOUVEAUX CHAMPS
    if (!tranche_age || !ciblage_commune) {
        return res.status(400).json({ message: 'Les tranches d\'âge et le ciblage par commune sont requis.' });
    }
    
    // Convertir les valeurs potentiellement undefined en null
    url_video = url_video || null;
    thumbnail_url = thumbnail_url || null;
    description = description || null;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // On récupère aussi la rémunération du pack pour le calcul
        const [packs] = await connection.execute(
            'SELECT id, remuneration FROM packs WHERE ? >= duree_min_secondes AND ? <= duree_max_secondes',
            [duree_secondes, duree_secondes]
        );
        const pack = packs[0];
        if (!pack) {
            await connection.rollback();
            return res.status(400).json({ message: `Aucun pack disponible pour une vidéo de ${duree_secondes}s.` });
        }
        const packId = pack.id;
        const remunerationParVue = pack.remuneration;

        const [rows] = await connection.execute('SELECT solde_recharge FROM clients WHERE id = ? FOR UPDATE', [clientId]);
        const client = rows[0];
        if (!client || client.solde_recharge < budget) {
            await connection.rollback();
            return res.status(400).json({ message: 'Solde insuffisant pour créer cette promotion.' });
        }
        
        const newBalance = client.solde_recharge - budget;
        await connection.execute('UPDATE clients SET solde_recharge = ? WHERE id = ?', [newBalance, clientId]);
        
        const commission = budget * 0.15;
        await connection.execute('UPDATE portefeuille_admin SET solde = solde + ? WHERE id = 1', [commission]);

        // --- CORRECTION ET AJOUT DE LA LOGIQUE ---
        // 1. Calculer le budget réel disponible pour les vues
        const budgetReelPourVues = budget - commission;
        // 2. Calculer le nombre de vues potentielles
        const vuesPotentielles = Math.floor(budgetReelPourVues / remunerationParVue);

        const [result] = await connection.execute(
            `INSERT INTO promotions (
                id_client, titre, description, url_video, thumbnail_url, duree_secondes, 
                id_pack, budget_initial, budget_restant, statut, commission_pubcash, 
                vues_potentielles, tranche_age, ciblage_commune
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clientId, 
                titre, 
                description,
                url_video, 
                thumbnail_url, 
                duree_secondes, 
                packId, 
                budget, 
                budget, 
                'en_cours', 
                commission, 
                vuesPotentielles, 
                tranche_age, 
                ciblage_commune
            ]
        );

        await connection.commit();
        res.status(201).json({ 
            message: 'Promotion créée avec succès !', 
            promotionId: result.insertId,
            newBalance: newBalance 
        });

    } catch (error) {
        await connection.rollback();
        console.error("Erreur createPromotion:", error); // <-- REGARDEZ CETTE ERREUR DANS LE TERMINAL DE L'API
        res.status(500).json({ message: 'Erreur serveur lors de la création de la promotion.' });
    } finally {
        connection.release();
    }
};

// --- NOUVELLE FONCTION POUR AFFICHER LES PROMOTIONS DU CLIENT ---
// pubcash-api/src/controllers/clientController.js
exports.getClientPromotions = async (req, res) => {
    const clientId = req.user.id;
    try {
        const [promotions] = await pool.execute(
            `SELECT 
                p.id, p.titre, p.url_video, p.statut, p.budget_initial, p.budget_restant, 
                p.vues, p.likes, p.partages, p.thumbnail_url,
                pk.nom_pack
             FROM promotions p
             LEFT JOIN packs pk ON p.id_pack = pk.id
             WHERE p.id_client = ? AND (p.statut IS NULL OR p.statut <> 'termine')
             ORDER BY p.date_creation DESC`,
            [clientId]
          );
        
        // Construire l'URL complète côté serveur
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const promotionsWithFullUrls = promotions.map(promo => ({
            ...promo,
            thumbnail_url: promo.thumbnail_url 
              ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}`
              : null,
            // CORRECTION : Ajouter l'URL complète pour la vidéo
            url_video: promo.url_video 
              ? `${baseUrl}/uploads/videos/${promo.url_video}`
              : null
          }));

        res.status(200).json(promotionsWithFullUrls);
    } catch (error) {
        console.error("Erreur getClientPromotions:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

exports.getGlobalStats = async (req, res) => {
    const clientId = req.user.id;
    try {
        // On fait une seule requête pour agréger toutes les stats
        const [rows] = await pool.execute(
            `SELECT 
                SUM(vues) as total_vues, 
                SUM(likes) as total_likes, 
                SUM(partages) as total_partages
             FROM promotions 
             WHERE id_client = ?`,
            [clientId]
        );
        const stats = rows[0];
        // On s'assure de renvoyer 0 si le client n'a aucune promotion
        res.status(200).json({
            total_vues: stats.total_vues || 0,
            total_likes: stats.total_likes || 0,
            total_partages: stats.total_partages || 0,
        });
    } catch (error) {
        console.error("Erreur getGlobalStats:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
exports.getPromotionHistory = async (req, res) => {
    const clientId = req.user.id;
    try {
        // 1. Récupérer toutes les promotions terminées du client
        const [promotions] = await pool.execute(
            `SELECT 
                p.id, p.titre, p.description, p.url_video, p.statut, p.budget_initial, 
                p.vues, p.likes, p.partages, p.thumbnail_url, p.date_creation, p.date_fin,
                pk.nom_pack
             FROM promotions p
             LEFT JOIN packs pk ON p.id_pack = pk.id
             WHERE p.id_client = ? AND p.statut = 'termine'
             ORDER BY p.date_creation DESC`,
            [clientId]
        );

        if (promotions.length === 0) {
            return res.status(200).json([]);
        }

        // 2. Récupérer TOUS les commentaires liés à ces promotions
        const promotionIds = promotions.map(p => p.id);
        const placeholders = promotionIds.map(() => '?').join(','); // Crée une chaîne comme "?,?,?"

        const [commentaires] = await pool.execute(
            `SELECT 
                c.id, c.commentaire, c.date_commentaire, c.id_promotion,
                u.nom_utilisateur
             FROM commentaires c
             JOIN utilisateurs u ON c.id_utilisateur = u.id
             WHERE c.id_promotion IN (${placeholders})
             ORDER BY c.date_commentaire ASC`,
            promotionIds // Passe le tableau d'IDs
        );

        // 3. Associer les commentaires à leurs promotions respectives (méthode plus robuste)
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const historyData = promotions.map(promo => {
            return {
                ...promo,
                // On reconstruit les URLs complètes ici
                thumbnail_url: promo.thumbnail_url 
                    ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}` 
                    : null,
                url_video: promo.url_video && !promo.url_video.startsWith('http')
                    ? `${baseUrl}/uploads/videos/${promo.url_video}`
                    : promo.url_video,
                // On filtre correctement les commentaires pour CETTE promotion
                commentaires: commentaires.filter(comment => comment.id_promotion === promo.id)
            };
        });

        res.status(200).json(historyData);

    } catch (error) {
        console.error("Erreur getPromotionHistory:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};