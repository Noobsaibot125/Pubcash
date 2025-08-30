// pubcash-api/src/controllers/promotionController.js
const axios = require('axios'); 
const pool = require('../config/db');
const { sendPromotionFinishedEmail } = require('../services/emailService');
exports.getPromotionsForUser = async (req, res) => {
  const userId = req.user.id;
  const userCommune = req.user.commune_choisie || null;
  const filter = req.query.filter || 'ma_commune';

  try {
      const [userData] = await pool.execute('SELECT date_naissance FROM utilisateurs WHERE id = ?', [userId]);
      if (!userData.length || !userData[0].date_naissance) {
          return res.status(403).json({ message: "Votre profil est incomplet (date de naissance manquante)." });
      }
      const user = userData[0];
      const birthDate = new Date(user.date_naissance);
      const age = new Date(Date.now() - birthDate.getTime()).getUTCFullYear() - 1970;
      
      let query = `
          SELECT 
              p.*, 
              c.nom_utilisateur as client_nom_utilisateur, 
              c.commune as client_commune,
              pk.remuneration AS remuneration_pack -- << AJOUTEZ CETTE LIGNE
          FROM promotions p
          JOIN clients c ON p.id_client = c.id
          JOIN packs pk ON p.id_pack = pk.id -- << AJOUTEZ CETTE JOINTURE
          WHERE p.statut = 'en_cours' 
            AND p.budget_restant > 0
            AND (
                p.tranche_age = 'tous'
                OR (p.tranche_age = '12-17' AND ? BETWEEN 12 AND 17)
                OR (p.tranche_age = '18+' AND ? >= 18)
            )
      `;
      let params = [age, age];

      // --- LOGIQUE DE FILTRAGE CORRIGÉE ---
      if (filter === 'toutes') {
          // Si l'utilisateur veut "Toutes les communes" => afficher uniquement les promos 'toutes'
          query += ` AND p.ciblage_commune = 'toutes' `;
      } else { 
          // filter === 'ma_commune' (ou autre valeur par défaut)
          if (!userCommune) {
              // Pas de commune renseignée : on affiche uniquement les promos nationales
              query += ` AND p.ciblage_commune = 'toutes' `;
          } else {
              // Utilisateur avec commune : on affiche **seulement** les promos ciblées sur sa commune
              // (NE PAS inclure p.ciblage_commune = 'toutes' ici — c'était la cause du bug)
              query += ` AND (p.ciblage_commune = 'ma_commune' AND c.commune = ?) `;
              params.push(userCommune);
          }
      }
      // --- FIN LOGIQUE ---

      query += `
          AND NOT EXISTS (
              SELECT 1 FROM interactions i
              WHERE i.id_utilisateur = ? AND i.id_promotion = p.id AND i.type_interaction IN ('like', 'partage')
          )
          ORDER BY p.date_creation DESC
      `;
      params.push(userId);

      const [promotions] = await pool.execute(query, params);
    
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const promotionsWithUrls = promotions.map(promo => ({
          ...promo,
          url_video: promo.url_video && !promo.url_video.startsWith('http') 
              ? `${baseUrl}/uploads/videos/${promo.url_video}` 
              : promo.url_video,
          thumbnail_url: promo.thumbnail_url && !promo.thumbnail_url.startsWith('http')
              ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}` 
              : promo.thumbnail_url
      }));
    
      res.status(200).json(promotionsWithUrls);

  } catch (error) {
      console.error("Erreur getPromotionsForUser:", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- VERSION CORRIGÉE ET SÉCURISÉE DE handleInteraction ---

const handleInteraction = async (req, res, interactionType) => {
  const { promotionId } = req.params;
  const userId = req.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // =====================================================================
    // ÉTAPE 1 (AJOUT CRUCIAL) : VÉRIFIER L'ÉLIGIBILITÉ DE L'UTILISATEUR
    // =====================================================================
    const eligibilityQuery = `
      SELECT p.id
      FROM promotions p
      JOIN clients c ON p.id_client = c.id
      JOIN utilisateurs u ON u.id = ?
      WHERE 
        p.id = ?
        AND p.statut = 'en_cours'
        AND p.budget_restant > 0
        AND (
            p.tranche_age = 'tous'
            OR (p.tranche_age = '12-17' AND TIMESTAMPDIFF(YEAR, u.date_naissance, CURDATE()) BETWEEN 12 AND 17)
            OR (p.tranche_age = '18+' AND TIMESTAMPDIFF(YEAR, u.date_naissance, CURDATE()) >= 18)
        )
        AND (
            p.ciblage_commune = 'toutes'
            OR (p.ciblage_commune = 'ma_commune' AND c.commune = u.commune_choisie)
        )
    `;

    const [eligiblePromo] = await connection.execute(eligibilityQuery, [userId, promotionId]);

    if (eligiblePromo.length === 0) {
        await connection.rollback();
        // Si l'utilisateur n'est pas éligible, on bloque l'action avec une erreur 403.
        return res.status(403).json({ message: 'Vous n\'êtes pas éligible pour interagir avec cette promotion.' });
    }

    // =====================================================================
    // ÉTAPE 2 : Vérifier si l'interaction est un doublon
    // =====================================================================
    const [existing] = await connection.execute(
      'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
      [userId, promotionId, interactionType]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(200).json({ message: `Interaction '${interactionType}' déjà enregistrée.` });
    }

    // Si on arrive ici, l'utilisateur est éligible ET l'interaction est nouvelle.
    // Le reste du code peut s'exécuter en toute sécurité.

    // 3. Insérer l'interaction (like ou partage)
    await connection.execute(
      'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
      [userId, promotionId, interactionType]
    );

    // 4. Mettre à jour le compteur de la promotion (likes/partages)
    const columnName = interactionType === 'partage' ? 'partages' : 'likes';
    await connection.execute(`UPDATE promotions SET ${columnName} = ${columnName} + 1 WHERE id = ?`, [promotionId]);

    // 5. Vérifier si les deux interactions (like + partage) sont faites pour déclencher la vue
    const [interactions] = await connection.execute(
      'SELECT COUNT(DISTINCT type_interaction) as count FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction IN (?, ?)',
      [userId, promotionId, 'like', 'partage']
    );

    // Si le compte est à 2 (like + partage), on déclenche la logique de la "vue"
    if (interactions.length > 0 && interactions[0].count === 2) {

      // ... (Le reste de votre logique de "vue" est ici et reste inchangé) ...
      const [existingView] = await connection.execute('SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?', [userId, promotionId, 'vue']);
      if (existingView.length === 0) {
          const [promoRows] = await connection.execute(`SELECT p.id, p.budget_restant, p.vues, p.vues_potentielles, pk.remuneration FROM promotions p JOIN packs pk ON p.id_pack = pk.id WHERE p.id = ? AND p.statut = 'en_cours' FOR UPDATE`, [promotionId]);
          const promotion = promoRows[0];
          if (promotion && Number(promotion.budget_restant) >= Number(promotion.remuneration)) {
              const montant = Number(promotion.remuneration);
              await connection.execute('INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)', [userId, promotionId, 'vue']);
              const newVues = promotion.vues + 1;
              const newBudget = Number(promotion.budget_restant) - montant;
              await connection.execute('UPDATE promotions SET vues = ?, budget_restant = ? WHERE id = ?', [newVues, newBudget, promotionId]);
              await connection.execute('UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur,0) + ? WHERE id = ?', [montant, userId]);
              await connection.execute('INSERT INTO user_gains (id_utilisateur, id_promotion, montant, type_gain) VALUES (?, ?, ?, ?)', [userId, promotionId, montant, 'vue']);
              if (newVues >= promotion.vues_potentielles || newBudget < montant) {
                await connection.execute('UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?', ['termine', promotionId]);
                // On passe `req` pour construire l'URL de l'image
                await notifyClientOfFinishedPromotion(promotionId, connection, req); 
            }
          } else {
              await connection.execute('UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?', ['termine', promotionId]);
              // --- APPEL DE LA FONCTION D'ENVOI D'EMAIL ---
              await notifyClientOfFinishedPromotion(promotionId, connection, req);
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
  
//Ajout de commentaire
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
  
      // 1) Vérifier si une 'vue' a déjà été enregistrée pour cet utilisateur et cette promo
      const [existing] = await connection.execute(
        'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
        [userId, promotionId, 'vue']
      );
      if (existing.length > 0) {
        await connection.rollback();
        return res.status(200).json({ message: 'Vue déjà comptabilisée.' });
      }
  
      // 2) Récupérer les infos de la promotion et du pack associé (FOR UPDATE pour verrouiller)
      const [promoRows] = await connection.execute(
        `SELECT p.id, p.budget_restant, p.vues, p.vues_potentielles, p.id_pack, pk.remuneration
         FROM promotions p
         JOIN packs pk ON p.id_pack = pk.id
         WHERE p.id = ? AND p.statut = 'en_cours' FOR UPDATE`,
        [promotionId]
      );
  
      const promotion = promoRows[0];
      if (!promotion) {
        await connection.rollback();
        return res.status(404).json({ message: 'Promotion non trouvée ou terminée.' });
      }
  
      const montant = Number(promotion.remuneration || 0);
  
      // 3) Vérifier si le budget restant est suffisant pour une vue
      if (promotion.budget_restant < montant) {
        await connection.execute(
          'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
          ['termine', promotionId]
        );
        // --- APPEL DE LA FONCTION D'ENVOI D'EMAIL ---
        await notifyClientOfFinishedPromotion(promotionId, connection, req);
        await connection.commit();
        return res.status(400).json({ message: 'Budget de la promotion épuisé.' });
      }
  
      // 4) Enregistrer la vue dans interactions
      await connection.execute(
        'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
        [userId, promotionId, 'vue']
      );
  
      // 5) Mettre à jour les compteurs et le budget dans promotions
      const newVues = promotion.vues + 1;
      const newBudget = Number(promotion.budget_restant) - montant;
  
      await connection.execute(
        'UPDATE promotions SET vues = ?, budget_restant = ? WHERE id = ?',
        [newVues, newBudget, promotionId]
      );
  
      // 6) Créditer l'utilisateur et insérer historique user_gains
      await connection.execute(
        'UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur,0) + ? WHERE id = ?',
        [montant, userId]
      );
  
      await connection.execute(
        'INSERT INTO user_gains (id_utilisateur, id_promotion, montant, type_gain) VALUES (?, ?, ?, ?)',
        [userId, promotionId, montant, 'vue']
      );
  
      // 7) Terminer la promotion si nécessaire
      if (newVues >= promotion.vues_potentielles || newBudget < montant) {
        await connection.execute(
            'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
            ['termine', promotionId]
        );
        // On passe `req` pour construire l'URL de l'image
        await notifyClientOfFinishedPromotion(promotionId, connection, req);
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
//voir gain utilisateur
exports.getUserEarnings = async (req, res) => {
    const userId = req.user.id;
    try {
      // 1) total depuis la colonne remuneration_utilisateur
      const [userRow] = await pool.execute(
        'SELECT COALESCE(remuneration_utilisateur, 0) AS total FROM utilisateurs WHERE id = ?',
        [userId]
      );
      const total = userRow[0] ? Number(userRow[0].total) : 0;
  
      // 2) détail par pack (groupé)
      const [perPack] = await pool.execute(
        `SELECT pk.id AS pack_id, pk.nom_pack, COALESCE(SUM(g.montant),0) AS total_gagne
         FROM user_gains g
         LEFT JOIN promotions p ON g.id_promotion = p.id
         LEFT JOIN packs pk ON p.id_pack = pk.id
         WHERE g.id_utilisateur = ?
         GROUP BY pk.id, pk.nom_pack`,
        [userId]
      );
  
      res.status(200).json({ total, per_pack: perPack });
    } catch (err) {
      console.error('Erreur getUserEarnings:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  };



// --- FONCTION DE RETRAIT ENTIÈREMENT REVUE ---
exports.withdrawEarnings = async (req, res) => {
  const userId = req.user.id;
  // 1. Récupérer le montant depuis le corps de la requête
  const { operator, phoneNumber, amount } = req.body; 

  // 2. Valider le montant
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ message: 'Un montant valide est requis.' });
  }
  const withdrawalAmount = Number(amount);

  if (!operator || !phoneNumber) {
    return res.status(400).json({ message: 'L\'opérateur et le numéro de téléphone sont requis.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [userRows] = await connection.execute(
      'SELECT remuneration_utilisateur, contact FROM utilisateurs WHERE id = ? FOR UPDATE',
      [userId]
    );
    
    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const solde = Number(userRows[0].remuneration_utilisateur || 0);

    // 3. Vérifier que le montant demandé ne dépasse pas le solde
    if (withdrawalAmount > solde) {
      await connection.rollback();
      return res.status(400).json({ message: 'Le montant demandé dépasse votre solde disponible.' });
    }

    // 4. Insérer la demande avec le montant spécifié
    await connection.execute(
      'INSERT INTO demandes_retrait (id_utilisateur, montant, operateur_mobile, statut) VALUES (?, ?, ?, ?)',
      [userId, withdrawalAmount, operator, 'en_attente']
    );

    // 5. Déduire le montant retiré du solde de l'utilisateur
    await connection.execute(
      'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur - ? WHERE id = ?',
      [withdrawalAmount, userId]
    );

    if (phoneNumber !== userRows[0].contact) {
      await connection.execute(
        'UPDATE utilisateurs SET contact = ? WHERE id = ?',
        [phoneNumber, userId]
      );
    }

    await connection.commit();
    
    res.status(200).json({ 
      message: 'Demande de retrait enregistrée !', 
      montant: withdrawalAmount 
    });

  } catch (error) {
    await connection.rollback();
    console.error("Erreur withdrawEarnings:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    connection.release();
  }
};
// historique de retrait
exports.getWithdrawalHistoryForUser = async (req, res) => {
  const userId = req.user.id;
  try {
    const [history] = await pool.execute(
      `SELECT 
          id, 
          montant, 
          statut, 
          date_demande as date,
          operateur_mobile as operator
       FROM demandes_retrait 
       WHERE id_utilisateur = ? 
       ORDER BY date_demande DESC`,
      [userId]
    );
    res.status(200).json(history);
  } catch (error) {
    console.error("Erreur getWithdrawalHistoryForUser:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
const notifyClientOfFinishedPromotion = async (promotionId, connection, req) => {
  try {
      // --- MODIFICATION : Ajout de `p.thumbnail_url` à la requête SQL ---
      const [details] = await connection.execute(
          `SELECT 
              p.titre, p.description, p.thumbnail_url,
              c.nom, c.email 
           FROM promotions p
           JOIN clients c ON p.id_client = c.id
           WHERE p.id = ?`,
          [promotionId]
      );

      if (details.length > 0) {
          const promotionData = details[0];
          
          // On construit l'URL de base du serveur (ex: http://localhost:5000)
          const baseUrl = `${req.protocol}://${req.get('host')}`;

          // On construit l'URL complète et publique du thumbnail
          const finalThumbUrl = promotionData.thumbnail_url && !promotionData.thumbnail_url.startsWith('http')
            ? `${baseUrl}/uploads/thumbnails/${encodeURIComponent(promotionData.thumbnail_url)}`
            : promotionData.thumbnail_url;

          const promotion = {
              titre: promotionData.titre,
              description: promotionData.description,
              // --- AJOUT : On passe l'URL complète au service d'email ---
              thumbnail_url: finalThumbUrl || '' 
          };
          const client = {
              nom: promotionData.nom,
              email: promotionData.email,
          };

          // On appelle le service d'email comme avant, mais avec la nouvelle donnée
          sendPromotionFinishedEmail(client, promotion);
      }
  } catch (error) {
      console.error("Échec de la tentative d'envoi de l'e-mail de fin de promotion:", error);
  }
};