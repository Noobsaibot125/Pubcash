// pubcash-api/src/controllers/clientController.js
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const notificationService = require('../services/notificationService'); 
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
    // AJOUT DE : type_compte, nom_entreprise, rccm dans le SELECT
    const [rows] = await pool.execute(
      'SELECT id, nom, prenom, nom_utilisateur, email, telephone, commune, solde_recharge, description, profile_image_url, background_image_url, type_compte, nom_entreprise, rccm FROM clients WHERE id = ?',
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

// 2. Mise à jour de updateProfile pour gérer la condition Entreprise vs Particulier
exports.updateProfile = async (req, res) => {
  const clientId = req.user.id;
  // On récupère aussi nom_entreprise et rccm du body
  const { nom, prenom, nom_utilisateur, telephone, description, newPassword, currentPassword, nom_entreprise, rccm } = req.body;

  try {
    // ÉTAPE 1 : Récupérer le profil actuel pour connaître le type de compte et vérifier le mdp
    const [rows] = await pool.execute('SELECT type_compte, mot_de_passe FROM clients WHERE id = ?', [clientId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'Client non trouvé.' });
    }
    const user = rows[0];
    const isEntreprise = user.type_compte === 'entreprise';

    // ÉTAPE 2 : Validation conditionnelle
    if (isEntreprise) {
        // Pour une entreprise : Nom entreprise requis
        if (!nom_entreprise) {
             return res.status(400).json({ message: "Le nom de l'entreprise est requis." });
        }
        // Note: RCCM est rarement modifiable, mais on peut le laisser optionnel ou requis selon ta logique
    } else {
        // Pour un particulier : Nom et Prénom requis
        if (!nom || !prenom || !nom_utilisateur) {
            return res.status(400).json({ message: "Le nom, le prénom et le nom d'utilisateur sont requis." });
        }
    }

    // ÉTAPE 3 : Vérification du mot de passe actuel
    if (currentPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.mot_de_passe);
      if (!isMatch) {
        return res.status(401).json({ message: "Mot de passe incorrect." });
      }
    } else {
      return res.status(400).json({ message: "Veuillez confirmer votre mot de passe pour enregistrer les modifications." });
    }

    // ÉTAPE 4 : Mise à jour conditionnelle en base de données
    if (isEntreprise) {
        // Mise à jour Entreprise (on ignore nom/prenom qui sont NULL)
        // On permet de modifier nom_entreprise, telephone, description, et eventuellement pseudo/rccm
        await pool.execute(
            'UPDATE clients SET nom_entreprise = ?, nom_utilisateur = ?, rccm = ?, telephone = ?, description = ? WHERE id = ?',
            [nom_entreprise, nom_utilisateur || null, rccm || null, telephone || null, description || null, clientId]
        );
    } else {
        // Mise à jour Particulier
        await pool.execute(
            'UPDATE clients SET nom = ?, prenom = ?, nom_utilisateur = ?, telephone = ?, description = ? WHERE id = ?',
            [nom, prenom, nom_utilisateur, telephone || null, description || null, clientId]
        );
    }

    // ÉTAPE 5 : Mise à jour du mot de passe si demandé
    if (newPassword) {
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      await pool.execute('UPDATE clients SET mot_de_passe = ? WHERE id = ?', [hashedNewPassword, clientId]);
    }

    return res.status(200).json({ message: 'Profil mis à jour avec succès !' });
  } catch (error) {
    console.error("Erreur updateProfile:", error);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
};


// --- NOUVELLE FONCTION POUR CRÉER UNE PROMOTION ---
// --- FONCTION CREATEPROMOTION MISE À JOUR ---
// pubcash-api/src/controllers/clientController.js

