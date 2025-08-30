// pubcash-api/src/controllers/imageUploadController.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');

// Storage
const storage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'uploads', folder)),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Filtre et limites
const imageFileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers images sont autorisés.'), false);
  }
};
const limits = { fileSize: 2 * 1024 * 1024 }; // 2MB

const uploadProfile = multer({ storage: storage('profile'), fileFilter: imageFileFilter, limits }).single('profileImage');
const uploadBackground = multer({ storage: storage('background'), fileFilter: imageFileFilter, limits }).single('backgroundImage');

// Generic update helper : field = column name, folder = uploads subfolder, table = DB table
const updateImageInDb = (table, field, folder) => async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' });

    const userId = req.user.id;

    // Récupérer l'ancien filename (s'il existe)
    const [rows] = await pool.execute(`SELECT ${field} FROM ${table} WHERE id = ?`, [userId]);
    const previousFilename = rows[0] && rows[0][field];

    // Supprimer ancien fichier si présent (on suppose qu'on stocke le filename seul)
    if (previousFilename) {
      try {
        const prevPath = path.join(__dirname, '..', '..', 'uploads', folder, previousFilename);
        if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
      } catch (err) {
        console.warn('Suppression ancienne image échouée:', err.message || err);
      }
    }

    // Mettre à jour la DB : on stocke le filename uniquement
    await pool.execute(`UPDATE ${table} SET ${field} = ? WHERE id = ?`, [req.file.filename, userId]);

    // Construire l'URL complète pour la réponse
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${folder}/${req.file.filename}`;

    return res.status(200).json({ message: 'Image mise à jour.', url: imageUrl, filename: req.file.filename });

  } catch (err) {
    console.error('Erreur upload image:', err);
    if (err instanceof multer.MulterError || err.message) {
      return res.status(400).json({ message: err.message || 'Erreur upload.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Exports pour "utilisateurs" (si tu as aussi /user/*)
exports.uploadProfileImageForUser = [uploadProfile, updateImageInDb('utilisateurs', 'photo_profil', 'profile')];
exports.uploadBackgroundImageForUser = [uploadBackground, updateImageInDb('utilisateurs', 'image_background', 'background')];

// Exports pour "clients" (endpoints /client/*)
exports.uploadProfileImageForClient = [uploadProfile, updateImageInDb('clients', 'profile_image_url', 'profile')];
exports.uploadBackgroundImageForClient = [uploadBackground, updateImageInDb('clients', 'background_image_url', 'background')];
