// pubcash-api/src/controllers/adminController.js

const AdminModel = require('../models/adminModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

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
      pool.execute(`
            SELECT c.commune, COUNT(p.id) as activity_count 
            FROM promotions p
            JOIN clients c ON p.id_client = c.id
            GROUP BY c.commune 
            ORDER BY activity_count DESC
        `)
    ];

    if (userRole === 'superadmin') {
      promises.push(pool.execute('SELECT solde FROM portefeuille_admin WHERE id = 1'));
    }

    const results = await Promise.all(promises);

    const clientsRes = results[0];
    const utilisateursRes = results[1];
    const activityRes = results[2];
    let walletRes = null;

    if (userRole === 'superadmin') {
      walletRes = results[3];
    }

    const dashboardData = {
      wallet: walletRes ? walletRes[0][0] : null,
      clients: clientsRes[0],
      stats: {
        totalClients: clientsRes[0].length,
        totalUtilisateurs: utilisateursRes[0][0].total,
      },
      activityByCommune: activityRes[0]
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

    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: "Montant invalide" });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Créditer le client
        await connection.execute(
            'UPDATE clients SET solde_recharge = solde_recharge + ? WHERE id = ?',
            [amount, id]
        );

        // Enregistrer une trace dans l'historique admin (optionnel mais recommandé)
        // Tu peux créer une table 'admin_logs' plus tard si besoin.

        await connection.commit();
        res.status(200).json({ message: `Compte rechargé de ${amount} FCFA avec succès.` });
    } catch (error) {
        await connection.rollback();
        console.error("Erreur adminRechargeClient:", error);
        res.status(500).json({ message: 'Erreur serveur' });
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
    const { id } = req.params;
    const { nom, prenom, email, contact, commune_choisie, points, solde } = req.body;

    try {
        await pool.execute(
            `UPDATE utilisateurs 
             SET nom = ?, prenom = ?, email = ?, contact = ?, commune_choisie = ?, points = ?, remuneration_utilisateur = ?
             WHERE id = ?`,
            [nom, prenom, email, contact, commune_choisie, points, solde, id]
        );
        res.status(200).json({ message: "Informations utilisateur mises à jour." });
    } catch (error) {
        console.error("Erreur updateUserByAdmin:", error);
        res.status(500).json({ message: 'Erreur serveur' });
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