exports.createPromotion = async (req, res) => {
    const clientId = req.user.id;
    let { titre, description, url_video, budget, duree_secondes, thumbnail_url, tranche_age, ciblage_commune } = req.body;
    
    // Validation
    if (!tranche_age || !ciblage_commune) {
        return res.status(400).json({ message: 'Les tranches d\'âge et le ciblage par commune sont requis.' });
    }
    
    url_video = url_video || null;
    thumbnail_url = thumbnail_url || null;
    description = description || null;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1) Récupérer le pack
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

        // 2) Verrouiller le client et récupérer son SOLDE et sa COMMUNE
        // MODIFICATION : On récupère explicitement la 'commune' ici
        const [rows] = await connection.execute('SELECT solde_recharge, commune FROM clients WHERE id = ? FOR UPDATE', [clientId]);
        const client = rows[0];
        
        if (!client || Number(client.solde_recharge) < Number(budget)) {
            await connection.rollback();
            return res.status(400).json({ message: 'Solde insuffisant pour créer cette promotion.' });
        }

        // --- LOGIQUE DE CIBLAGE MODIFIÉE ---
        // Si le frontend envoie 'ma_commune', on remplace par le nom réel de la commune du client (ex: 'Yopougon')
        // Si le frontend envoie 'toutes', on garde 'toutes'
        let finalCiblageCommune = ciblage_commune;
        
        if (ciblage_commune === 'ma_commune') {
            if (!client.commune) {
                await connection.rollback();
                return res.status(400).json({ message: 'Veuillez renseigner votre commune dans votre profil avant de créer une promotion locale.' });
            }
            finalCiblageCommune = client.commune; // Ex: "Yopougon"
        }
        // -----------------------------------

        // 3) Débiter le client
        const newBalance = Math.round((Number(client.solde_recharge) - Number(budget)) * 100) / 100;
        await connection.execute('UPDATE clients SET solde_recharge = ? WHERE id = ?', [newBalance, clientId]);

        // 4) Calculs commissions
        const commission = Math.round((Number(budget) * 0.15) * 100) / 100;
        const budgetReelPourVues = Math.round((Number(budget) - commission) * 100) / 100;
        const vuesPotentielles = remunerationParVue > 0 ? Math.floor(budgetReelPourVues / remunerationParVue) : 0;

        // 5) Insérer la promotion
        // MODIFICATION : On insère finalCiblageCommune
        const [result] = await connection.execute(
            `INSERT INTO promotions (
                id_client, titre, description, url_video, thumbnail_url, duree_secondes, 
                id_pack, budget_initial, budget_restant, statut, commission_pubcash, 
                vues_potentielles, tranche_age, ciblage_commune
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clientId, titre, description, url_video, thumbnail_url, duree_secondes, 
                packId, Number(budget), Number(budget), 'en_cours', commission, 
                vuesPotentielles, tranche_age, finalCiblageCommune
            ]
        );

        const insertedPromotionId = result.insertId;

        // 6) Gestion Portefeuille Admin (inchangé)
        await connection.execute(
          `INSERT INTO portefeuille_admin (id, solde) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM portefeuille_admin WHERE id = 1)`
        );
        const [walletRows] = await connection.execute('SELECT solde FROM portefeuille_admin WHERE id = 1 FOR UPDATE');
        if (walletRows.length === 0) {
            await connection.execute('INSERT INTO portefeuille_admin (id, solde) VALUES (?, ?)', [1, commission]);
        } else {
            await connection.execute('UPDATE portefeuille_admin SET solde = solde + ? WHERE id = 1', [commission]);
        }

        // Historique admin (inchangé)
        try {
          await connection.execute(
            'INSERT INTO admin_portefeuille_history (id_promotion, montant, type_operation, description) VALUES (?, ?, ?, ?)',
            [insertedPromotionId, commission, 'credit', 'Commission sur création de promotion']
          );
        } catch (histErr) {
          console.warn('admin_portefeuille_history insert failed:', histErr.message);
        }

        await connection.commit();

        // Notification (inchangé)
        notificationService.notifierNouvellePromotion(
            insertedPromotionId, titre, finalCiblageCommune, tranche_age
        ).catch(err => console.error("Erreur background notification:", err));
// ========================================================
// SOCKET.IO : Émettre l'événement de nouvelle vidéo en temps réel
// ==================================================================
try {
    const io = req.app.get('io');
    if (io) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const videoUrl = url_video && !url_video.startsWith('http')
            ? `${baseUrl}/uploads/videos/${encodeURIComponent(url_video)}`
            : url_video;
        const thumbUrl = thumbnail_url && !thumbnail_url.startsWith('http')
            ? `${baseUrl}/uploads/thumbnails/${encodeURIComponent(thumbnail_url)}`
            : thumbnail_url;
        const [clientInfo] = await connection.execute(
            'SELECT nom, prenom, nom_utilisateur FROM clients WHERE id = ?',
            [clientId]
        );
        const promotionData = {
            id: insertedPromotionId,
            titre: titre,
            description: description,
            url_video: videoUrl,
            thumbnail_url: thumbUrl,
            duree_secondes: duree_secondes,
            type_pack: packId,
            ciblage_commune: finalCiblageCommune,
            tranche_age: tranche_age,
            vues: 0,
            likes: 0,
            partages: 0,
            statut: 'en_cours',
            promoteur: clientInfo[0] ? {
                nom: clientInfo[0].nom,
                prenom: clientInfo[0].prenom,
                nom_utilisateur: clientInfo[0].nom_utilisateur
            } : null,
            date_creation: new Date().toISOString()
        };
        io.emit('new-video', promotionData);
        console.log(`✅ Socket.IO: Événement 'new-video' émis pour la promotion ${insertedPromotionId}`);
    } else {
        console.warn('⚠️ Socket.IO non disponible (io est null)');
    }
} catch (socketError) {
    console.error('❌ Erreur lors de l\'émission Socket.IO:', socketError);
}
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
  // Le filtre vient du frontend (ex: 'ma_commune' ou 'toutes_communes' ou 'toutes_mes_promotions')
  const filter = req.query.filter || 'toutes_mes_promotions';

  try {
      // On a besoin de connaître la commune du client pour appliquer le filtre 'ma_commune'
      // car en base, ce n'est plus écrit 'ma_commune' mais 'Yopougon'.
      const [clientRows] = await pool.execute('SELECT commune FROM clients WHERE id = ?', [clientId]);
      const clientCommune = clientRows[0]?.commune;

      let query = `
          SELECT 
              p.id, p.titre, p.url_video, p.statut, p.budget_initial, p.budget_restant, 
              p.vues, p.likes, p.partages, p.thumbnail_url, p.ciblage_commune, p.tranche_age,
              pk.nom_pack
           FROM promotions p
           LEFT JOIN packs pk ON p.id_pack = pk.id
           WHERE p.id_client = ? AND p.statut != 'termine'
      `;
      
      const params = [clientId];

      // --- LOGIQUE DE FILTRE MISE À JOUR ---
      if (filter === 'ma_commune') {
          // On affiche les promos qui ont pour cible EXACTEMENT la commune du client
          if (clientCommune) {
            query += ` AND p.ciblage_commune = ?`;
            params.push(clientCommune);
          } else {
            // Si le client n'a pas de commune définie, ce filtre ne retourne rien
            query += ` AND 1=0`; 
          }
      } else if (filter === 'toutes_communes') {
          // On affiche celles qui ciblent 'toutes'
          query += ` AND p.ciblage_commune = 'toutes'`;
      }
      // Si 'toutes_mes_promotions', on ne filtre pas le ciblage

      query += ` ORDER BY p.date_creation DESC`;

      const [promotions] = await pool.execute(query, params);
      
      // Construction des URLs (inchangé)
      const baseUrl = `${req.protocol}://${req.get('host')}`; 
      const promotionsWithFullUrls = promotions.map(promo => {
        const finalThumbUrl = promo.thumbnail_url && !promo.thumbnail_url.startsWith('http')
          ? `${baseUrl}/uploads/thumbnails/${encodeURIComponent(promo.thumbnail_url)}`
          : promo.thumbnail_url;
      
        const finalVideoUrl = promo.url_video && !promo.url_video.startsWith('http')
          ? `${baseUrl}/uploads/videos/${encodeURIComponent(promo.url_video)}`
          : promo.url_video;
      
        return {
          ...promo,
          thumbnail_url: finalThumbUrl,
          url_video: finalVideoUrl,
        };
      });

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
              COUNT(CASE WHEN i.type_interaction = 'vue' THEN 1 END) as total_vues,
              COUNT(CASE WHEN i.type_interaction = 'like' THEN 1 END) as total_likes,
              COUNT(CASE WHEN i.type_interaction = 'partage' THEN 1 END) as total_partages
           FROM interactions i
           INNER JOIN promotions p ON i.id_promotion = p.id
           WHERE p.id_client = ? AND p.statut != 'termine'`,
          [clientId]
      );
      
      const stats = rows[0] || {}; // Assure qu'on a un objet même si la requête ne retourne rien

      res.status(200).json({
          total_vues: Number(stats.total_vues) || 0,
          total_likes: Number(stats.total_likes) || 0,
          total_partages: Number(stats.total_partages) || 0,
      });

  } catch (error) {
      console.error("Erreur getGlobalStats (version corrigée):", error);
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
  console.log("=== Configuration CinetPay ===");
  console.log("CINETPAY_SITE_ID:", CINETPAY_SITE_ID);
  console.log("CINETPAY_APIKEY:", CINETPAY_APIKEY ? "***" + CINETPAY_APIKEY.slice(-4) : "non définie");
  console.log("BASE_URL:", BASE_URL);
  
  const { amount } = req.body;
  if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Utilisateur non authentifié.' });
  }
  
  const clientId = req.user.id;

  // Validation du montant
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ message: 'Le montant doit être un nombre positif.' });
  }
  if (Number(amount) < 100) {
      return res.status(400).json({ message: 'Le montant minimum est de 100 FCFA' });
  }

  // Vérification de la configuration CinetPay
  if (!CINETPAY_APIKEY || !CINETPAY_SITE_ID) {
      console.error('❌ Configuration CinetPay manquante');
      return res.status(500).json({ 
          message: 'Configuration du système de paiement incomplète' 
      });
  }

  try {
      // Récupération des informations utilisateur fraîches
      const [userRows] = await pool.execute(
          'SELECT nom, prenom, email, telephone, commune FROM clients WHERE id = ?',
          [clientId]
      );

      if (userRows.length === 0) {
          return res.status(404).json({ message: 'Client non trouvé.' });
      }
      
      const user = userRows[0];

      // Vérification du numéro de téléphone
      if (!user.telephone) {
          return res.status(400).json({ 
              message: 'Veuillez renseigner votre numéro de téléphone dans votre profil avant de recharger.' 
          });
      }

      // --- CORRECTION : VALIDATION PLUS FLEXIBLE POUR LES 3 FORMATS ---
      let formattedPhone = user.telephone.trim();
      
      // Supprimer tous les espaces et caractères spéciaux
      formattedPhone = formattedPhone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      
      // Fonction de validation améliorée pour accepter les 3 formats
      const isValidPhone = (phone) => {
          // Format 1: +225XXXXXXXXX (13 caractères)
          if (phone.startsWith('+225') && phone.length === 13) return true;
          // Format 2: 225XXXXXXXXX (12 caractères)
          if (phone.startsWith('225') && phone.length === 12) return true;
          // Format 3: XXXXXXXXX (10 chiffres - format local)
          if (/^\d{10}$/.test(phone)) return true;
          return false;
      };

      if (!isValidPhone(formattedPhone)) {
          return res.status(400).json({ 
              message: 'Numéro de téléphone invalide. Formats acceptés: +225XXXXXXXXX, 225XXXXXXXXX ou XXXXXXXXX (10 chiffres)' 
          });
      }

      // Normalisation vers le format CinetPay attendu (+225XXXXXXXXX)
      if (formattedPhone.startsWith('225') && formattedPhone.length === 12) {
          formattedPhone = '+' + formattedPhone; // 225... -> +225...
      } else if (/^\d{10}$/.test(formattedPhone)) {
          formattedPhone = '+225' + formattedPhone; // XXXXXXXXX -> +225XXXXXXXXX
      }
      // Si déjà +225..., on laisse tel quel

      // === NOUVELLE CORRECTION : VALIDATION DES NOMS POUR CINETPAY ===
      // CinetPay exige que customer_surname ait au moins 2 caractères
      let customerName = (user.nom || "Client").trim();
      let customerSurname = (user.prenom || "PubCash").trim();
      
      // Si le prénom est trop court, on utilise une valeur par défaut plus longue
      if (customerSurname.length < 2) {
          console.warn(`Prénom trop court (${customerSurname.length} caractères), utilisation de "Utilisateur"`);
          customerSurname = "Utilisateur";
      }
      
      // Si le nom est trop court, on utilise une valeur par défaut
      if (customerName.length < 2) {
          console.warn(`Nom trop court (${customerName.length} caractères), utilisation de "Client"`);
          customerName = "Client";
      }

      console.log("Numéro original:", user.telephone);
      console.log("Numéro formaté:", formattedPhone);
      console.log("Nom utilisé:", customerName);
      console.log("Prénom utilisé:", customerSurname);

      const transactionId = `RECH_${clientId}_${Date.now()}`;

      await ensureCinetpayTable();
      
      // Insertion de la transaction
      await pool.execute(
          'INSERT INTO cinetpay_transactions (transaction_id, client_id, amount, status) VALUES (?, ?, ?, ?)',
          [transactionId, clientId, Number(amount), 'PENDING']
      );

      // Données pour CinetPay - AVEC LES NOMS CORRIGÉS
      const checkoutData = {
          transaction_id: transactionId,
          amount: Number(amount),
          currency: 'XOF',
          channels: 'ALL',
          description: `Recharge PubCash de ${amount} FCFA`,
          customer_name: customerName,
          customer_surname: customerSurname,
          customer_email: user.email || "client@pubcash.com",
          customer_phone_number: formattedPhone,
          customer_address: user.commune || "Abidjan",
          customer_city: user.commune || "Abidjan",
          customer_country: "CI",
          customer_state: "CI",
          customer_zip_code: "0000"
      };

      console.log("=== Données envoyées à CinetPay ===");
      console.log("Transaction ID:", transactionId);
      console.log("Montant:", amount);
      console.log("Téléphone formaté:", formattedPhone);
      console.log("Nom:", customerName);
      console.log("Prénom:", customerSurname);
      console.log("URL de notification:", `${BASE_URL}/webhook/cinetpay`);

      res.status(200).json({
          message: 'Paiement initialisé',
          cinetpay_config: {
              apikey: CINETPAY_APIKEY,
              site_id: CINETPAY_SITE_ID,
              notify_url: `${BASE_URL}/webhook/cinetpay`,
              mode: 'PRODUCTION'
          },
          checkout_data: checkoutData
      });

  } catch (error) {
      console.error('❌ Erreur rechargeAccount:', error);
      res.status(500).json({ 
          message: "Erreur lors de l'initialisation du paiement",
          error: error.message 
      });
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
  exports.getMonthlyStats = async (req, res) => {
    const clientId = req.user.id;
    
    try {
      // Statistiques mensuelles des 6 derniers mois
      const [stats] = await pool.execute(`
        SELECT 
          YEAR(date_creation) as annee,
          MONTH(date_creation) as mois,
          COUNT(*) as nombre_promotions,
          SUM(vues) as total_vues,
          SUM(likes) as total_likes,
          SUM(partages) as total_partages,
          SUM(budget_initial) as total_budget_depense,
          SUM(budget_restant) as total_budget_restant
        FROM promotions 
        WHERE id_client = ? 
          AND date_creation >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY YEAR(date_creation), MONTH(date_creation)
        ORDER BY annee, mois
      `, [clientId]);
  
      res.status(200).json({
        statsMensuelles: stats,
        success: true
      });
  
    } catch (error) {
      console.error("Erreur getMonthlyStats:", error);
      res.status(500).json({ 
        message: 'Erreur serveur',
        success: false 
      });
    }
  };
  
  // Récupérer les statistiques globales
  exports.getGlobalStats = async (req, res) => {
    const clientId = req.user.id;
    try {
        const [rows] = await pool.execute(
            `SELECT 
                COUNT(CASE WHEN i.type_interaction = 'vue' THEN 1 END) as total_vues,
                COUNT(CASE WHEN i.type_interaction = 'like' THEN 1 END) as total_likes,
                COUNT(CASE WHEN i.type_interaction = 'partage' THEN 1 END) as total_partages
             FROM interactions i
             INNER JOIN promotions p ON i.id_promotion = p.id
             WHERE p.id_client = ? AND p.statut != 'termine'`,
            [clientId]
        );
        const stats = rows[0] || {};
        res.status(200).json({
            total_vues: Number(stats.total_vues) || 0,
            total_likes: Number(stats.total_likes) || 0,
            total_partages: Number(stats.total_partages) || 0,
        });
    } catch (error) {
        console.error("Erreur getGlobalStats (corrigée):", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
  };
  exports.getDetailedStats = async (req, res) => {
    const clientId = req.user.id;
    
    try {
      // Statistiques mensuelles des 12 derniers mois
      const [monthlyStats] = await pool.execute(`
        SELECT 
          YEAR(date_creation) as annee,
          MONTH(date_creation) as mois,
          COUNT(*) as nombre_promotions,
          SUM(vues) as total_vues,
          SUM(likes) as total_likes,
          SUM(partages) as total_partages,
          SUM(budget_initial) as total_budget_depense,
          SUM(budget_restant) as total_budget_restant,
          AVG(vues) as vues_moyennes,
          AVG(likes) as likes_moyens,
          AVG(partages) as partages_moyens
        FROM promotions 
        WHERE id_client = ? 
          AND date_creation >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY YEAR(date_creation), MONTH(date_creation)
        ORDER BY annee, mois
      `, [clientId]);
  
      // Statistiques globales
      const [globalStats] = await pool.execute(`
        SELECT 
          COUNT(*) as total_promotions,
          SUM(vues) as total_vues,
          SUM(likes) as total_likes,
          SUM(partages) as total_partages,
          SUM(budget_initial) as total_budget_depense,
          AVG(vues) as performance_moyenne,
          MAX(vues) as meilleure_performance,
          MIN(vues) as pire_performance
        FROM promotions 
        WHERE id_client = ?
      `, [clientId]);
  
      // Performance par pack
      const [packStats] = await pool.execute(`
        SELECT 
          p.nom_pack,
          COUNT(pr.id) as nombre_promotions,
          SUM(pr.vues) as total_vues,
          AVG(pr.vues) as vues_moyennes,
          SUM(pr.budget_initial) as budget_total
        FROM promotions pr
        JOIN packs p ON pr.id_pack = p.id
        WHERE pr.id_client = ?
        GROUP BY p.id, p.nom_pack
        ORDER BY total_vues DESC
      `, [clientId]);
  
      res.status(200).json({
        monthlyStats: monthlyStats,
        globalStats: globalStats[0] || {},
        packStats: packStats,
        success: true
      });
  
    } catch (error) {
      console.error("Erreur getDetailedStats:", error);
      res.status(500).json({ 
        message: 'Erreur serveur',
        success: false 
      });
    }
  };


  exports.getDetailedStatsWithInteractions = async (req, res) => {
    const clientId = req.user.id;
    try {
        const [monthlyInteractions] = await pool.execute(`
            SELECT 
                YEAR(i.date_interaction) as annee,
                MONTH(i.date_interaction) as mois,
                COUNT(CASE WHEN i.type_interaction = 'vue' THEN 1 END) as total_vues,
                COUNT(CASE WHEN i.type_interaction = 'like' THEN 1 END) as total_likes,
                COUNT(CASE WHEN i.type_interaction = 'partage' THEN 1 END) as total_partages
            FROM interactions i
            INNER JOIN promotions p ON i.id_promotion = p.id
            WHERE p.id_client = ? 
                AND i.date_interaction >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY YEAR(i.date_interaction), MONTH(i.date_interaction)
            ORDER BY annee, mois
        `, [clientId]);

        const [globalFinancialStats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_promotions,
                SUM(budget_initial) as total_budget_depense
            FROM promotions 
            WHERE id_client = ?
        `, [clientId]);

        const currentDate = new Date();
        const monthlyData = [];
        
        for (let i = 11; i >= 0; i--) {
            const targetDate = new Date(currentDate);
            targetDate.setMonth(targetDate.getMonth() - i);
            const year = targetDate.getFullYear();
            const month = targetDate.getMonth() + 1;
            
            const existingData = monthlyInteractions.find(stat => 
                stat.annee === year && stat.mois === month
            );
            
            monthlyData.push({
                annee: year,
                mois: month,
                // --- CORRECTION CRUCIALE ICI ---
                // Appel direct de la fonction sans 'this.'
                nom_mois: getFrenchMonthName(month).substring(0, 3),
                total_vues: Number(existingData?.total_vues) || 0,
                total_likes: Number(existingData?.total_likes) || 0,
                total_partages: Number(existingData?.total_partages) || 0,
            });
        }
        
        const financialData = globalFinancialStats[0] || {};

        res.status(200).json({
            monthlyStats: monthlyData,
            globalStats: {
                total_promotions: Number(financialData.total_promotions) || 0,
                total_budget_depense: Number(financialData.total_budget_depense) || 0
            },
            success: true
        });

    } catch (error) {
        console.error("Erreur getDetailedStatsWithInteractions:", error);
        res.status(500).json({ 
            message: 'Erreur serveur lors de la récupération des statistiques',
            success: false 
        });
    }
};

