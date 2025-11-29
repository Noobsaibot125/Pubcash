// pubcash-api/src/controllers/promotionController.js
const axios = require('axios');
const pool = require('../config/db');
const { sendPromotionFinishedEmail } = require('../services/emailService');
const { v4: uuidv4 } = require('uuid');
const https = require('https'); // <--- AJOUTE CETTE LIGNE
const FormData = require('form-data');
const { URLSearchParams } = require('url');
const notificationService = require('../services/notificationService');
exports.getPromotionsForUser = async (req, res) => {
  const userId = req.user.id;
  const userCommune = req.user.commune_choisie || null;
  const filter = req.query.filter || 'ma_commune';

  try {
    // 1. Âge (inchangé)
    const [userData] = await pool.execute('SELECT date_naissance FROM utilisateurs WHERE id = ?', [userId]);
    if (!userData.length || !userData[0].date_naissance) {
      return res.status(403).json({ message: "Votre profil est incomplet." });
    }
    const user = userData[0];
    const birthDate = new Date(user.date_naissance);
    const age = new Date(Date.now() - birthDate.getTime()).getUTCFullYear() - 1970;

    const params = [];

    // 2. Requete de base
    let query = `
          SELECT 
              p.*, 
              c.nom_utilisateur as client_nom_utilisateur, 
              c.commune as client_commune,
              pk.remuneration AS remuneration_pack,
              pk.nom_pack,  -- IMPORTANT : On récupère le nom du pack pour le filtrage
              g.id as game_id,
              g.type as game_type,
              g.points_recompense
          FROM promotions p
          JOIN clients c ON p.id_client = c.id
          JOIN packs pk ON p.id_pack = pk.id
          LEFT JOIN games g ON p.id = g.promotion_id AND g.statut = 'actif'
          WHERE p.statut = 'en_cours' 
            AND p.budget_restant > 0
            
            -- Filtre âge
            AND (
                p.tranche_age = 'tous'
                OR (p.tranche_age = '12-17' AND ? BETWEEN 12 AND 17)
                OR (p.tranche_age = '18+' AND ? >= 18)
            )
    `;
    
    params.push(age, age);

    // --- 3. LOGIQUE DE FILTRAGE (CORRIGÉE) ---
    if (filter === 'ma_commune' && userCommune) {
       query += ` AND (p.ciblage_commune = 'toutes' OR (p.ciblage_commune = 'ma_commune' AND c.commune = ?))`;
       params.push(userCommune);
    } 
    else if (filter === 'argent') {
       query += ` AND pk.nom_pack = 'Argent'`;
    }
    else if (filter === 'gold') {
       query += ` AND pk.nom_pack = 'Gold'`;
    }
    else if (filter === 'diamant') {
       query += ` AND pk.nom_pack = 'Diamant'`;
    }
    // Si filter === 'toutes', on n'ajoute rien, on prend tout.

    // 4. Exclusion des vues
    query += ` AND NOT EXISTS (
        SELECT 1 FROM interactions i 
        WHERE i.id_promotion = p.id 
        AND i.id_utilisateur = ? 
        AND i.type_interaction = 'vue'
    )`;
    params.push(userId);

    query += ` ORDER BY p.date_creation DESC`;

    const [promotions] = await pool.execute(query, params);

    // ... (Formatage des URLs inchangé) ...
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const promotionsWithUrls = promotions.map(promo => ({
      ...promo,
      game_id: promo.game_id || null,
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

    // 3. Insérer l'interaction
    await connection.execute(
      'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
      [userId, promotionId, interactionType]
    );

    // 4. Mettre à jour compteur
    const columnName = interactionType === 'partage' ? 'partages' : 'likes';
    await connection.execute(`UPDATE promotions SET ${columnName} = ${columnName} + 1 WHERE id = ?`, [promotionId]);

    // 5. Vérifier si VUE validée
    const [interactions] = await connection.execute(
      'SELECT COUNT(DISTINCT type_interaction) as count FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction IN (?, ?)',
      [userId, promotionId, 'like', 'partage']
    );

    // Si le compte est à 2 (like + partage), on déclenche la logique de la "vue"
    if (interactions.length > 0 && interactions[0].count === 2) {

      const [existingView] = await connection.execute('SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?', [userId, promotionId, 'vue']);

      if (existingView.length === 0) {
        // --- MODIFICATION ICI : On récupère aussi le nom du pack (pk.nom_pack) ---
        const [promoRows] = await connection.execute(
          `SELECT p.id, p.budget_restant, p.vues, p.vues_potentielles, pk.remuneration, pk.nom_pack 
             FROM promotions p 
             JOIN packs pk ON p.id_pack = pk.id 
             WHERE p.id = ? AND p.statut = 'en_cours' FOR UPDATE`,
          [promotionId]
        );

        const promotion = promoRows[0];
        if (promotion && Number(promotion.budget_restant) >= Number(promotion.remuneration)) {
          const montant = Number(promotion.remuneration);

          // Logique Vue Classique
          await connection.execute('INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)', [userId, promotionId, 'vue']);

          // Mise à jour stats promo et argent user
          await connection.execute('UPDATE promotions SET vues = vues + 1, budget_restant = budget_restant - ? WHERE id = ?', [montant, promotionId]);
          await connection.execute('UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur,0) + ? WHERE id = ?', [montant, userId]);
          await connection.execute('INSERT INTO user_gains (id_utilisateur, id_promotion, montant, type_gain) VALUES (?, ?, ?, ?)', [userId, promotionId, montant, 'vue']);

          // === LOGIQUE PARRAINAGE EXISTANTE (Gardée) ===
          if (promotion.nom_pack === 'Diamant' || promotion.nom_pack === 'diamant') {
            // ... ton code parrainage ...
            const [userRows] = await connection.execute('SELECT parrain_id FROM utilisateurs WHERE id = ?', [userId]);
            if (userRows.length > 0 && userRows[0].parrain_id) {
              await connection.execute('UPDATE utilisateurs SET points = points + 5 WHERE id = ?', [userRows[0].parrain_id]);
              await connection.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())', [userRows[0].parrain_id, 5, 'bonus_parrainage_diamant']);
            }
          }

          // =========================================================================
          // <<< AJOUT ICI : GESTION BONUS 10 VIDÉOS PAR JOUR >>>
          // =========================================================================
          const today = new Date().toISOString().split('T')[0];

          // 1. On insère ou on incrémente le compteur journalier
          await connection.execute(`
            INSERT INTO daily_activity (user_id, date, videos_watched) 
            VALUES (?, ?, 1)
            ON DUPLICATE KEY UPDATE videos_watched = videos_watched + 1
          `, [userId, today]);

          // 2. On vérifie combien on en a regardé aujourd'hui
          const [activityRows] = await connection.execute(
            'SELECT videos_watched FROM daily_activity WHERE user_id = ? AND date = ?',
            [userId, today]
          );

          if (activityRows.length > 0) {
            const count = activityRows[0].videos_watched;

            // Si on vient d'atteindre exactement la 10ème vidéo
            if (count === 10) {
              await connection.execute(
                'UPDATE utilisateurs SET points = COALESCE(points, 0) + 5 WHERE id = ?',
                [userId]
              );
              await connection.execute(
                'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, 5, ?, NOW())',
                [userId, 'bonus_10_videos_jour']
              );
            }
          }
          // =========================================================================
          // <<< FIN DE L'AJOUT >>>
          // =========================================================================

          // Vérification fin de promo
          const newVues = promotion.vues + 1;
          const newBudget = Number(promotion.budget_restant) - montant; // Note: budget_restant original
          if (newVues >= promotion.vues_potentielles || newBudget < montant) {
            await connection.execute('UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?', ['termine', promotionId]);
            await notifyClientOfFinishedPromotion(promotionId, connection, req);
          }

        } else {
          // Budget insuffisant
          await connection.execute('UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?', ['termine', promotionId]);
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

  // Log de début
  console.log(`\n--- [DEBUG] Début viewPromotion pour User ${userId} / Promo ${promotionId} ---`);

  try {
    await connection.beginTransaction();

    // 1) Vérifier si une 'vue' a déjà été enregistrée
    const [existing] = await connection.execute(
      'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
      [userId, promotionId, 'vue']
    );

    if (existing.length > 0) {
      console.log(`[DEBUG] ❌ Vue déjà existante. Arrêt du traitement.`);
      await connection.rollback();
      return res.status(200).json({ message: 'Vue déjà comptabilisée.' });
    }

    // 2) Récupérer les infos de la promotion
    const [promoRows] = await connection.execute(
      `SELECT p.id, p.budget_restant, p.vues, p.vues_potentielles, p.id_pack, pk.remuneration
         FROM promotions p
         JOIN packs pk ON p.id_pack = pk.id
         WHERE p.id = ? AND p.statut = 'en_cours' FOR UPDATE`,
      [promotionId]
    );

    const promotion = promoRows[0];
    if (!promotion) {
      console.log(`[DEBUG] ❌ Promotion introuvable ou terminée.`);
      await connection.rollback();
      return res.status(404).json({ message: 'Promotion non trouvée ou terminée.' });
    }

    const montant = Number(promotion.remuneration || 0);

    // 3) Vérifier budget
    if (promotion.budget_restant < montant) {
      console.log(`[DEBUG] ❌ Budget épuisé.`);
      await connection.execute(
        'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
        ['termine', promotionId]
      );
      await notifyClientOfFinishedPromotion(promotionId, connection, req);
      await connection.commit();
      return res.status(400).json({ message: 'Budget de la promotion épuisé.' });
    }

    // 4) Enregistrer la vue
    console.log(`[DEBUG] ✅ Enregistrement interaction "vue"...`);
    await connection.execute(
      'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
      [userId, promotionId, 'vue']
    );

    // 5) Update Promotion
    const newVues = promotion.vues + 1;
    const newBudget = Number(promotion.budget_restant) - montant;
    await connection.execute(
      'UPDATE promotions SET vues = ?, budget_restant = ? WHERE id = ?',
      [newVues, newBudget, promotionId]
    );

    // 6) Créditer Cash Utilisateur
    console.log(`[DEBUG] 💰 Crédit de ${montant} FCFA à l'utilisateur.`);
    await connection.execute(
      'UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur,0) + ? WHERE id = ?',
      [montant, userId]
    );
    await connection.execute(
      'INSERT INTO user_gains (id_utilisateur, id_promotion, montant, type_gain) VALUES (?, ?, ?, ?)',
      [userId, promotionId, montant, 'vue']
    );
// --- AJOUT NOTIFICATION : VIDÉO REGARDÉE ---
    await notificationService.envoyerNotification(
      userId,
      'video_regardee',
      'Vidéo visionnée !',
      `Vous avez gagné ${montant} FCFA`,
      { montant, promotion_id: promotionId }
    ).catch(err => console.error('Erreur notification video_regardee:', err));
    // ------------------------------------------
    // =========================================================================
    // --- GESTION BONUS 10 VIDÉOS PAR JOUR (AVEC LOGS) ---
    // =========================================================================

    const today = new Date().toISOString().split('T')[0];
    console.log(`[DEBUG] 📅 Mise à jour daily_activity pour la date : ${today}`);

    // A. Exécution de la requête d'incrémentation
    // Note: Le résultat [result] contient affectedRows. 
    // 1 = Insert, 2 = Update (C'est une spécificité MySQL avec ON DUPLICATE KEY)
    const [resultUpdate] = await connection.execute(`
        INSERT INTO daily_activity (user_id, date, videos_watched) 
        VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE videos_watched = videos_watched + 1
    `, [userId, today]);

    console.log(`[DEBUG] Résultat SQL daily_activity: affectedRows = ${resultUpdate.affectedRows}`);

    // B. Lecture pour vérification
    const [activityRows] = await connection.execute(
      'SELECT videos_watched FROM daily_activity WHERE user_id = ? AND date = ?',
      [userId, today]
    );

    if (activityRows.length > 0) {
      const count = activityRows[0].videos_watched;
      console.log(`[DEBUG] 📊 Nouveau total videos_watched : ${count}`);

      if (count === 10) {
        console.log(`[DEBUG] 🎉 BONUS 10 VIDÉOS ATTEINT ! Attribution des 5 points.`);

        await connection.execute(
          'UPDATE utilisateurs SET points = COALESCE(points, 0) + 5 WHERE id = ?',
          [userId]
        );

        await connection.execute(
          'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, 5, ?, NOW())',
          [userId, 'bonus_10_videos_jour']
        );
      } else {
        console.log(`[DEBUG] Pas encore de bonus (Objectif: 10, Actuel: ${count})`);
      }
    } else {
      console.log(`[DEBUG] ⚠️ ERREUR CRITIQUE: Impossible de relire la ligne daily_activity juste après insertion.`);
    }
    // =========================================================================

    // 7) Fin de promo ?
    if (newVues >= promotion.vues_potentielles || newBudget < montant) {
      await connection.execute(
        'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
        ['termine', promotionId]
      );
      await notifyClientOfFinishedPromotion(promotionId, connection, req);
    }

    await connection.commit();
    console.log(`[DEBUG] ✅ Transaction validée avec succès.\n`);
    res.status(200).json({ message: 'Vue comptabilisée et budget déduit.' });

  } catch (error) {
    await connection.rollback();
    console.error("\n[DEBUG] ❌ ERREUR CRITIQUE dans viewPromotion:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    connection.release();
  }
};
// Récupère l'historique des promotions que l'utilisateur a likées ou partagées
exports.getPromotionsHistorique = async (req, res) => {
  const userId = req.user.id;
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // On ajoute 'vue' dans la liste des interactions
    const [promotions] = await pool.execute(
      `SELECT DISTINCT p.*, i.type_interaction, i.date_interaction
       FROM promotions p
       JOIN interactions i ON p.id = i.id_promotion
       WHERE i.id_utilisateur = ? 
         AND i.type_interaction IN ('like', 'partage', 'vue')
       ORDER BY i.date_interaction DESC`,
      [userId]
    );

    if (promotions.length === 0) return res.status(200).json([]);

    // Formatage URL
    const promotionsWithUrls = promotions.map(promo => ({
       ...promo,
       url_video: promo.url_video ? `${baseUrl}/uploads/videos/${promo.url_video}` : null,
       thumbnail_url: promo.thumbnail_url ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}` : null,
    }));

    return res.status(200).json(promotionsWithUrls);
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
// exports.withdrawEarnings = async (req, res) => {
//   const userId = req.user.id;
//   // 1. Récupérer le montant depuis le corps de la requête
//   const { operator, phoneNumber, amount } = req.body; 

//   // 2. Valider le montant
//   if (!amount || isNaN(amount) || Number(amount) <= 0) {
//     return res.status(400).json({ message: 'Un montant valide est requis.' });
//   }
//   const withdrawalAmount = Number(amount);

//   if (!operator || !phoneNumber) {
//     return res.status(400).json({ message: 'L\'opérateur et le numéro de téléphone sont requis.' });
//   }

//   const connection = await pool.getConnection();

//   try {
//     await connection.beginTransaction();

//     const [userRows] = await connection.execute(
//       'SELECT remuneration_utilisateur, contact FROM utilisateurs WHERE id = ? FOR UPDATE',
//       [userId]
//     );

//     if (userRows.length === 0) {
//       await connection.rollback();
//       return res.status(404).json({ message: 'Utilisateur non trouvé.' });
//     }

//     const solde = Number(userRows[0].remuneration_utilisateur || 0);

//     // 3. Vérifier que le montant demandé ne dépasse pas le solde
//     if (withdrawalAmount > solde) {
//       await connection.rollback();
//       return res.status(400).json({ message: 'Le montant demandé dépasse votre solde disponible.' });
//     }

//     // 4. Insérer la demande avec le montant spécifié
//     await connection.execute(
//       'INSERT INTO demandes_retrait (id_utilisateur, montant, operateur_mobile, statut) VALUES (?, ?, ?, ?)',
//       [userId, withdrawalAmount, operator, 'en_attente']
//     );

//     // 5. Déduire le montant retiré du solde de l'utilisateur
//     await connection.execute(
//       'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur - ? WHERE id = ?',
//       [withdrawalAmount, userId]
//     );

//     if (phoneNumber !== userRows[0].contact) {
//       await connection.execute(
//         'UPDATE utilisateurs SET contact = ? WHERE id = ?',
//         [phoneNumber, userId]
//       );
//     }

//     await connection.commit();

//     res.status(200).json({ 
//       message: 'Demande de retrait enregistrée !', 
//       montant: withdrawalAmount 
//     });

//   } catch (error) {
//     await connection.rollback();
//     console.error("Erreur withdrawEarnings:", error);
//     res.status(500).json({ message: 'Erreur serveur' });
//   } finally {
//     connection.release();
//   }
// };
// --- FONCTION DE RETRAIT AUTOMATISÉ VIA CINETPAY ---
async function getCinetPayToken() {
  const formData = new FormData();
  // On trim() pour éviter les espaces invisibles qui causent des erreurs
  formData.append('apikey', String(process.env.CINETPAY_APIKEY).trim());
  formData.append('password', String(process.env.CINETPAY_SECRET_KEY).trim());

  try {
    const response = await axios.post('https://client.cinetpay.com/v1/auth/login', formData, {
      headers: formData.getHeaders(),
      httpsAgent: httpsAgent // <--- AJOUTE CECI
    });
    if (String(response.data.code) === '0') {
      return response.data.data?.token || response.data.token;
    } else {
      throw new Error(`Auth CinetPay échouée: ${response.data.message}`);
    }
  } catch (error) {
    console.error("Erreur Auth CinetPay:", error.message);
    throw error;
  }
}
const httpsAgent = new https.Agent({ family: 4 });
exports.withdrawEarnings = async (req, res) => {
  const userId = req.user.id;
  const { operator, phoneNumber, amount } = req.body;

  // --- 1. VALIDATIONS ---
  const withdrawalAmount = parseInt(amount, 10);

  if (!amount || isNaN(amount) || withdrawalAmount <= 0) {
    return res.status(400).json({ message: 'Veuillez entrer un montant valide.' });
  }

  if (withdrawalAmount < 200) {
    return res.status(400).json({
      message: `Le montant minimum de retrait est de 200 XOF.`,
      details: `Le montant minimum pour cette transaction est de 200 XOF.`
    });
  }

  if (!operator || !phoneNumber) {
    return res.status(400).json({ message: 'L\'opérateur et le numéro de téléphone sont requis.' });
  }

  // --- 2. NETTOYAGE NUMÉRO ---
  let cleanPhone = phoneNumber.replace(/\D/g, '');
  if (cleanPhone.startsWith('225') && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(3);
  if (cleanPhone.startsWith('00225')) cleanPhone = cleanPhone.slice(5);

  if (!/^\d{10}$/.test(cleanPhone)) {
    return res.status(400).json({ message: 'Numéro invalide. Format attendu : 10 chiffres (ex: 0708325027).' });
  }

  const transactionId = Date.now().toString() + Math.floor(Math.random() * 1000);
  const connection = await pool.getConnection();
  let isCommitted = false;

  try {
    await connection.beginTransaction();

    // --- 3. DÉBIT BDD ---
    const [userRows] = await connection.execute(
      'SELECT remuneration_utilisateur, nom, prenom, email FROM utilisateurs WHERE id = ? FOR UPDATE',
      [userId]
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    const user = userRows[0];
    const solde = Number(user.remuneration_utilisateur || 0);

    if (withdrawalAmount > solde) {
      await connection.rollback();
      return res.status(400).json({ message: 'Solde insuffisant.' });
    }

    // Débit du solde
    await connection.execute(
      'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur - ? WHERE id = ?',
      [withdrawalAmount, userId]
    );

    // Création de l'historique (EN_COURS)
    await connection.execute(
      'INSERT INTO demandes_retrait (id_utilisateur, montant, operateur_mobile, statut, date_demande, transaction_id) VALUES (?, ?, ?, ?, NOW(), ?)',
      [userId, withdrawalAmount, operator, 'en_cours', transactionId]
    );
// --- AJOUT NOTIFICATION : RETRAIT INITIÉ ---
    await notificationService.envoyerNotification(
      userId,
      'retrait_initie',
      'Demande de retrait',
      `En cours de traitement... ${withdrawalAmount} Fcfa`,
      { montant: withdrawalAmount, transaction_id: transactionId }
    ).catch(err => console.error('Erreur notification retrait_initie:', err));
    // -------------------------------------------
    await connection.commit();
    isCommitted = true;
    // IMPORTANT : On relâche cette connexion maintenant, on n'en a plus besoin pour la suite
    connection.release();

    // --- 4. APPEL CINETPAY ---
    try {
      console.log(`🔐 Authentification CinetPay pour transaction ${transactionId}...`);
      const token = await getCinetPayToken();

      // ... (Préparation des contacts identique) ...
      const emailContact = user.email || 'client@pubcash.com';
      const sanitizeName = (str) => (str || '').replace(/[^a-zA-Z0-9 ]/g, '').trim();
      const nomContact = sanitizeName(user.nom) || 'Client';
      const prenomContact = sanitizeName(user.prenom) || 'PubCash';
      const paymentMethod = operator === 'wave' ? 'WAVECI' : null;
      let notifyUrl = process.env.PRODUCTION_URL
        ? `${process.env.PRODUCTION_URL}/api/callbacks/cinetpay/withdrawal`
        : 'https://pub-cash.com/api/callbacks/cinetpay/withdrawal';

      // Ajout contact (Silencieux)
      const paramsContact = new URLSearchParams();
      paramsContact.append('data', JSON.stringify([{
        prefix: '225', phone: cleanPhone, name: prenomContact, surname: nomContact, email: emailContact
      }]));
      await axios.post(`https://client.cinetpay.com/v1/transfer/contact?token=${token}&lang=fr`, paramsContact, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent: httpsAgent
      }).catch(() => { });

      // Transfert
      const transferObject = {
        amount: String(withdrawalAmount),
        phone: cleanPhone,
        prefix: '225',
        notify_url: notifyUrl,
        client_transaction_id: transactionId,
        email: emailContact,
        name: nomContact,
        surname: prenomContact,
        ...(paymentMethod && { payment_method: paymentMethod })
      };

      const paramsTransfer = new URLSearchParams();
      paramsTransfer.append('data', JSON.stringify([transferObject]));

      console.log(`📤 Envoi des fonds vers ${cleanPhone}...`);

      const configTransfer = {
        method: 'post',
        url: `https://client.cinetpay.com/v1/transfer/money/send/contact?token=${token}&lang=fr&transaction_id=${transactionId}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: paramsTransfer,
        httpsAgent: httpsAgent
      };

      const apiResponse = await axios(configTransfer);
      const result = apiResponse.data;

      console.log("📨 Réponse CinetPay:", JSON.stringify(result));

      // CinetPay renvoie parfois "0" (string) ou 0 (int). On convertit en string pour être sûr.
      if (String(result.code) === '0') {

        // --- CORRECTION CRUCIALE ICI ---
        // On utilise `pool.execute` au lieu de `connection.execute` pour éviter les timeouts
        console.log(`✅ Succès CinetPay. Mise à jour BDD vers 'traite'...`);

        await pool.execute(
          'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
          ['traite', transactionId]
        );

    // --- AJOUT NOTIFICATION : RETRAIT COMPLÉTÉ ---
        await notificationService.envoyerNotification(
          userId,
          'retrait_complete',
          'Demande de retrait',
          `Validé ✓ ${withdrawalAmount} Fcfa`,
          { montant: withdrawalAmount, transaction_id: transactionId, statut: 'succes' }
        ).catch(err => console.error('Erreur notification retrait_complete:', err));
        // ---------------------------------------------

        return res.status(200).json({ message: 'Retrait effectué avec succès !' });

      } else {
        throw { response: { data: result } };
      }

    } catch (apiError) {
      console.error("❌ ECHEC TRANSFERT:", apiError.response?.data || apiError.message);

      try {
        await pool.execute(
          'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur + ? WHERE id = ?',
          [withdrawalAmount, userId]
        );

        await pool.execute(
          'UPDATE demandes_retrait SET statut = ?, erreur_details = ?, date_traitement = NOW() WHERE transaction_id = ?',
          ['rejete', String(apiError.response?.data?.message || apiError.message).slice(0, 250), transactionId]
        );
      } catch (sqlErr) {
        console.error("🚨 CRITIQUE: Erreur lors du remboursement BDD:", sqlErr);
      }

      const responseData = apiError.response?.data || {};
      const errorCode = responseData.data?.[0]?.code || responseData.code || 'UNKNOWN';

      return res.status(500).json({
        message: 'Le transfert a échoué. Vous avez été remboursé.',
        details: `CinetPay Code: ${errorCode}`
      });
    }

  } catch (error) {
    if (!isCommitted && connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("💥 Erreur Critique Serveur:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Erreur serveur interne inattendue.' });
    }
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

exports.getPromotionById = async (req, res) => {
  const { promotionId } = req.params;

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // On récupère la promo avec les infos du client et du pack
    const [rows] = await pool.execute(
      `SELECT p.*, c.nom as client_nom, pk.nom_pack 
       FROM promotions p
       JOIN clients c ON p.id_client = c.id
       JOIN packs pk ON p.id_pack = pk.id
       WHERE p.id = ?`,
      [promotionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Promotion non trouvée' });
    }

    const promo = rows[0];

    // On formate les URLs comme dans les autres fonctions
    const promoWithUrls = {
      ...promo,
      url_video: promo.url_video && !promo.url_video.startsWith('http')
        ? `${baseUrl}/uploads/videos/${promo.url_video}`
        : promo.url_video,
      thumbnail_url: promo.thumbnail_url && !promo.thumbnail_url.startsWith('http')
        ? `${baseUrl}/uploads/thumbnails/${promo.thumbnail_url}`
        : promo.thumbnail_url
    };

    res.status(200).json(promoWithUrls);

  } catch (error) {
    console.error("Erreur getPromotionById:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};