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
  // userCommune correspond à 'commune_choisie' dans la table utilisateurs
  const userCommune = req.user.commune_choisie || null;
  const filter = req.query.filter || 'ma_commune'; // Filtre venant de l'UI utilisateur

  try {
    // 1. Récupération âge
    const [userData] = await pool.execute('SELECT date_naissance FROM utilisateurs WHERE id = ?', [userId]);
    if (!userData.length || !userData[0].date_naissance) {
      return res.status(403).json({ message: "Votre profil est incomplet (date de naissance manquante)." });
    }
    const user = userData[0];
    const birthDate = new Date(user.date_naissance);
    const age = new Date(Date.now() - birthDate.getTime()).getUTCFullYear() - 1970;

    const params = [];

    let query = `
          SELECT 
              p.*, 
              c.nom_utilisateur as client_nom_utilisateur, 
              c.commune as client_commune,
              pk.remuneration AS remuneration_pack,
              pk.nom_pack,
              g.id as game_id, g.type as game_type, g.points_recompense,
              g.question, g.reponses, g.bonne_reponse
          FROM promotions p
          JOIN clients c ON p.id_client = c.id
          JOIN packs pk ON p.id_pack = pk.id
          LEFT JOIN games g ON p.id = g.promotion_id AND g.statut = 'actif'
          WHERE p.statut = 'en_cours' 
            AND p.budget_restant > 0
            
            -- FILTRE ÂGE (INCHANGÉ)
            AND (
                p.tranche_age = 'tous'
                OR (p.tranche_age = '12-17' AND ? BETWEEN 12 AND 17)
                OR (p.tranche_age = '18+' AND ? >= 18)
            )
            
            -- NOUVEAU FILTRE CIBLAGE COMMUNE
            -- 1. Si la promo cible 'toutes', tout le monde la voit.
            -- 2. Si la promo cible une commune spécifique (ex: 'Yopougon'), seul l'user de 'Yopougon' la voit.
            AND (
                p.ciblage_commune = 'toutes' 
                OR p.ciblage_commune = ?
            )
    `;

    // Paramètres pour l'âge et la commune
    params.push(age, age, userCommune);

    // --- FILTRES SUPPLÉMENTAIRES (UI) ---
    // Si l'utilisateur clique sur "Ma Commune" dans l'appli, il veut voir SEULEMENT les promos de sa commune
    // et pas celles qui sont nationales ('toutes').
    if (filter === 'ma_commune' && userCommune) {
      query += ` AND p.ciblage_commune = ?`;
      params.push(userCommune);
    }
    // Si l'utilisateur veut voir tout ce qui est disponible pour lui (National + Local)
    else if (filter === 'toutes') {
      // Pas de restriction supplémentaire, la clause WHERE de base suffit
    }
    else if (filter === 'argent') {
      query += ` AND pk.remuneration = 50`;
    }
    else if (filter === 'gold') {
      query += ` AND pk.remuneration = 75`;
    }
    else if (filter === 'diamant') {
      query += ` AND pk.remuneration = 100`;
    }

    // Exclusion des vues déjà faites (inchangé)
    query += ` AND NOT EXISTS (
        SELECT 1 FROM interactions i 
        WHERE i.id_promotion = p.id 
        AND i.id_utilisateur = ? 
        AND i.type_interaction IN ('vue', 'annulé') 
    )`;
    params.push(userId);

    query += ` ORDER BY p.date_creation DESC`;

    const [promotions] = await pool.execute(query, params);

    // Formatage (inchangé)
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

    // 1. VÉRIFICATION D'ÉLIGIBILITÉ
    const eligibilityQuery = `
      SELECT p.id, p.ciblage_commune
      FROM promotions p
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
            OR p.ciblage_commune = u.commune_choisie
        )
    `;

    const [eligiblePromo] = await connection.execute(eligibilityQuery, [userId, promotionId]);

    if (eligiblePromo.length === 0) {
      await connection.rollback();
      return res.status(403).json({ message: 'Non éligible pour cette promotion.' });
    }

    // 2. Vérifier si l'interaction est un doublon
    const [existing] = await connection.execute(
      'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
      [userId, promotionId, interactionType]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(200).json({ message: `Interaction '${interactionType}' déjà enregistrée.` });
    }

    // 3. Insérer l'interaction (Like ou Partage uniquement)
    await connection.execute(
      'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
      [userId, promotionId, interactionType]
    );

    // 4. Mettre à jour compteur
    const columnName = interactionType === 'partage' ? 'partages' : 'likes';
    await connection.execute(`UPDATE promotions SET ${columnName} = ${columnName} + 1 WHERE id = ?`, [promotionId]);

    // --- ICI : ON NE FAIT PLUS RIEN D'AUTRE ---
    // On attend que le mobile appelle /view pour donner l'argent.

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
    // 1. VÉRIFICATION : Est-ce que l'utilisateur a déjà commenté cette promotion ?
    const [existing] = await pool.execute(
      'SELECT id FROM commentaires WHERE id_utilisateur = ? AND id_promotion = ?',
      [userId, promotionId]
    );

    if (existing.length > 0) {
      // Si oui, on bloque et on renvoie une erreur
      return res.status(403).json({ message: 'Vous avez déjà commenté cette promotion.' });
    }

    // 2. Si non, on procède à l'insertion
    await pool.execute(
      'INSERT INTO commentaires (id_utilisateur, id_promotion, commentaire) VALUES (?, ?, ?)',
      [userId, promotionId, commentaire]
    );

    res.status(201).json({ message: 'Commentaire ajouté.' });

  } catch (error) {
    console.error("Erreur addComment:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Vérifier si l'utilisateur a déjà commenté
exports.hasComment = async (req, res) => {
  const { promotionId } = req.params;
  const userId = req.user.id;

  try {
    const [rows] = await pool.execute(
      'SELECT id FROM commentaires WHERE id_utilisateur = ? AND id_promotion = ?',
      [userId, promotionId]
    );

    // AJOUTE CE LOG DANS TON TERMINAL BACKEND POUR VÉRIFIER
    console.log(`[DEBUG] hasComment User:${userId} Promo:${promotionId} Found:${rows.length}`);

    res.status(200).json({ hasComment: rows.length > 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// --- NOUVELLE FONCTION CRUCIALE POUR LES VUES ET LE BUDGET ---
exports.viewPromotion = async (req, res) => {
  const { promotionId } = req.params;
  const userId = req.user.id;
  const { device_id } = req.body;

  const connection = await pool.getConnection();

  console.log(`\n--- [DEBUG] viewPromotion | User: ${userId} | Promo: ${promotionId} | Device: ${device_id} ---`);

  try {
    await connection.beginTransaction();

    // 1. VÉRIFICATION PRÉALABLE : L'utilisateur a-t-il Liké ET Partagé ?
    const [conditions] = await connection.execute(
      `SELECT COUNT(DISTINCT type_interaction) as count 
         FROM interactions 
         WHERE id_utilisateur = ? 
         AND id_promotion = ? 
         AND type_interaction IN ('like', 'partage')`,
      [userId, promotionId]
    );

    if (conditions[0].count < 2) {
      await connection.rollback();
      console.log(`[DEBUG] 🚫 Refusé : L'utilisateur n'a pas fini les étapes.`);
      return res.status(400).json({ message: "Vous devez Liker et Partager avant de valider la vue." });
    }

    // 2. SÉCURITÉ DEVICE ID & NETTOYAGE FRAUDE
    if (device_id) {
      const [deviceCheck] = await connection.execute(
        `SELECT id FROM interactions 
             WHERE id_promotion = ? 
             AND type_interaction = 'vue' 
             AND device_id = ?`,
        [promotionId, device_id]
      );

      if (deviceCheck.length > 0) {
        console.log(`[DEBUG] 🚫 Fraude Device ID détectée.`);

        // --- DEBUT DU NETTOYAGE ---
        // On considère que s'il fraude, ses likes et partages ne valent rien.

        // A. On décrémente les compteurs de la promotion (pour que le promoteur ait les vrais chiffres)
        // On utilise GREATEST(x-1, 0) pour ne jamais descendre en dessous de 0
        await connection.execute(
          `UPDATE promotions 
                 SET likes = GREATEST(likes - 1, 0), 
                     partages = GREATEST(partages - 1, 0) 
                 WHERE id = ?`,
          [promotionId]
        );

        // B. On supprime ses interactions 'like' et 'partage' de la table interactions
        await connection.execute(
          `DELETE FROM interactions 
                 WHERE id_utilisateur = ? 
                 AND id_promotion = ? 
                 AND type_interaction IN ('like', 'partage')`,
          [userId, promotionId]
        );

        // C. On COMMIT (Sauvegarde) ce nettoyage avant de rejeter
        await connection.commit();
        // --- FIN DU NETTOYAGE ---

        return res.status(403).json({
          message: 'Cet appareil a déjà bénéficié de cette offre promotionnelle.'
        });
      }
    }

    // 3. Vérifier doublon Utilisateur (Au cas où il change de téléphone)
    const [existing] = await connection.execute(
      'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
      [userId, promotionId, 'vue']
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(200).json({ message: 'Vue déjà comptabilisée.' });
    }

    // 4. Récupérer Promo & Budget
    const [promoRows] = await connection.execute(
      `SELECT p.id, p.budget_restant, p.vues, p.vues_potentielles, p.id_pack, 
              p.url_video, p.thumbnail_url, p.titre,
              pk.remuneration, pk.nom_pack
          FROM promotions p
          JOIN packs pk ON p.id_pack = pk.id
          WHERE p.id = ? AND p.statut = 'en_cours' FOR UPDATE`,
      [promotionId]
    );

    const promotion = promoRows[0];
    if (!promotion) {
      await connection.rollback();
      return res.status(404).json({ message: 'Promotion introuvable ou terminée.' });
    }

    const montant = Number(promotion.remuneration || 0);

    // 5. Vérifier Budget
    if (promotion.budget_restant < montant) {
      await connection.execute(
        'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
        ['termine', promotionId]
      );
      await notifyClientOfFinishedPromotion(promotionId, connection, req);
      await connection.commit();
      return res.status(400).json({ message: 'Budget épuisé.' });
    }

    // 6. ENREGISTREMENT VUE
    console.log(`[DEBUG] ✅ Validation Vue + Gain (${montant} FCFA)`);
    await connection.execute(
      'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction, device_id) VALUES (?, ?, ?, ?)',
      [userId, promotionId, 'vue', device_id]
    );

    // 7. Mise à jour Promotion
    const newVues = promotion.vues + 1;
    const newBudget = Number(promotion.budget_restant) - montant;
    await connection.execute(
      'UPDATE promotions SET vues = ?, budget_restant = ? WHERE id = ?',
      [newVues, newBudget, promotionId]
    );

    // 8. Créditer Utilisateur
    await connection.execute(
      'UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur,0) + ? WHERE id = ?',
      [montant, userId]
    );
    await connection.execute(
      'INSERT INTO user_gains (id_utilisateur, id_promotion, montant, type_gain) VALUES (?, ?, ?, ?)',
      [userId, promotionId, montant, 'vue']
    );

    // 9. Bonus Parrainage
    if (promotion.nom_pack?.toLowerCase() === 'diamant') {
      const [userRows] = await connection.execute('SELECT parrain_id FROM utilisateurs WHERE id = ?', [userId]);
      if (userRows.length > 0 && userRows[0].parrain_id) {
        await connection.execute('UPDATE utilisateurs SET points = points + 5 WHERE id = ?', [userRows[0].parrain_id]);
        await connection.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())', [userRows[0].parrain_id, 5, 'bonus_parrainage_diamant']);
      }
    }

    // 10. Bonus Quotidien
    const today = new Date().toISOString().split('T')[0];
    await connection.execute(`
        INSERT INTO daily_activity (user_id, date, videos_watched) 
        VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE videos_watched = videos_watched + 1
    `, [userId, today]);

    const [activityRows] = await connection.execute(
      'SELECT videos_watched FROM daily_activity WHERE user_id = ? AND date = ?',
      [userId, today]
    );
    if (activityRows.length > 0 && activityRows[0].videos_watched === 10) {
      await connection.execute('UPDATE utilisateurs SET points = COALESCE(points, 0) + 5 WHERE id = ?', [userId]);
      await connection.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, 5, ?, NOW())', [userId, 'bonus_10_videos_jour']);
    }

    // 11. Notification
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fullVideoUrl = promotion.url_video && !promotion.url_video.startsWith('http')
      ? `${baseUrl}/uploads/videos/${promotion.url_video}`
      : promotion.url_video;
    const fullThumbnailUrl = promotion.thumbnail_url && !promotion.thumbnail_url.startsWith('http')
      ? `${baseUrl}/uploads/thumbnails/${promotion.thumbnail_url}`
      : promotion.thumbnail_url;

    notificationService.envoyerNotification(
      userId,
      'video_regardee',
      'Félicitations !',
      `Vous avez gagné ${montant} FCFA`,
      {
        montant,
        promotion_id: promotionId,
        url_video: fullVideoUrl,
        thumbnail_url: fullThumbnailUrl,
        titre: promotion.titre
      }
    ).catch(e => console.error("Err Notif Background:", e)); // On catch l'erreur ici pour ne pas crasher

    // 12. Fin de promo ?
    if (newVues >= promotion.vues_potentielles || newBudget < montant) {
      await connection.execute(
        'UPDATE promotions SET statut = ?, date_fin = NOW() WHERE id = ?',
        ['termine', promotionId]
      );
      // Pareil ici, pas de await si possible, ou on laisse car c'est rare
      notifyClientOfFinishedPromotion(promotionId, connection, req).catch(e => console.error(e));
    }

    await connection.commit();

    // === MODIFICATION ICI ===
    // On renvoie le montant au mobile pour l'affichage immédiat
    res.status(200).json({
      success: true,
      message: 'Vue validée avec succès.',
      montant: montant  // <--- AJOUT IMPORTANT
    });

  } catch (error) {
    await connection.rollback();
    console.error("\n[DEBUG] ❌ Erreur viewPromotion:", error);
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
      `SELECT DISTINCT 
          p.*, 
          i.type_interaction, 
          i.date_interaction,
          c.id as id_client,                -- AJOUT CRUCIAL
          c.nom_entreprise as nom_promoteur, -- AJOUT CRUCIAL
          c.profile_image_url as photo_promoteur -- AJOUT CRUCIAL
       FROM promotions p
       JOIN interactions i ON p.id = i.id_promotion
       JOIN clients c ON p.id_client = c.id  -- JOINTURE AJOUTÉE
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
      message: `Le montant minimum de retrait est de 200 XOF. Veuillez augmenter votre demande.`,
      details: `Le montant minimum pour cette transaction est de 200 XOF.`
    });
  }

  if (!operator || !phoneNumber) {
    return res.status(400).json({ message: 'L\'opérateur et le numéro de téléphone sont requis.' });
  }

  // 2. NETTOYAGE NUMÉRO
  let cleanPhone = phoneNumber.replace(/\D/g, '');
  if (cleanPhone.startsWith('225') && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(3);
  if (cleanPhone.startsWith('00225')) cleanPhone = cleanPhone.slice(5);

  if (!/^\d{10}$/.test(cleanPhone)) {
    return res.status(400).json({ message: 'Le numéro de téléphone est invalide. Format attendu : 10 chiffres (ex: 0708325027).' });
  }

  const transactionId = Date.now().toString() + Math.floor(Math.random() * 1000);
  const connection = await pool.getConnection();
  let isCommitted = false; // Flag pour la gestion des erreurs

  try {
    await connection.beginTransaction();

    // 3. DÉBIT BDD (avec verrouillage)
    const [userRows] = await connection.execute(
      'SELECT remuneration_utilisateur, nom, prenom, email FROM utilisateurs WHERE id = ? FOR UPDATE',
      [userId]
    );

    // Vérification Solde PubCash
    const user = userRows[0];
    const solde = Number(user.remuneration_utilisateur || 0);

    if (withdrawalAmount > solde) {
      await connection.rollback();
      return res.status(400).json({ message: 'Le montant demandé dépasse votre solde PubCash disponible.' });
    }

    // Débit du solde
    await connection.execute(
      'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur - ? WHERE id = ?',
      [withdrawalAmount, userId]
    );

    // Création de l'historique (Statut initial: EN_COURS)
    await connection.execute(
      `INSERT INTO demandes_retrait 
       (id_utilisateur, montant, operateur_mobile, statut, date_demande, transaction_id, numero_telephone) 
       VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
      [userId, withdrawalAmount, operator, 'en_cours', transactionId, cleanPhone]
    );

    await connection.commit();
    isCommitted = true;
    connection.release();

    // 4. APPEL CINETPAY
    try {
      console.log("🔐 Authentification CinetPay...");
      const token = await getCinetPayToken();

      // Infos utilisateur
      const emailContact = user.email || 'client@pubcash.com';
      const nomContact = user.nom || 'Client';
      const prenomContact = user.prenom || 'PubCash';
      const paymentMethod = operator === 'wave' ? 'WAVECI' : null;

      // Notification URL (Doit être pub-cash.com en prod)
      let notifyUrl = `${process.env.PRODUCTION_URL}/api/callbacks/cinetpay/withdrawal`;
      if (!process.env.PRODUCTION_URL || notifyUrl.includes('votredomaine.com')) {
        notifyUrl = 'https://pub-cash.com/api/callbacks/cinetpay/withdrawal';
      }

      // A. AJOUT DU CONTACT
      const paramsContact = new URLSearchParams();
      paramsContact.append('data', JSON.stringify([{
        prefix: '225', phone: cleanPhone, name: prenomContact, surname: nomContact, email: emailContact
      }]));

      await axios.post(`https://client.cinetpay.com/v1/transfer/contact?token=${token}&lang=fr`, paramsContact, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).catch(() => { });

      // B. TRANSFERT
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

      console.log(`📤 Envoi vers +225 ${cleanPhone} (Ref: ${transactionId})...`);

      const configTransfer = {
        method: 'post',
        url: `https://client.cinetpay.com/v1/transfer/money/send/contact?token=${token}&lang=fr&transaction_id=${transactionId}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: paramsTransfer
      };

      const apiResponse = await axios(configTransfer);
      const result = apiResponse.data;

      console.log("✅ Réponse CinetPay:", JSON.stringify(result));

      // 5. MISE À JOUR DU STATUT (Utilisation de pool.execute car la connexion est relâchée)
      if (String(result.code) === '0') {

        // Mise à jour de 'en_cours' à 'traite'
        await pool.execute(
          'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
          ['traite', transactionId]
        );

        // Envoi de la notification
        await notificationService.envoyerNotification(
          userId,
          'retrait_complete',
          'Retrait réussi',
          `Validé ✓ ${withdrawalAmount} Fcfa`,
          { montant: withdrawalAmount, transaction_id: transactionId, statut: 'succes', operator: operator, numero_telephone: cleanPhone }
        ).catch(err => console.error('Erreur notification retrait_complete:', err));

        return res.status(200).json({ message: 'Retrait effectué avec succès !' });

      } else {
        // Si le code n'est pas 0, on jette une erreur pour passer au bloc catch.
        throw { response: { data: result } };
      }

    } catch (apiError) {
      console.error("❌ ERREUR CINETPAY:", apiError.response?.data || apiError.message);
      const responseData = apiError.response?.data || {};
      const errorCode = responseData.data?.[0]?.code || responseData.code || 'UNKNOWN';

      // --- GESTION DES ERREURS PROFESSIONNELLES ---
      let professionalMessage = 'Erreur inattendue. Veuillez contacter l\'administrateur.';

      switch (errorCode) {
        // Erreur de fonds CinetPay insuffisants (Code 602 est un code CinetPay générique)
        case 602: // INSUFFICIENT_BALANCE
        case 722:
        case 'ERROR_PM_AMOUNT':
          professionalMessage = 'Transaction non disponible : Le service de retrait est momentanément indisponible.';
          break;

        case 725:
        case 726:
          professionalMessage = `Le numéro de téléphone ${cleanPhone} est incorrect ou inactif. Veuillez vérifier votre numéro.`;
          break;

        // Cas 5 : Opérateur indisponible
        case 727:
        case 728:
          professionalMessage = `L'opérateur ${operator.toUpperCase()} est indisponible. Veuillez réessayer plus tard.`;
          break;

        default:
          // Toutes les autres erreurs inconnues (garder un message de type 500)
          professionalMessage = 'Erreur serveur inattendue. Veuillez contacter le support.';
          break;
      }

      // REMBOURSEMENT UTILISATEUR
      await pool.execute(
        'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur + ? WHERE id = ?',
        [withdrawalAmount, userId]
      );
      // Mise à jour statut REJETE
      await pool.execute(
        'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
        ['rejete', transactionId]
      );

      // Envoi de la notification de rejet
      await notificationService.envoyerNotification(
        userId, 'retrait_echec', 'Échec du retrait', `Le transfert a échoué. ${withdrawalAmount} Fcfa remboursés.`,
        { montant: withdrawalAmount, transaction_id: transactionId, statut: 'echec', operator: operator, numero_telephone: cleanPhone }
      ).catch(err => console.error('Erreur notification retrait_echec:', err));

      // 🛑 RENVOI UN STATUT 400 POUR LES ERREURS DE VALIDATION
      return res.status(400).json({
        message: professionalMessage, // <--- Le message clair
        details: `CinetPay Code: ${errorCode}` // <--- Le détail technique pour le débug
      });
    }

  } catch (error) {
    // Si la transaction n'a jamais été commitée (erreur avant l'appel CinetPay), on rollback
    if (!isCommitted && connection) {
      await connection.rollback();
      connection.release();
    } else if (connection && !isCommitted) {
      connection.release();
    }
    console.error("💥 Erreur serveur:", error);
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
          operateur_mobile as operator,
          transaction_id,    -- 👈 Pour corriger le N/A
          numero_telephone   -- 👈 Pour afficher le destinataire
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
// --- NOUVELLE FONCTION : ANNULER / MASQUER UNE PROMOTION ---
exports.cancelPromotion = async (req, res) => {
  const { promotionId } = req.params;
  const userId = req.user.id;

  try {
    // 1. Vérifier si l'interaction existe déjà pour éviter les doublons
    const [existing] = await pool.execute(
      'SELECT id FROM interactions WHERE id_utilisateur = ? AND id_promotion = ? AND type_interaction = ?',
      [userId, promotionId, 'annulé']
    );

    if (existing.length > 0) {
      return res.status(200).json({ message: 'Promotion déjà annulée.' });
    }

    // 2. Insérer l'interaction 'annulé'
    await pool.execute(
      'INSERT INTO interactions (id_utilisateur, id_promotion, type_interaction) VALUES (?, ?, ?)',
      [userId, promotionId, 'annulé']
    );

    res.status(200).json({ message: 'Promotion masquée avec succès.' });

  } catch (error) {
    console.error("Erreur cancelPromotion:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- NOUVELLE FONCTION : CONVERTIR POINTS EN FCFA ---
exports.convertPoints = async (req, res) => {
  const userId = req.user.id;
  const { points, amount } = req.body;

  if (!points || !amount || points <= 0 || amount <= 0) {
    return res.status(400).json({ message: 'Données de conversion invalides.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Vérifier le solde de points actuel de l'utilisateur
    const [userRows] = await connection.execute(
      'SELECT points, remuneration_utilisateur FROM utilisateurs WHERE id = ? FOR UPDATE',
      [userId]
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const currentPoints = userRows[0].points || 0;

    if (currentPoints < points) {
      await connection.rollback();
      return res.status(400).json({ message: 'Solde de points insuffisant.' });
    }

    // 2. Déduire les points et ajouter l'argent
    await connection.execute(
      'UPDATE utilisateurs SET points = points - ?, remuneration_utilisateur = remuneration_utilisateur + ? WHERE id = ?',
      [points, amount, userId]
    );

    // 3. Enregistrer dans l'historique des gains (user_gains)
    await connection.execute(
      'INSERT INTO user_gains (id_utilisateur, montant, type_gain, details) VALUES (?, ?, ?, ?)',
      [userId, amount, 'conversion_points', `Échange de ${points} points`]
    );

    // 4. Trace dans game_history avec un montant négatif de points
    await connection.execute(
      'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
      [userId, -points, 'conversion_en_fcfa']
    );

    await connection.commit();

    // 5. Envoyer une notification de succès
    notificationService.envoyerNotification(
      userId,
      'points_convertis',
      'Conversion réussie ! 💰',
      `Vous avez reçu ${amount} FCFA sur votre solde.`,
      { amount, points, newPoints: currentPoints - points }
    ).catch(e => console.error("Erreur notification conversion:", e));

    res.status(200).json({
      success: true,
      message: `Bravo ! Vous avez reçu ${amount} FCFA.`,
      newPoints: currentPoints - points
    });

  } catch (error) {
    await connection.rollback();
    console.error("Erreur convertPoints:", error);
    res.status(500).json({ message: 'Erreur serveur lors de la conversion.' });
  } finally {
    connection.release();
  }
};