/**
 * Helper function pour obtenir le nom du mois en français
 */
const getFrenchMonthName = (monthNumber) => {
  const months = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  return months[monthNumber - 1] || '';
};

/**
 * Récupère les statistiques en temps réel (30 derniers jours)
 */
exports.getRealTimeStats = async (req, res) => {
    const clientId = req.user.id;
    
    try {
        // Statistiques des 30 derniers jours
        const [recentStats] = await pool.execute(`
            SELECT 
                DATE(i.date_interaction) as date_interaction,
                COUNT(CASE WHEN i.type_interaction = 'vue' THEN 1 END) as vues,
                COUNT(CASE WHEN i.type_interaction = 'like' THEN 1 END) as likes,
                COUNT(CASE WHEN i.type_interaction = 'partage' THEN 1 END) as partages,
                COUNT(DISTINCT i.id_utilisateur) as utilisateurs_uniques
            FROM interactions i
            INNER JOIN promotions p ON i.id_promotion = p.id
            WHERE p.id_client = ? 
                AND i.date_interaction >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(i.date_interaction)
            ORDER BY date_interaction DESC
            LIMIT 30
        `, [clientId]);

        // Interactions aujourd'hui
        const [todayStats] = await pool.execute(`
            SELECT 
                COUNT(CASE WHEN i.type_interaction = 'vue' THEN 1 END) as vues_aujourdhui,
                COUNT(CASE WHEN i.type_interaction = 'like' THEN 1 END) as likes_aujourdhui,
                COUNT(CASE WHEN i.type_interaction = 'partage' THEN 1 END) as partages_aujourdhui,
                COUNT(DISTINCT i.id_utilisateur) as utilisateurs_aujourdhui
            FROM interactions i
            INNER JOIN promotions p ON i.id_promotion = p.id
            WHERE p.id_client = ? 
                AND DATE(i.date_interaction) = CURDATE()
        `, [clientId]);

        res.status(200).json({
            recentStats: recentStats,
            todayStats: todayStats[0] || {},
            success: true
        });

    } catch (error) {
        console.error("Erreur getRealTimeStats:", error);
        res.status(500).json({ 
            message: 'Erreur serveur',
            success: false 
        });
    }
};
exports.getRechargeHistory = async (req, res) => {
  const clientId = req.user.id;

  try {
      // On récupère les transactions de la table cinetpay_transactions
      // C'est cette table qui contient l'historique qui alimente le 'solde_recharge'
      const [transactions] = await pool.execute(
          `SELECT transaction_id, amount, status, created_at 
           FROM cinetpay_transactions 
           WHERE client_id = ? 
           ORDER BY created_at DESC`,
          [clientId]
      );

      res.status(200).json(transactions);

  } catch (error) {
      console.error("Erreur getRechargeHistory:", error);
      res.status(500).json({ message: 'Erreur lors de la récupération de l\'historique.' });
  }
};