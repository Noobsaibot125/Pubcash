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