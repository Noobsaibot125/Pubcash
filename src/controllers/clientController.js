// pubcash-api/src/controllers/clientController.js
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');

const CINETPAY_APIKEY = process.env.CINETPAY_APIKEY || ''; // <-- remplis avec ta clef
const CINETPAY_SITE_ID = process.env.CINETPAY_SITE_ID || '920230'; // fournie
const CINETPAY_SECRET_KEY = process.env.CINETPAY_SECRET_KEY || '149393413962d807f220f4e8.65928454';
const BASE_URL = process.env.NODE_ENV === 'production' 
  ? process.env.PRODUCTION_URL 
  : process.env.DEVELOPMENT_URL || `http://${process.env.HOST}:${process.env.PORT}`;
// Helper : crée la table de suivi (si inexistante)
const ensureCinetpayTable = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cinetpay_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_id VARCHAR(255) NOT NULL UNIQUE,
      client_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
};
// Fonction pour récupérer les infos du profil du client connecté
exports.getProfile = async (req, res) => {
  try {
    const clientId = req.user.id;
    const [rows] = await pool.execute(
      'SELECT id, nom, prenom, nom_utilisateur, email, telephone, commune, solde_recharge, description, profile_image_url, background_image_url FROM clients WHERE id = ?',
      [clientId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Client non trouvé.' });
    }

    const user = rows[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const profile_image_url = user.profile_image_url
      ? (user.profile_image_url.startsWith('http') ? user.profile_image_url : `${baseUrl}/uploads/profile/${encodeURIComponent(user.profile_image_url)}`)
      : null;

    const background_image_url = user.background_image_url
      ? (user.background_image_url.startsWith('http') ? user.background_image_url : `${baseUrl}/uploads/background/${encodeURIComponent(user.background_image_url)}`)
      : null;

    return res.status(200).json({
      ...user,
      profile_image_url,
      background_image_url
    });
  } catch (error) {
    console.error("Erreur getProfile:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.updateProfile = async (req, res) => {
    const clientId = req.user.id;
    // CORRECTION : Ajout de 'telephone' à la déstructuration
    const { nom, prenom, nom_utilisateur, telephone, description, newPassword, currentPassword } = req.body;

    try {
        // Validation des champs de base
        if (!nom || !prenom || !nom_utilisateur) {
            return res.status(400).json({ message: 'Le nom, le prénom et le nom d\'utilisateur sont requis.' });
        }

        // CORRECTION : Ajout de 'telephone' dans la requête UPDATE
        await pool.execute(
            'UPDATE clients SET nom = ?, prenom = ?, nom_utilisateur = ?, telephone = ?, description = ? WHERE id = ?',
            [nom, prenom, nom_utilisateur, telephone || null, description || null, clientId]
        );

        // Logique de mise à jour du mot de passe (inchangée)
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

        // 1) récupérer le pack correspondant à la durée (et sa rémunération)
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
        const remunerationParVue = Number(pack.remuneration || 0);

        // 2) verrouiller le client et vérifier le solde
        const [rows] = await connection.execute('SELECT solde_recharge FROM clients WHERE id = ? FOR UPDATE', [clientId]);
        const client = rows[0];
        if (!client || Number(client.solde_recharge) < Number(budget)) {
            await connection.rollback();
            return res.status(400).json({ message: 'Solde insuffisant pour créer cette promotion.' });
        }

        // 3) débiter le client
        const newBalance = Math.round((Number(client.solde_recharge) - Number(budget)) * 100) / 100;
        await connection.execute('UPDATE clients SET solde_recharge = ? WHERE id = ?', [newBalance, clientId]);

        // 4) calculer la commission admin (15%) et arrondir à 2 décimales
        const commission = Math.round((Number(budget) * 0.15) * 100) / 100;

        // 5) calculer budget réel pour vues et vues potentielles
        const budgetReelPourVues = Math.round((Number(budget) - commission) * 100) / 100;
        const vuesPotentielles = remunerationParVue > 0 ? Math.floor(budgetReelPourVues / remunerationParVue) : 0;

        // 6) insérer la promotion (avec commission_pubcash)
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
                Number(budget), 
                Number(budget), 
                'en_cours', 
                commission, 
                vuesPotentielles, 
                tranche_age, 
                ciblage_commune
            ]
        );

        const insertedPromotionId = result.insertId;

        // 7) assurer l'existence d'une ligne portefeuille_admin (si absente) et verrouiller
        await connection.execute(
          `INSERT INTO portefeuille_admin (id, solde)
           SELECT 1, 0
           WHERE NOT EXISTS (SELECT 1 FROM portefeuille_admin WHERE id = 1)`
        );

        const [walletRows] = await connection.execute('SELECT solde FROM portefeuille_admin WHERE id = 1 FOR UPDATE');
        if (walletRows.length === 0) {
            // Au cas improbable où la ligne n'existerait toujours pas, on la crée explicitement
            await connection.execute('INSERT INTO portefeuille_admin (id, solde) VALUES (?, ?)', [1, commission]);
        } else {
            // 8) mettre à jour le solde du portefeuille admin
            await connection.execute('UPDATE portefeuille_admin SET solde = solde + ? WHERE id = 1', [commission]);
        }

        // 9) inscrire une ligne d'historique dans admin_portefeuille_history (optionnel mais recommandé)
        // Assure-toi d'avoir créé la table admin_portefeuille_history (si non, tu peux l'ajouter via migration).
        try {
          await connection.execute(
            'INSERT INTO admin_portefeuille_history (id_promotion, montant, type_operation, description) VALUES (?, ?, ?, ?)',
            [insertedPromotionId, commission, 'credit', 'Commission sur création de promotion']
          );
        } catch (histErr) {
          // Si la table d'historique n'existe pas, on ignore l'erreur (ne bloque pas la création)
          console.warn('admin_portefeuille_history insert failed (table manquante ?):', histErr.message || histErr);
        }

        await connection.commit();
        res.status(201).json({ 
            message: 'Promotion créée avec succès !', 
            promotionId: insertedPromotionId,
            newBalance: newBalance 
        });

    } catch (error) {
        await connection.rollback();
        console.error("Erreur createPromotion:", error);
        res.status(500).json({ message: 'Erreur serveur lors de la création de la promotion.' });
    } finally {
        connection.release();
    }
};

// --- NOUVELLE FONCTION POUR AFFICHER LES PROMOTIONS DU CLIENT ---
// pubcash-api/src/controllers/clientController.js
exports.getClientPromotions = async (req, res) => {
  const clientId = req.user.id;
  const filter = req.query.filter || 'toutes_mes_promotions';

  try {
      let query = `
          SELECT 
              p.id, p.titre, p.url_video, p.statut, p.budget_initial, p.budget_restant, 
              p.vues, p.likes, p.partages, p.thumbnail_url, p.ciblage_commune,
              pk.nom_pack
           FROM promotions p
           LEFT JOIN packs pk ON p.id_pack = pk.id
           WHERE p.id_client = ? AND p.statut != 'termine'
      `;
      
      const params = [clientId];

      // La logique de filtre reste la même
      if (filter === 'ma_commune') {
          query += ` AND p.ciblage_commune = 'ma_commune'`;
      } else if (filter === 'toutes_communes') {
          query += ` AND p.ciblage_commune = 'toutes'`;
      }

      query += ` ORDER BY p.date_creation DESC`;

      const [promotions] = await pool.execute(query, params);
      
      // --- CORRECTION DE LA CONSTRUCTION DES URLs ---
      // On définit l'URL de base du serveur, ex: http://localhost:5000
      const baseUrl = `${req.protocol}://${req.get('host')}`; 

      const promotionsWithFullUrls = promotions.map(promo => {
        // Pour les thumbnails
        const finalThumbUrl = promo.thumbnail_url && !promo.thumbnail_url.startsWith('http')
          ? `${baseUrl}/uploads/thumbnails/${encodeURIComponent(promo.thumbnail_url)}`
          : promo.thumbnail_url;
      
        // Pour les vidéos
        const finalVideoUrl = promo.url_video && !promo.url_video.startsWith('http')
          ? `${baseUrl}/uploads/videos/${encodeURIComponent(promo.url_video)}`
          : promo.url_video;
      
        return {
          ...promo,
          thumbnail_url: finalThumbUrl,
          url_video: finalVideoUrl,
        };
      });
      // --- FIN DE LA CORRECTION ---

      res.status(200).json(promotionsWithFullUrls);

  } catch (error) {
      console.error("Erreur getClientPromotions:", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.getGlobalStats = async (req, res) => {
  const clientId = req.user.id;
  try {
      const [rows] = await pool.execute(
          `SELECT 
              SUM(vues) as total_vues, 
              SUM(likes) as total_likes, 
              SUM(partages) as total_partages
           FROM promotions 
           WHERE id_client = ? AND statut != 'termine'`,  // <-- Ajout de la condition
          [clientId]
      );
      const stats = rows[0];
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

/**
 * INITIER LE PAIEMENT (endpoint POST /client/recharge)
 * - body: { amount }
 * - renvoie: { payment_url, transaction_id }
 */
exports.rechargeAccount = async (req, res) => {
    console.log("Configuration CinetPay:");
    console.log("CINETPAY_SITE_ID:", CINETPAY_SITE_ID);
    console.log("CINETPAY_APIKEY:", CINETPAY_APIKEY ? "***" + CINETPAY_APIKEY.slice(-4) : "non définie");
    
    const { amount } = req.body;
    if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'Utilisateur non authentifié.' });
    }
    
    const clientId = req.user.id;
    // NE PAS utiliser req.user directement pour les infos volatiles comme le téléphone.

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({ message: 'Le montant doit être un nombre positif.' });
    }
    if (Number(amount) < 100) {
        return res.status(400).json({ message: 'Le montant minimum est de 100 FCFA' });
    }

    if (!CINETPAY_APIKEY || !CINETPAY_SITE_ID) {
        console.error('CinetPay config manquante');
        return res.status(500).json({ message: 'Configuration CinetPay incomplète' });
    }

    try {
        // --- CORRECTION : Récupérer les informations à jour de l'utilisateur ---
        const [userRows] = await pool.execute(
            'SELECT nom, prenom, email, telephone, commune FROM clients WHERE id = ?',
            [clientId]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ message: 'Client non trouvé.' });
        }
        const user = userRows[0]; // 'user' contient maintenant les données fraîches de la BDD

        // On peut maintenant vérifier le téléphone sur les données à jour
        if (!user.telephone) {
            return res.status(400).json({ message: 'Veuillez renseigner votre numéro de téléphone dans votre profil avant de recharger.' });
        }
        // --- FIN DE LA CORRECTION ---


        const transactionId = `RECH_${clientId}_${Date.now()}`;

        await ensureCinetpayTable();
        
        await pool.execute(
            'INSERT INTO cinetpay_transactions (transaction_id, client_id, amount, status) VALUES (?, ?, ?, ?)',
            [transactionId, clientId, Number(amount), 'PENDING']
        );

        // Retourner les données nécessaires pour le SDK client en utilisant l'objet 'user' à jour
        res.status(200).json({
            message: 'Paiement initialisé',
            cinetpay_config: {
                apikey: CINETPAY_APIKEY,
                site_id: CINETPAY_SITE_ID,
                notify_url: `${BASE_URL}/webhook/cinetpay`,
                mode: 'PRODUCTION'
            },
            checkout_data: {
                transaction_id: transactionId,
                amount: Number(amount),
                currency: 'XOF',
                channels: 'ALL',
                description: `Recharge PubCash de ${amount} FCFA`,
                customer_name: user.nom || "Client",
                customer_surname: user.prenom || "PubCash",
                customer_email: user.email,
                customer_phone_number: user.telephone, // Utilisation du numéro à jour
                customer_address: user.commune || "Non défini",
                customer_city: user.commune || "Non défini",
                customer_country: "CI",
                customer_state: "CI",
                customer_zip_code: "0000"
            }
        });
    } catch (error) {
        console.error('Erreur rechargeAccount:', error);
        res.status(500).json({ message: "Erreur lors de l'initialisation du paiement" });
    }
};
  /**
   * VERIFIER LE PAIEMENT (endpoint POST /client/recharge/verify)
   * - body: { transaction_id }
   * On appelle l'API /v2/payment/check et si ACCEPTED => on crédite le solde
   */
  exports.verifyRecharge = async (req, res) => {
    const { transaction_id } = req.body;
    const clientId = req.user.id;
  
    if (!transaction_id) return res.status(400).json({ message: 'transaction_id requis.' });
    if (!CINETPAY_APIKEY) return res.status(500).json({ message: 'CinetPay API key non configurée.' });
  
    try {
      // Vérifier l'existence de la transaction dans notre table
      const [txRows] = await pool.execute('SELECT * FROM cinetpay_transactions WHERE transaction_id = ?', [transaction_id]);
      if (txRows.length === 0) return res.status(404).json({ message: 'Transaction introuvable.' });
  
      const tx = txRows[0];
      if (Number(tx.client_id) !== Number(clientId)) {
        return res.status(403).json({ message: 'Transaction non associée à cet utilisateur.' });
      }
      if (tx.status === 'COMPLETED') {
        return res.status(200).json({ message: 'Transaction déjà validée.', newBalance: (await getClientBalance(clientId)) });
      }
  
      // Appel à CinetPay pour vérifier l'état réel
      const payload = {
        apikey: CINETPAY_APIKEY,
        site_id: CINETPAY_SITE_ID,
        transaction_id: transaction_id
      };
  
      const checkResp = await axios.post('https://api-checkout.cinetpay.com/v2/payment/check', payload, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'PubCash/1.0' },
        timeout: 15000
      });
  
      const checkData = checkResp.data || {};
      // Structure attendue : checkData.data.status == 'ACCEPTED' ou 'REFUSED' (ou autres)
      const status = checkData?.data?.status || checkData?.status || null;
  
      // Si accepté -> mettre à jour le solde
      if (status && status.toUpperCase() === 'ACCEPTED') {
        // créditer solde si pas déjà crédité
        if (tx.status !== 'COMPLETED') {
          // mise à jour du solde dans une transaction DB
          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();
  
            // lock client row
            const [clientRows] = await connection.execute('SELECT solde_recharge FROM clients WHERE id = ? FOR UPDATE', [clientId]);
            if (clientRows.length === 0) {
              await connection.rollback();
              return res.status(404).json({ message: 'Client introuvable.' });
            }
            const current = Number(clientRows[0].solde_recharge || 0);
            const newBalance = Math.round((current + Number(tx.amount)) * 100) / 100;
  
            await connection.execute('UPDATE clients SET solde_recharge = ? WHERE id = ?', [newBalance, clientId]);
            await connection.execute('UPDATE cinetpay_transactions SET status = ?, updated_at = NOW() WHERE transaction_id = ?', ['COMPLETED', transaction_id]);
  
            await connection.commit();
  
            return res.status(200).json({ message: 'Paiement confirmé et solde mis à jour.', newBalance });
          } catch (err) {
            await connection.rollback();
            console.error('Erreur lors de la maj solde (verify):', err);
            return res.status(500).json({ message: 'Erreur serveur lors de la mise à jour du solde.' });
          } finally {
            connection.release();
          }
        } else {
          // déjà completed
          const newBalance = await getClientBalance(clientId);
          return res.status(200).json({ message: 'Transaction déjà traitée.', newBalance });
        }
      } else {
        // Pas accepté (PENDING, REFUSED, etc.)
        // On met à jour le statut dans notre table si possible
        const newStatus = status ? status.toUpperCase() : 'UNKNOWN';
        await pool.execute('UPDATE cinetpay_transactions SET status = ? WHERE transaction_id = ?', [newStatus, transaction_id]);
        return res.status(200).json({ message: `Transaction status: ${newStatus}`, raw: checkData });
      }
  
    } catch (error) {
      console.error('Erreur verifyRecharge:', error.response?.data || error.message || error);
      return res.status(500).json({ message: 'Erreur lors de la vérification du paiement.' });
    }
  };
  
  /**
   * WEBHOOK CinetPay (endpoint POST /webhook/cinetpay)
   * - CinetPay appellera cette url pour notifier
   * - On récupère cpm_trans_id (transaction_id), on appelle /v2/payment/check et on met à jour si ACCEPTED
   *
   * IMPORTANT: on effectue la vérification côté CinetPay via l'API de check (la doc recommande de toujours vérifier).
   */
  exports.cinetpayNotify = async (req, res) => {
    try {
      // CinetPay envoie souvent cpm_trans_id ou transaction_id, on tente plusieurs clés
      const body = req.body || {};
      const transactionId = body.cpm_trans_id || body.transaction_id || body.cpm_trans_id_supplied || body.cpm_trans_id_payment || null;
  
      if (!transactionId) {
        // si aucune transaction fournie : ok pour réponse 200 (CinetPay fait un ping)
        console.warn('Webhook CinetPay sans transaction_id (ping?).');
        return res.status(200).send('OK');
      }
  
      // Appeler /v2/payment/check pour avoir l'état réel
      if (!CINETPAY_APIKEY) {
        console.error('CINETPAY_APIKEY manquant pour vérifier la transaction.');
        return res.status(500).send('APIKEY missing');
      }
  
      const payload = {
        apikey: CINETPAY_APIKEY,
        site_id: CINETPAY_SITE_ID,
        transaction_id: transactionId
      };
  
      const checkResp = await axios.post('https://api-checkout.cinetpay.com/v2/payment/check', payload, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'PubCash/1.0' },
        timeout: 15000
      });
  
      const checkData = checkResp.data || {};
      const status = checkData?.data?.status || checkData?.status || null;
  
      // Récupérer l'enregistrement local
      const [txRows] = await pool.execute('SELECT * FROM cinetpay_transactions WHERE transaction_id = ?', [transactionId]);
      if (txRows.length === 0) {
        console.warn('Webhook: transaction non trouvée en base:', transactionId);
        // Optionnel : insérer la transaction inconnue pour suivi
        await pool.execute('INSERT IGNORE INTO cinetpay_transactions (transaction_id, client_id, amount, status) VALUES (?, ?, ?, ?)', [transactionId, 0, 0, status || 'UNKNOWN']);
        // On répond OK pour que CinetPay arrête de retry
        return res.status(200).send('OK');
      }
      const tx = txRows[0];
  
      // Si accepted et pas encore traité -> créditer
      if (status && status.toUpperCase() === 'ACCEPTED' && tx.status !== 'COMPLETED') {
        // créditer client
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
  
          // lock client and update
          const [clientRows] = await connection.execute('SELECT solde_recharge FROM clients WHERE id = ? FOR UPDATE', [tx.client_id]);
          if (clientRows.length === 0) {
            console.warn('Webhook: client introuvable pour tx:', tx.client_id);
            await connection.rollback();
            return res.status(200).send('OK');
          }
          const current = Number(clientRows[0].solde_recharge || 0);
          const newBalance = Math.round((current + Number(tx.amount)) * 100) / 100;
  
          await connection.execute('UPDATE clients SET solde_recharge = ? WHERE id = ?', [newBalance, tx.client_id]);
          await connection.execute('UPDATE cinetpay_transactions SET status = ?, updated_at = NOW() WHERE transaction_id = ?', ['COMPLETED', transactionId]);
  
          await connection.commit();
          console.info(`Webhook: solde client ${tx.client_id} mis à jour (+${tx.amount})`);
          return res.status(200).send('OK');
        } catch (err) {
          await connection.rollback();
          console.error('Webhook process failed:', err);
          return res.status(500).send('ERR');
        } finally {
          connection.release();
        }
      } else {
        // Mettre à jour statut local si différent
        if (status && tx.status !== status) {
          await pool.execute('UPDATE cinetpay_transactions SET status = ? WHERE transaction_id = ?', [status.toUpperCase(), transactionId]);
        }
        return res.status(200).send('OK');
      }
  
    } catch (err) {
      console.error('Erreur webhook CinetPay:', err.response?.data || err.message || err);
      // Toujours renvoyer 200 si tu veux que CinetPay arrête le retry, sinon renvoyer 500 pour qu'il retente
      return res.status(200).send('OK');
    }
  };
  
  /** Petit helper pour récupérer le solde courant du client */
  const getClientBalance = async (clientId) => {
    const [rows] = await pool.execute('SELECT solde_recharge FROM clients WHERE id = ?', [clientId]);
    if (!rows || rows.length === 0) return 0;
    return Number(rows[0].solde_recharge || 0);
  };