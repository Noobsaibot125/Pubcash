const pool = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * @desc    Récupère les informations du profil de l'utilisateur connecté
 * @route   GET /api/user/profile
 * @access  Privé
 */
exports.getProfileForUser = async (req, res) => {
    try {
      const userId = req.user.id;
      const [rows] = await pool.execute(
        `SELECT 
            id, nom, prenom, nom_utilisateur, email, contact, 
            commune_choisie, date_naissance, photo_profil, image_background 
         FROM utilisateurs 
         WHERE id = ?`,
        [userId]
      );
  
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Utilisateur non trouvé.' });
      }
  
      const user = rows[0];
  
      // Construire les URLs complètes à renvoyer au front
      const profile_image_url = user.photo_profil ? `${req.protocol}://${req.get('host')}/uploads/profile/${user.photo_profil}` : null;
      const background_image_url = user.image_background ? `${req.protocol}://${req.get('host')}/uploads/background/${user.image_background}` : null;
  
      // Retourner l'objet complet (incluant filename et URL)
      res.status(200).json({
        ...user,
        profile_image_url,
        background_image_url
      });
  
    } catch (error) {
      console.error("Erreur [getProfileForUser]:", error);
      res.status(500).json({ message: 'Erreur serveur lors de la récupération du profil.' });
    }
  };
  

/**
 * @desc    Met à jour le profil de l'utilisateur connecté
 * @route   PUT /api/user/profile
 * @access  Privé
 */
exports.updateProfileForUser = async (req, res) => {
    const userId = req.user.id;
    // On récupère les données du corps de la requête
    const { nom, prenom, nom_utilisateur, contact, newPassword, currentPassword } = req.body;

    try {
        // Validation simple des champs requis
        if (!nom || !prenom || !nom_utilisateur) {
            return res.status(400).json({ message: 'Le nom, le prénom et le nom d\'utilisateur sont requis.' });
        }

        // 1. Mettre à jour les informations de base (texte)
        await pool.execute(
            'UPDATE utilisateurs SET nom = ?, prenom = ?, nom_utilisateur = ?, contact = ? WHERE id = ?',
            [nom, prenom, nom_utilisateur, contact || null, userId]
        );

        // 2. Gérer la mise à jour du mot de passe (si demandé)
        if (newPassword && currentPassword) {
            // On récupère le mot de passe actuel de la base de données
            const [rows] = await pool.execute('SELECT mot_de_passe FROM utilisateurs WHERE id = ?', [userId]);
            const user = rows[0];

            if (!user) {
                return res.status(404).json({ message: 'Utilisateur non trouvé.' });
            }

            // On compare le mot de passe fourni avec celui en base de données
            const isMatch = await bcrypt.compare(currentPassword, user.mot_de_passe);
            if (!isMatch) {
                return res.status(401).json({ message: 'Le mot de passe actuel est incorrect.' });
            }

            // Si le mot de passe actuel est correct, on crypte le nouveau
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            
            // On met à jour le mot de passe dans la base de données
            await pool.execute('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?', [hashedNewPassword, userId]);
        }

        res.status(200).json({ message: 'Profil mis à jour avec succès !' });

    } catch (error) {
        console.error("Erreur [updateProfileForUser]:", error);
        res.status(500).json({ message: 'Erreur serveur lors de la mise à jour du profil.' });
    }
}