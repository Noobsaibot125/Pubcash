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
      // Lancer toutes les requêtes en parallèle pour une performance maximale
      const [
          walletRes,
          clientsRes,
          utilisateursRes,
          activityRes
      ] = await Promise.all([
          pool.execute('SELECT solde FROM portefeuille_admin WHERE id = 1'),
          pool.execute('SELECT id, nom, prenom, email, commune, solde_recharge, est_verifie FROM clients ORDER BY date_inscription DESC'),
          pool.execute('SELECT COUNT(*) as total FROM utilisateurs'),
          pool.execute(`
            SELECT c.commune, COUNT(p.id) as activity_count 
            FROM promotions p
            JOIN clients c ON p.id_client = c.id
            GROUP BY c.commune 
            ORDER BY activity_count DESC
        `)
      ]);

      const dashboardData = {
          wallet: walletRes[0][0],
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
