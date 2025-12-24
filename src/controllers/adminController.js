// pubcash-api/src/controllers/adminController.js

const AdminModel = require('../models/adminModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const axios = require('axios'); // <--- AJOUTER CECI
const notificationService = require('../services/notificationService');
const BASE_URL = process.env.NODE_ENV === 'production'
  ? process.env.PRODUCTION_URL
  : process.env.DEVELOPMENT_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 5000}`;

const CINETPAY_APIKEY = process.env.CINETPAY_APIKEY || '';
const CINETPAY_SITE_ID = process.env.CINETPAY_SITE_ID || '859043';
const CINETPAY_SECRET_KEY = process.env.CINETPAY_SECRET_KEY || '521006956621e4e7a6a3d16.70681548';
exports.getClients = async (req, res) => {
  try {
    // sélectionne les champs que ton front attend
    const [rows] = await pool.execute(
      `SELECT id, nom, prenom, nom_utilisateur, email, commune, solde_recharge
         FROM clients`
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error('Erreur getClients:', err);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.getAdminWallet = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT solde FROM portefeuille_admin WHERE id = 1');
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Portefeuille admin non trouvé.' });
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error("Erreur getAdminWallet:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.getProfile = async (req, res) => {
  try {
    const adminId = req.user.id;
    const [rows] = await pool.execute('SELECT id, nom_utilisateur, email, role FROM administrateurs WHERE id = ?', [adminId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Admin non trouvé.' });
    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// --- NOUVELLE FONCTION POUR METTRE À JOUR LE PROFIL ADMIN ---
exports.updateProfile = async (req, res) => {
  const adminId = req.user.id; // ID de l'admin connecté (depuis le token)
  const { nom_utilisateur, email, newPassword, currentPassword } = req.body;

  try {
    // Validation des champs de base
    if (!nom_utilisateur || !email) {
      return res.status(400).json({ message: 'Le nom d\'utilisateur et l\'email sont requis.' });
    }

    // Vérifier si le nouvel email est déjà utilisé par un autre admin
    const [existingEmail] = await pool.execute(
      'SELECT id FROM administrateurs WHERE email = ? AND id != ?',
      [email, adminId]
    );
    if (existingEmail.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé par un autre administrateur.' });
    }

    // Mettre à jour les informations de base (nom d'utilisateur et email)
    await pool.execute(
      'UPDATE administrateurs SET nom_utilisateur = ?, email = ? WHERE id = ?',
      [nom_utilisateur, email, adminId]
    );

    // Logique de mise à jour du mot de passe (uniquement si les champs sont remplis)
    if (newPassword && currentPassword) {
      const [rows] = await pool.execute('SELECT mot_de_passe FROM administrateurs WHERE id = ?', [adminId]);
      const admin = rows[0];

      // Vérifier le mot de passe actuel
      const isMatch = await bcrypt.compare(currentPassword, admin.mot_de_passe);
      if (!isMatch) {
        return res.status(401).json({ message: 'Le mot de passe actuel est incorrect.' });
      }

      // Hacher et mettre à jour le nouveau mot de passe
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      await pool.execute('UPDATE administrateurs SET mot_de_passe = ? WHERE id = ?', [hashedNewPassword, adminId]);
    }

    res.status(200).json({ message: 'Profil administrateur mis à jour avec succès !' });

  } catch (error) {
    console.error("Erreur updateProfile (admin):", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- NOUVELLE FONCTION PRINCIPALE POUR LE DASHBOARD ---
exports.getDashboardData = async (req, res) => {
  try {
    const userRole = req.user.role;

    const promises = [
      pool.execute('SELECT id, nom, prenom, email, commune, solde_recharge, est_verifie FROM clients ORDER BY date_inscription DESC'),
      pool.execute('SELECT COUNT(*) as total FROM utilisateurs'),
      pool.execute(`SELECT c.commune, COUNT(p.id) as activity_count FROM promotions p JOIN clients c ON p.id_client = c.id GROUP BY c.commune ORDER BY activity_count DESC`)
    ];

    if (userRole === 'superadmin') {
      // Card 1 : REVENUS (ID = 1)
      promises.push(pool.execute('SELECT solde FROM portefeuille_admin WHERE id = 1'));
      // Card 2 : DISTRIBUTION (ID = 2) - C'est ici qu'on verra les 5300 FCFA
      promises.push(pool.execute('SELECT solde FROM portefeuille_admin WHERE id = 2'));
    }

    const results = await Promise.all(promises);

    let walletRevenue = 0;
    let walletDistribution = 0;

    if (userRole === 'superadmin') {
      // Gestion sécurisée si les portefeuilles n'existent pas encore
      walletRevenue = (results[3][0] && results[3][0][0]) ? results[3][0][0].solde : 0;
      walletDistribution = (results[4][0] && results[4][0][0]) ? results[4][0][0].solde : 0;
    }

    const dashboardData = {
      wallet: { solde: walletRevenue }, // Format attendu par le front pour Card 1
      totalRecharged: walletDistribution, // Pour Card 2
      clients: results[0][0],
      stats: {
        totalClients: results[0][0].length,
        totalUtilisateurs: results[1][0][0].total,
      },
      activityByCommune: results[2][0]
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error("Erreur getDashboardData:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// --- NOUVELLE FONCTION POUR SUPPRIMER UN CLIENT ---
exports.deleteClient = async (req, res) => {
  const { clientId } = req.params;
  try {
    // Dans une vraie app, on pourrait désactiver (SET is_active = false)
    // au lieu de supprimer. Ici, on supprime pour la simplicité.
    await pool.execute('DELETE FROM clients WHERE id = ?', [clientId]);
    res.status(200).json({ message: 'Client supprimé avec succès.' });
  } catch (error) {
    console.error("Erreur deleteClient:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Nouvelle fonction pour récupérer les demandes de retrait
exports.getWithdrawalRequests = async (req, res) => {
  const { status } = req.query;

  try {
    // 1. On modifie la requête SQL
    let query = `
            SELECT 
                dr.id, dr.montant, dr.statut, dr.date_demande, dr.date_traitement,
                dr.operateur_mobile, -- On ajoute l'opérateur
                u.nom_utilisateur AS utilisateur, 
                u.email, 
                u.contact AS telephone,
                -- On fait une jointure sur la table administrateurs pour récupérer le nom
                -- On utilise LEFT JOIN au cas où id_admin est NULL (demande en attente)
                admin.nom_utilisateur AS admin_processor 
            FROM demandes_retrait dr
            JOIN utilisateurs u ON dr.id_utilisateur = u.id
            LEFT JOIN administrateurs admin ON dr.id_admin = admin.id
        `;

    const params = [];

    if (status) {
      query += ` WHERE dr.statut = ?`;
      params.push(status);
    }

    query += ` ORDER BY dr.date_demande DESC`;

    const [requests] = await pool.execute(query, params);
    res.status(200).json(requests);
  } catch (error) {
    console.error("Erreur getWithdrawalRequests:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Fonction pour traiter une demande de retrait
exports.processWithdrawalRequest = async (req, res) => {
  const { requestId } = req.params;
  const { status } = req.body;
  const adminId = req.user.id;

  if (!status || !['traite', 'rejete'].includes(status)) {
    return res.status(400).json({ message: 'Statut invalide. Doit être "traite" ou "rejete".' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [requestRows] = await connection.execute(
      'SELECT * FROM demandes_retrait WHERE id = ? AND statut = "en_attente" FOR UPDATE',
      [requestId]
    );

    if (requestRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Demande non trouvée ou déjà traitée.' });
    }

    const request = requestRows[0];

    await connection.execute(
      'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW(), id_admin = ? WHERE id = ?',
      [status, adminId, requestId]
    );

    if (status === 'rejete') {
      await connection.execute(
        'UPDATE utilisateurs SET remuneration_utilisateur = remuneration_utilisateur + ? WHERE id = ?',
        [request.montant, request.id_utilisateur]
      );
    }

    await connection.commit();

    // Émettre l'événement WebSocket
    const io = req.app.get('io');
    io.to(`user-${request.id_utilisateur}`).emit('withdrawal-updated', {
      requestId: requestId,
      status: status
    });

    res.status(200).json({ message: `Demande ${status === 'traite' ? 'traitée' : 'rejetée'} avec succès.` });
  } catch (error) {
    await connection.rollback();
    console.error("Erreur processWithdrawalRequest:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    connection.release();
  }
};

// Récupérer la liste de tous les admins
exports.getAllAdmins = async (req, res) => {
  try {
    // On exclut le mot de passe pour la sécurité
    const [admins] = await pool.execute('SELECT id, nom_utilisateur, email, role, photo, date_creation FROM administrateurs');
    res.status(200).json(admins);
  } catch (error) {
    console.error("Erreur getAllAdmins:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Créer un nouvel administrateur (role = 'admin')
exports.createAdmin = async (req, res) => {
  const { nom_utilisateur, email, mot_de_passe } = req.body;

  if (!nom_utilisateur || !email || !mot_de_passe) {
    return res.status(400).json({ message: 'Tous les champs sont requis.' });
  }

  try {
    // Vérifier si l'email est déjà utilisé
    const [existing] = await pool.execute('SELECT id FROM administrateurs WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

    // On insère le nouvel utilisateur avec le rôle 'admin'
    await pool.execute(
      'INSERT INTO administrateurs (nom_utilisateur, email, mot_de_passe, role) VALUES (?, ?, ?, ?)',
      [nom_utilisateur, email, hashedPassword, 'admin']
    );

    res.status(201).json({ message: 'Administrateur créé avec succès !' });
  } catch (error) {
    console.error("Erreur createAdmin:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Supprimer un administrateur
exports.deleteAdmin = async (req, res) => {
  const { id } = req.params;
  const superAdminId = req.user.id; // L'ID du superadmin qui fait la requête

  if (parseInt(id, 10) === superAdminId) {
    return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }

  try {
    const [result] = await pool.execute('DELETE FROM administrateurs WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Administrateur non trouvé.' });
    }
    res.status(200).json({ message: 'Administrateur supprimé avec succès.' });
  } catch (error) {
    console.error("Erreur deleteAdmin:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

exports.getOnlineUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, nom_utilisateur, email, photo_profil, derniere_connexion FROM utilisateurs WHERE est_en_ligne = 1'
    );
    res.status(200).json(users);
  } catch (error) {
    console.error("Erreur getOnlineUsers:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// --- Créer une nouvelle VILLE ---
exports.createVille = async (req, res) => {
  const { nom } = req.body;
  if (!nom) {
    return res.status(400).json({ message: 'Le nom de la ville est requis.' });
  }
  try {
    const [existing] = await pool.execute('SELECT id FROM villes WHERE nom = ?', [nom]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Cette ville existe déjà.' });
    }
    const [result] = await pool.execute('INSERT INTO villes (nom) VALUES (?)', [nom]);
    res.status(201).json({
      id: result.insertId,
      nom,
      message: 'Ville créée avec succès !'
    });
  } catch (error) {
    console.error("Erreur createVille:", error);
    res.status(500).json({ message: 'Erreur serveur lors de la création de la ville.' });
  }
};

// --- Récupérer toutes les VILLES ---
exports.getAllVilles = async (req, res) => {
  try {
    const [villes] = await pool.execute('SELECT id, nom FROM villes ORDER BY nom ASC');
    res.status(200).json(villes);
  } catch (error) {
    console.error("Erreur getAllVilles:", error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des villes.' });
  }
};

// --- Créer une nouvelle COMMUNE ---
exports.createCommune = async (req, res) => {
  const { nom, id_ville } = req.body;
  if (!nom || !id_ville) {
    return res.status(400).json({ message: 'Le nom de la commune et la ville associée sont requis.' });
  }
  try {
    const [villeExists] = await pool.execute('SELECT id FROM villes WHERE id = ?', [id_ville]);
    if (villeExists.length === 0) {
      return res.status(404).json({ message: 'La ville sélectionnée n\'existe pas.' });
    }
    const [result] = await pool.execute('INSERT INTO communes (nom, id_ville) VALUES (?, ?)', [nom, id_ville]);
    res.status(201).json({
      id: result.insertId,
      nom,
      id_ville,
      message: 'Commune créée avec succès !'
    });
  } catch (error) {
    console.error("Erreur createCommune:", error);
    res.status(500).json({ message: 'Erreur serveur lors de la création de la commune.' });
  }
};

// --- Récupérer toutes les COMMUNES (avec le nom de leur ville) ---
exports.getAllCommunes = async (req, res) => {
  try {
    const query = `
      SELECT c.id, c.nom, c.id_ville, v.nom AS nom_ville
      FROM communes c
      JOIN villes v ON c.id_ville = v.id
      ORDER BY v.nom, c.nom ASC
    `;
    const [communes] = await pool.execute(query);
    res.status(200).json(communes);
  } catch (error) {
    console.error("Erreur getAllCommunes:", error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des communes.' });
  }
};
exports.getCommunesByVille = async (req, res) => {
  const villeId = req.params.id;
  try {
    const query = 'SELECT id, nom, id_ville FROM communes WHERE id_ville = ? ORDER BY nom ASC';
    const [rows] = await pool.execute(query, [villeId]);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Erreur getCommunesByVille:', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des communes.' });
  }
};

// --- SUPPRIMER UNE COMMUNE ---
exports.deleteCommune = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.execute('DELETE FROM communes WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Commune non trouvée.' });
    }
    res.status(200).json({ message: 'Commune supprimée avec succès.' });
  } catch (error) {
    console.error("Erreur deleteCommune:", error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// --- SUPPRIMER UNE COMMUNE ---
exports.deleteCommune = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.execute('DELETE FROM communes WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Commune non trouvée.' });
    }
    res.status(200).json({ message: 'Commune supprimée avec succès.' });
  } catch (error) {
    console.error("Erreur deleteCommune:", error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

exports.getClientDetails = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.execute(
      `SELECT id, nom, prenom, nom_utilisateur, email, telephone, commune, 
             solde_recharge, type_compte, nom_entreprise, est_bloque, profile_image_url 
             FROM clients WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Client non trouvé' });

    // Récupérer l'abonnement actif s'il existe
    const [subRows] = await pool.execute(
      `SELECT type_abonnement, date_fin FROM abonnements_promoteurs 
             WHERE id_client = ? AND statut = 'actif' AND date_fin > NOW() 
             ORDER BY date_fin DESC LIMIT 1`,
      [id]
    );

    const clientData = rows[0];

    // --- CORRECTION IMAGE : Construction de l'URL complète ---
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const finalProfileImage = clientData.profile_image_url
      ? (clientData.profile_image_url.startsWith('http')
        ? clientData.profile_image_url
        : `${baseUrl}/uploads/profile/${clientData.profile_image_url}`)
      : null;

    clientData.profile_image_url = finalProfileImage;
    // ---------------------------------------------------------

    clientData.abonnement = subRows.length > 0 ? subRows[0] : null;

    res.status(200).json(clientData);
  } catch (error) {
    console.error("Erreur getClientDetails:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// 2. Recharger le compte d'un client (Admin)
exports.adminRechargeClient = async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ message: "Montant invalide" });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Vérifier solde distribution (ID 2)
    const [distWallet] = await connection.execute('SELECT solde FROM portefeuille_admin WHERE id = 2 FOR UPDATE');

    // Si le portefeuille n'existe pas ou est vide
    const soldeDispo = (distWallet.length > 0) ? parseFloat(distWallet[0].solde) : 0;

    if (soldeDispo < amount) {
      await connection.rollback();
      return res.status(400).json({
        message: `Fonds de distribution insuffisants (${soldeDispo} FCFA). Veuillez recharger le compte Admin.`
      });
    }

    // 2. Déduire de ID 2
    await connection.execute('UPDATE portefeuille_admin SET solde = solde - ? WHERE id = 2', [amount]);

    // 3. Créditer Client
    await connection.execute('UPDATE clients SET solde_recharge = solde_recharge + ? WHERE id = ?', [amount, id]);

    await connection.commit();
    res.status(200).json({ message: `Client rechargé de ${amount} FCFA avec succès.` });
  } catch (error) {
    await connection.rollback();
    console.error("Erreur recharge client:", error);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    connection.release();
  }
};
// 3. Activer un abonnement Premium manuellement
exports.adminActivateSubscription = async (req, res) => {
  const { id } = req.params;
  const { planType } = req.body; // 'super_promoteur' ou 'promoteur_ultra'

  // Configuration simple des plans (copié de ton subscriptionController)
  const PLANS = {
    super_promoteur: { duration: 3, price: 0 },
    promoteur_ultra: { duration: 6, price: 0 }
  };

  if (!PLANS[planType]) return res.status(400).json({ message: "Type d'abonnement invalide" });

  try {
    const dateDebut = new Date();
    const dateFin = new Date();
    dateFin.setMonth(dateFin.getMonth() + PLANS[planType].duration);
    const transactionId = `ADM_${Date.now()}`;

    // Désactiver les anciens abonnements
    await pool.execute(
      "UPDATE abonnements_promoteurs SET statut = 'expire' WHERE id_client = ?",
      [id]
    );

    // Créer le nouveau
    await pool.execute(
      `INSERT INTO abonnements_promoteurs 
            (id_client, type_abonnement, prix, date_debut, date_fin, statut, transaction_id)
            VALUES (?, ?, 0, ?, ?, 'actif', ?)`,
      [id, planType, dateDebut, dateFin, transactionId]
    );

    res.status(200).json({ message: "Abonnement activé avec succès." });
  } catch (error) {
    console.error("Erreur adminActivateSubscription:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// 4. Bloquer ou Débloquer un client
exports.toggleBlockClient = async (req, res) => {
  const { id } = req.params;
  const { est_bloque } = req.body; // true ou false

  try {
    await pool.execute(
      'UPDATE clients SET est_bloque = ? WHERE id = ?',
      [est_bloque ? 1 : 0, id]
    );
    res.status(200).json({ message: est_bloque ? "Client bloqué." : "Client débloqué." });
  } catch (error) {
    console.error("Erreur toggleBlockClient:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(`
            SELECT id, nom, prenom, nom_utilisateur, email, contact, 
                   commune_choisie, photo_profil, points, remuneration_utilisateur, 
                   est_bloque, date_inscription 
            FROM utilisateurs 
            ORDER BY date_inscription DESC
        `);

    // Traitement rapide des images si nécessaire (comme dans userController)
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const processedUsers = users.map(u => ({
      ...u,
      photo_profil: u.photo_profil && !u.photo_profil.startsWith('http')
        ? `${baseUrl}/uploads/profile/${u.photo_profil}`
        : u.photo_profil
    }));

    res.status(200).json(processedUsers);
  } catch (error) {
    console.error("Erreur getAllUsers:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// 2. Récupérer les détails d'un utilisateur spécifique (Stats + Infos)
exports.getUserDetailsAdmin = async (req, res) => {
  const { id } = req.params;
  try {
    // Infos principales
    const [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const user = rows[0];

    // Stats : Nombre de vidéos regardées
    const [videoStats] = await pool.execute(
      `SELECT COUNT(*) as total_videos_vues 
             FROM interactions 
             WHERE id_utilisateur = ? AND type_interaction = 'vue'`,
      [id]
    );

    // Stats : Total gains (calculé via l'historique ou pris directement du solde)
    const [gainStats] = await pool.execute(
      `SELECT SUM(montant) as total_gagne_historique 
             FROM user_gains 
             WHERE id_utilisateur = ?`,
      [id]
    );

    // Gestion de l'image
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    if (user.photo_profil && !user.photo_profil.startsWith('http')) {
      user.photo_profil = `${baseUrl}/uploads/profile/${user.photo_profil}`;
    }

    res.status(200).json({
      ...user,
      stats: {
        videos_vues: videoStats[0].total_videos_vues,
        total_gagne_historique: gainStats[0].total_gagne_historique || 0
      }
    });

  } catch (error) {
    console.error("Erreur getUserDetailsAdmin:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// 3. Modifier un utilisateur (Admin)
exports.updateUserByAdmin = async (req, res) => {
  const { id } = req.params; // ID de l'utilisateur mobile
  const { nom, prenom, email, contact, commune_choisie, points, solde } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // A. Récupérer l'utilisateur actuel
    const [currentUser] = await connection.execute('SELECT remuneration_utilisateur, points FROM utilisateurs WHERE id = ? FOR UPDATE', [id]);
    if (currentUser.length === 0) { await connection.rollback(); return res.status(404).json({ message: "User introuvable" }); }

    const oldBalance = parseFloat(currentUser[0].remuneration_utilisateur || 0);
    const oldPoints = parseInt(currentUser[0].points || 0);

    const newBalance = parseFloat(solde);
    const newPoints = parseInt(points);

    const differenceSolde = newBalance - oldBalance;
    const differencePoints = newPoints - oldPoints;

    // B. Si on AUGMENTE le solde, on déduit du compte Admin (ID 2)
    if (differenceSolde > 0) {
      const [distWallet] = await connection.execute('SELECT solde FROM portefeuille_admin WHERE id = 2 FOR UPDATE');
      const soldeDispo = (distWallet.length > 0) ? parseFloat(distWallet[0].solde) : 0;

      if (soldeDispo < differenceSolde) {
        await connection.rollback();
        // Message spécifique pour le frontend
        return res.status(400).json({
          message: `Fonds insuffisants` // Mot clé pour le frontend
        });
      }

      await connection.execute('UPDATE portefeuille_admin SET solde = solde - ? WHERE id = 2', [differenceSolde]);
    }

    // C. Update User
    await connection.execute(
      `UPDATE utilisateurs SET nom=?, prenom=?, email=?, contact=?, commune_choisie=?, points=?, remuneration_utilisateur=? WHERE id=?`,
      [nom, prenom, email, contact, commune_choisie, points, solde, id]
    );

    await connection.commit();

    // --- D. ENVOI DES NOTIFICATIONS MOBILES ---
    // On fait ça après le commit pour ne pas bloquer si la notif échoue
    try {
      // Notification pour l'ARGENT
      if (differenceSolde > 0) {
        await notificationService.envoyerNotification(
          id,
          'rechargement',
          'Compte Rechargé 💰',
          `Félicitations ! L'administrateur a rechargé votre compte de ${differenceSolde.toLocaleString('fr-FR')} FCFA.`,
          { screen: 'wallet', new_balance: newBalance.toString() }
        );
      }

      // Notification pour les POINTS
      if (differencePoints > 0) {
        await notificationService.envoyerNotification(
          id,
          'points_gagnes',
          'Points Reçus 🎁',
          `Vous avez reçu ${differencePoints} points bonus de la part de l'administrateur !`,
          { screen: 'profile', new_points: newPoints.toString() }
        );
      }
    } catch (notifError) {
      console.error("Erreur envoi notification (updateUserByAdmin):", notifError.message);
      // On ne fail pas la requête HTTP car la DB est déjà à jour
    }

    res.status(200).json({ message: "Utilisateur mis à jour avec succès." });

  } catch (error) {
    await connection.rollback();
    console.error("Erreur update user:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    connection.release();
  }
};
// 4. Bloquer / Débloquer un utilisateur
exports.toggleBlockUser = async (req, res) => {
  const { id } = req.params;
  const { est_bloque } = req.body; // true ou false

  try {
    await pool.execute(
      'UPDATE utilisateurs SET est_bloque = ? WHERE id = ?',
      [est_bloque ? 1 : 0, id]
    );
    res.status(200).json({ message: est_bloque ? "Utilisateur bloqué." : "Utilisateur débloqué." });
  } catch (error) {
    console.error("Erreur toggleBlockUser:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.rechargeAdminAccount = async (req, res) => {
  const adminId = req.user.id;
  const { amount, phone } = req.body;

  // Vérification SuperAdmin (Sécurité supplémentaire)
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: "Accès refusé. Réservé aux SuperAdmins." });
  }

  if (!amount || isNaN(amount) || Number(amount) < 100) {
    return res.status(400).json({ message: 'Le montant minimum est de 100 FCFA.' });
  }

  if (!phone) {
    return res.status(400).json({ message: 'Le numéro de téléphone est requis pour le paiement.' });
  }

  try {
    // Formatage du téléphone (Ta logique existante)
    let formattedPhone = phone.trim().replace(/\s+/g, '').replace(/[^\d+]/g, '');

    // Validation basique
    const isValidPhone = (p) => {
      if (p.startsWith('+225') && p.length === 13) return true;
      if (p.startsWith('225') && p.length === 12) return true;
      if (/^\d{10}$/.test(p)) return true;
      return false;
    };

    if (!isValidPhone(formattedPhone)) {
      return res.status(400).json({ message: 'Numéro invalide.' });
    }

    // Normalisation CinetPay (+225...)
    if (formattedPhone.startsWith('225')) formattedPhone = '+' + formattedPhone;
    else if (/^\d{10}$/.test(formattedPhone)) formattedPhone = '+225' + formattedPhone;

    const transactionId = `ADM_RECH_${adminId}_${Date.now()}`;

    // Insertion dans la nouvelle table 'solde_recharge'
    await pool.execute(
      'INSERT INTO solde_recharge (transaction_id, admin_id, montant, telephone_utilise, statut) VALUES (?, ?, ?, ?, ?)',
      [transactionId, adminId, Number(amount), formattedPhone, 'PENDING']
    );

    // Données pour CinetPay
    const checkoutData = {
      transaction_id: transactionId,
      amount: Number(amount),
      currency: 'XOF',
      channels: 'ALL',
      description: `Recharge Admin PubCash`,
      customer_name: "Administrateur",
      customer_surname: "SuperAdmin", // Valeurs par défaut car pas de nom/prenom dans la table admin
      customer_email: req.user.email || "admin@pubcash.com",
      customer_phone_number: formattedPhone,
      customer_city: "Abidjan",
      customer_country: "CI",
      customer_state: "CI",
      customer_zip_code: "0000"
    };

    res.status(200).json({
      message: 'Paiement initialisé',
      cinetpay_config: {
        apikey: CINETPAY_APIKEY,
        site_id: CINETPAY_SITE_ID,
        notify_url: `${BASE_URL}/webhook/cinetpay-admin`, // IMPORTANT: Tu devras gérer ce webhook pour créditer 'portefeuille_admin'
        mode: 'PRODUCTION'
      },
      checkout_data: checkoutData
    });

  } catch (error) {
    console.error('❌ Erreur rechargeAdminAccount:', error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// 2. Récupérer l'historique des rechargements ADMIN
exports.getAdminRechargeHistory = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
            SELECT sr.*, a.nom_utilisateur 
            FROM solde_recharge sr
            JOIN administrateurs a ON sr.admin_id = a.id
            WHERE sr.statut = 'ACCEPTED'  -- FILTRE AJOUTÉ ICI
            ORDER BY sr.date_recharge DESC
            LIMIT 50
        `);
    res.status(200).json(rows);
  } catch (error) {
    console.error("Erreur getAdminRechargeHistory:", error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.verifyAdminRecharge = async (req, res) => {
  const { transaction_id } = req.body;
  const adminId = req.user.id;

  if (!transaction_id) return res.status(400).json({ message: 'Transaction ID requis.' });

  try {
    const [txRows] = await pool.execute('SELECT * FROM solde_recharge WHERE transaction_id = ? AND admin_id = ?', [transaction_id, adminId]);
    if (txRows.length === 0) return res.status(404).json({ message: 'Transaction introuvable.' });
    const tx = txRows[0];

    if (tx.statut === 'ACCEPTED') return res.status(200).json({ message: 'Déjà validée.' });

    // Vérification API CinetPay
    const payload = { apikey: CINETPAY_APIKEY, site_id: CINETPAY_SITE_ID, transaction_id: transaction_id };
    const checkResp = await axios.post('https://api-checkout.cinetpay.com/v2/payment/check', payload, { headers: { 'Content-Type': 'application/json' } });

    if (checkResp.data?.data?.status === 'ACCEPTED') {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // MAJ Historique
        await connection.execute('UPDATE solde_recharge SET statut = ?, date_recharge = NOW() WHERE id = ?', ['ACCEPTED', tx.id]);

        // Création du portefeuille ID=2 si inexistant
        await connection.execute(`INSERT INTO portefeuille_admin (id, solde) SELECT 2, 0 WHERE NOT EXISTS (SELECT 1 FROM portefeuille_admin WHERE id = 2)`);

        // CRÉDITER ID=2
        await connection.execute('UPDATE portefeuille_admin SET solde = solde + ? WHERE id = 2', [Number(tx.montant)]);

        await connection.commit();
        return res.status(200).json({ message: 'Rechargement validé.' });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      return res.status(400).json({ message: "Paiement non confirmé." });
    }
  } catch (error) {
    console.error("Erreur verify:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};