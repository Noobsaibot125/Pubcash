// pubcash-api/src/controllers/promotionController.js
const axios = require('axios');
const pool = require('../config/db');
const { sendPromotionFinishedEmail } = require('../services/emailService');
const { v4: uuidv4 } = require('uuid');
const https = require('https'); // <--- AJOUTE CETTE LIGNE
const FormData = require('form-data');
const { URLSearchParams } = require('url');
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
  // Simule l'entrée utilisateur standard
  const { operator, phoneNumber, amount } = req.body;

  // --- 1. VALIDATIONS CÔTÉ SERVEUR (Pour l'utilisateur) ---
  const withdrawalAmount = parseInt(amount, 10);

  if (!amount || isNaN(amount) || withdrawalAmount <= 0) {
    return res.status(400).json({ message: 'Veuillez entrer un montant valide.' });
  }

  // Cas 1 : Montant en dessous du minimum réel (200 XOF)
  if (withdrawalAmount < 200) {
    return res.status(400).json({
      message: `Le montant minimum de retrait est de 200 XOF. Veuillez augmenter votre demande.`,
      details: `Le montant minimum pour cette transaction (incluant les frais) est de 200 XOF.`
    });
  }

  if (!operator || !phoneNumber) {
    return res.status(400).json({ message: 'L\'opérateur et le numéro de téléphone sont requis.' });
  }

  // 2. NETTOYAGE NUMÉRO (CI : 10 Chiffres)
  let cleanPhone = phoneNumber.replace(/\D/g, '');

  // Retire le 225 ou 00225 si présent, pour ne garder que le numéro local
  if (cleanPhone.startsWith('225') && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(3);
  if (cleanPhone.startsWith('00225')) cleanPhone = cleanPhone.slice(5);

  // Cas 4 (Validation Numéro) : Mauvais numéro (format)
  if (!/^\d{10}$/.test(cleanPhone)) {
    return res.status(400).json({ message: 'Le numéro de téléphone est invalide. Format attendu : 10 chiffres (ex: 0708325027).' });
  }

  const transactionId = Date.now().toString() + Math.floor(Math.random() * 1000);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 3. VERIFICATIONS BDD & DÉBIT
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
      return res.status(400).json({ message: 'Le montant demandé dépasse votre solde PubCash disponible.' });
    }

    // Débit BDD
    await connection.execute(
      'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur - ? WHERE id = ?',
      [withdrawalAmount, userId]
    );

    // Historique BDD
    await connection.execute(
      'INSERT INTO demandes_retrait (id_utilisateur, montant, operateur_mobile, statut, date_demande, transaction_id) VALUES (?, ?, ?, ?, NOW(), ?)',
      [userId, withdrawalAmount, operator, 'en_cours', transactionId]
    );

    await connection.commit();

    // 4. APPEL CINETPAY (MODE CÔTE D'IVOIRE 🇨🇮)
    try {
      console.log("🔐 Authentification CinetPay...");
      // NOTE: getCinetPayToken doit être défini ailleurs dans ce fichier.
      const token = await getCinetPayToken();

      // Vérification du solde (pour le débug)
      try {
        const checkBal = await axios.get(`https://client.cinetpay.com/v1/transfer/check/balance?token=${token}&lang=fr`);
        if (checkBal.data.code === 0 && checkBal.data.data.countryBalance.CI) {
          console.log(`💰 Solde dispo CI: ${checkBal.data.data.countryBalance.CI.available} XOF`);
        }
      } catch (e) { console.log("⚠️ Skip balance check"); }

      // Infos utilisateur
      const emailContact = user.email || 'client@pubcash.com';
      const nomContact = user.nom || 'Client';
      const prenomContact = user.prenom || 'PubCash';

      // ** DÉFINITION DU PAYMENT METHOD POUR WAVE **
      const paymentMethod = operator === 'wave' ? 'WAVECI' : null;

      // ** CALCUL DE L'URL DE NOTIFICATION CORRECTE **
      let notifyUrl = `${process.env.PRODUCTION_URL}/api/callbacks/cinetpay/withdrawal`;
      if (!process.env.PRODUCTION_URL || notifyUrl.includes('localhost') || notifyUrl.includes('votredomaine.com')) {
        // Utilise l'URL de production si la variable est incorrecte ou manquante
        notifyUrl = 'https://pub-cash.com/api/callbacks/cinetpay/withdrawal';
      }
      console.log(`ℹ️ URL de notification utilisée: ${notifyUrl}`);

      // A. AJOUT DU CONTACT (Prefix 225)
      console.log(`➕ Ajout contact CI ${cleanPhone}...`);
      const paramsContact = new URLSearchParams();
      paramsContact.append('data', JSON.stringify([{
        prefix: '225',
        phone: cleanPhone,
        name: prenomContact,
        surname: nomContact,
        email: emailContact
      }]));

      await axios.post(`https://client.cinetpay.com/v1/transfer/contact?token=${token}&lang=fr`, paramsContact, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).catch(() => { });

      // B. TRANSFERT
      const transferObject = {
        amount: String(withdrawalAmount),
        phone: cleanPhone,
        prefix: '225', // FORCE CI
        notify_url: notifyUrl,
        client_transaction_id: transactionId,
        email: emailContact,
        name: nomContact,
        surname: prenomContact,
        // AJOUT CONDITIONNEL : WAVECI
        ...(paymentMethod && { payment_method: paymentMethod })
      };

      const paramsTransfer = new URLSearchParams();
      paramsTransfer.append('data', JSON.stringify([transferObject]));

      console.log(`📤 Envoi vers +225 ${cleanPhone} (Ref: ${transactionId})...`);

      const configTransfer = {
        method: 'post',
        url: `https://client.cinetpay.com/v1/transfer/money/send/contact?token=${token}&lang=fr&transaction_id=${transactionId}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: paramsTransfer,
        httpsAgent: httpsAgent
      };

      const apiResponse = await axios(configTransfer);
      const result = apiResponse.data;

      console.log("✅ Réponse CinetPay:", JSON.stringify(result, null, 2));

      if (String(result.code) === '0') {
        await pool.execute(
          'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
          ['traite', transactionId]
        );
        return res.status(200).json({ message: 'Retrait effectué avec succès !' });
      } else {
        // Si le code n'est pas 0 (succès), on jette une erreur pour passer au bloc catch.
        throw { response: { data: result } };
      }

    } catch (apiError) {
      console.error("❌ ERREUR CINETPAY:", apiError.response?.data || apiError.message);
      const responseData = apiError.response?.data || {};
      // Tente de récupérer le code d'erreur spécifique de CinetPay
      const errorCode = responseData.data?.[0]?.code || responseData.code || null;

      // --- GESTION DES ERREURS PROFESSIONNELLES ---
      let professionalMessage = 'Erreur inattendue. Veuillez réessayer ou contacter l\'administrateur.';

      switch (errorCode) {

        // Cas 2 & 3 : Fonds administrateur insuffisants (Ton compte)
        case 722:
        case 'ERROR_PM_AMOUNT':
          professionalMessage = 'Erreur inattendue: Le service de retrait est momentanément indisponible. Veuillez contacter l\'administrateur.';
          break;

        // Cas 4 : Mauvais numéro ou compte bloqué/inactif
        case 725: // ERROR_INVALID_ACCOUNT (Compte destinataire invalide)
        case 726: // ERROR_PHONE_NOT_ALLOWED (Numéro non autorisé/bloqué)
          professionalMessage = `Le numéro de téléphone ${cleanPhone} est soit incorrect, soit inactif chez l'opérateur. Veuillez vérifier votre numéro.`;
          break;

        // Cas 5 : Opérateur indisponible ou problème réseau
        case 727: // ERROR_PM_UNAVAILABLE (Méthode de paiement (opérateur) indisponible)
        case 728: // ERROR_PM_TECHNICAL (Problème technique de l'opérateur)
          professionalMessage = `L'opérateur ${operator.toUpperCase()} rencontre un problème technique. Veuillez réessayer plus tard ou choisir un autre opérateur.`;
          break;

        // Défaut
        default:
          professionalMessage = 'Erreur inattendue. Le transfert a échoué. Veuillez contacter l\'administrateur.';
          break;
      }

      // --- LOGIQUE DE REMBOURSEMENT & MISE À JOUR STATUT ---
      await pool.execute(
        'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur + ? WHERE id = ?',
        [withdrawalAmount, userId]
      );

      try {
        await pool.execute(
          'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
          ['rejete', transactionId]
        );
      } catch (e) { }

      return res.status(500).json({
        message: professionalMessage,
        details: `CinetPay Code: ${errorCode}` // Détail technique pour le développeur
      });
    }

  } catch (error) {
    if (connection) await connection.rollback();
    console.error("💥 Erreur serveur:", error);
    res.status(500).json({ message: 'Erreur serveur interne inattendue.' });
  } finally {
    if (connection) connection.release();
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