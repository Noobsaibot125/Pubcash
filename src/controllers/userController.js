const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
/**
 * @desc    Récupère les informations du profil de l'utilisateur connecté
 * @route   GET /api/user/profile
 * @access  Privé
 */
exports.getProfileForUser = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Récupérer l'utilisateur
    let [rows] = await pool.execute(
      `SELECT 
          id, nom, prenom, nom_utilisateur, email, contact, 
          commune_choisie, date_naissance, photo_profil, image_background,
          code_parrainage, points, remuneration_utilisateur,
          id_google, id_facebook
       FROM utilisateurs 
       WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    let user = rows[0];

    // --- CORRECTION IMAGE : GESTION DU FORMAT HEXADÉCIMAL ---
    const processImage = (rawData, folder) => {
      if (!rawData) return null;

      // 1. Convertir si c'est un Buffer ou une string Hex (0x...)
      let imageStr = rawData.toString();
      if (imageStr.startsWith('0x')) {
        // Décodage Hex vers String lisible
        imageStr = Buffer.from(imageStr.slice(2), 'hex').toString('utf8');
      }

      // 2. Vérifier si c'est une URL complète (Google/Facebook)
      if (imageStr.startsWith('http')) {
        return imageStr;
      }

      // 3. Sinon, c'est un fichier local -> On ajoute le domaine
      return `${req.protocol}://${req.get('host')}/uploads/${folder}/${imageStr}`;
    };

    // On écrase les valeurs brutes par les URL traitées pour faciliter la vie au Frontend
    const profile_image_url = processImage(user.photo_profil, 'profile');
    const background_image_url = processImage(user.image_background, 'background');

    // On met à jour l'objet user pour que le champ 'photo_profil' contienne le nom propre décodé (utile pour l'édition)
    // Optionnel : tu peux garder l'original si tu veux, mais le frontend a besoin de profile_image_url
    // ---------------------------------------------------------

    // --- Code parrainage (inchangé) ---
    if (!user.code_parrainage) {
      const newCode = uuidv4().substring(0, 8).toUpperCase();
      await pool.execute('UPDATE utilisateurs SET code_parrainage = ? WHERE id = ?', [newCode, userId]);
      user.code_parrainage = newCode;
    }

    const [referrals] = await pool.execute(
      `SELECT nom_utilisateur, date_inscription FROM utilisateurs WHERE parrain_id = ? ORDER BY date_inscription DESC`,
      [userId]
    );

    res.status(200).json({
      ...user,
      photo_profil: profile_image_url, // On envoie directement l'URL finale utilisable
      image_background: background_image_url, // Idem
      referrals
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
  const { nom, prenom, nom_utilisateur, contact, newPassword, currentPassword } = req.body;

  try {
    // 1. Validation des champs obligatoires (hors mdp)
    if (!nom || !prenom || !nom_utilisateur) {
      return res.status(400).json({ message: 'Le nom, le prénom et le nom d\'utilisateur sont requis.' });
    }

    // 2. Récupérer l'utilisateur pour vérifier son type (Social ou Classique)
    // On récupère aussi id_google et id_facebook pour savoir si c'est un compte social
    const [rows] = await pool.execute(
      'SELECT mot_de_passe, id_google, id_facebook FROM utilisateurs WHERE id = ?',
      [userId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }
    const user = rows[0];

    // --- LOGIQUE DE SÉCURITÉ INTELLIGENTE ---
    const isSocialUser = user.id_google || user.id_facebook;
    const hasPassword = user.mot_de_passe && user.mot_de_passe.length > 0;

    // Si l'utilisateur n'est PAS social (donc il a un mot de passe), on DOIT vérifier
    if (!isSocialUser && hasPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Veuillez confirmer votre mot de passe pour enregistrer les modifications.' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.mot_de_passe);
      if (!isMatch) {
        return res.status(401).json({ message: 'Le mot de passe actuel est incorrect.' });
      }
    }
    // Si c'est un utilisateur Social, on saute la vérification du mot de passe actuel
    // ----------------------------------------

    // 3. Mise à jour des informations de base
    await pool.execute(
      'UPDATE utilisateurs SET nom = ?, prenom = ?, nom_utilisateur = ?, contact = ? WHERE id = ?',
      [nom, prenom, nom_utilisateur, contact || null, userId]
    );

    // 4. Changement de mot de passe (Optionnel)
    // Un utilisateur social peut définir un mot de passe s'il le souhaite (pour se connecter par email aussi)
    if (newPassword) {
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      await pool.execute('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?', [hashedNewPassword, userId]);
    }

    return res.status(200).json({ message: 'Profil mis à jour avec succès !' });

  } catch (error) {
    console.error("Erreur [updateProfileForUser]:", error);
    return res.status(500).json({ message: 'Erreur serveur lors de la mise à jour du profil.' });
  }
};