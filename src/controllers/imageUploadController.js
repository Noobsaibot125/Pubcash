// pubcash-api/src/controllers/imageUploadController.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');

// CORRECTION : Créer les dossiers s'ils n'existent pas
const ensureUploadDirs = () => {
  const folders = ['profile', 'background', 'thumbnails', 'videos'];
  folders.forEach(folder => {
    const dir = path.join(__dirname, '..', '..', 'uploads', folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Dossier créé: ${dir}`);
    }
  });
};

// Appeler au démarrage
ensureUploadDirs();

// CORRECTION : Storage amélioré avec gestion d'erreurs
const storage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', folder);
    // S'assurer que le dossier existe
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}-${uniqueSuffix}${ext}`);
  }
});

// Filtre amélioré
const imageFileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (file.mimetype && allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non autorisé. Types acceptés: ${allowedMimes.join(', ')}`), false);
  }
};

const limits = { fileSize: 50 * 1024 * 1024 }; // 50MB

// CORRECTION : Multer config avec le bon field name
const uploadProfile = multer({ 
  storage: storage('profile'), 
  fileFilter: imageFileFilter, 
  limits 
}).single('file'); // CHANGEMENT ICI : 'file' au lieu de 'profileImage'

const uploadBackground = multer({ 
  storage: storage('background'), 
  fileFilter: imageFileFilter, 
  limits 
}).single('file'); // CHANGEMENT ICI : 'file' au lieu de 'backgroundImage'

// CORRECTION : Fonction de mise à jour améliorée
const updateImageInDb = (table, field, folder) => async (req, res) => {
  try {
    console.log('Upload image - Début:', { table, field, folder, file: req.file });
    
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni.' });
    }

    const userId = req.user.id;

    // Vérifier que l'utilisateur existe
    const [userRows] = await pool.execute(`SELECT id FROM ${table} WHERE id = ?`, [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Récupérer l'ancien fichier
    const [rows] = await pool.execute(`SELECT ${field} FROM ${table} WHERE id = ?`, [userId]);
    const previousFilename = rows[0] && rows[0][field];

    // Supprimer l'ancien fichier
    if (previousFilename) {
      try {
        const prevPath = path.join(__dirname, '..', '..', 'uploads', folder, previousFilename);
        if (fs.existsSync(prevPath)) {
          fs.unlinkSync(prevPath);
          console.log('Ancien fichier supprimé:', previousFilename);
        }
      } catch (err) {
        console.warn('Erreur suppression ancien fichier:', err.message);
      }
    }

    // Mettre à jour la base de données
    await pool.execute(
      `UPDATE ${table} SET ${field} = ?, updated_at = NOW() WHERE id = ?`,
      [req.file.filename, userId]
    );

    // Construire l'URL
    const imageUrl = `/uploads/${folder}/${req.file.filename}`;
    const fullImageUrl = `${req.protocol}://${req.get('host')}${imageUrl}`;

    console.log('Upload image - Succès:', { filename: req.file.filename, url: fullImageUrl });

    res.status(200).json({ 
      message: 'Image mise à jour avec succès.', 
      url: fullImageUrl,
      filename: req.file.filename,
      path: imageUrl
    });

  } catch (err) {
    console.error('Erreur upload image:', err);
    
    // Gestion d'erreurs spécifiques
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ message: 'Table de base de données introuvable.' });
    }
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(500).json({ message: 'Champ de base de données introuvable.' });
    }
    
    res.status(500).json({ 
      message: 'Erreur serveur lors du traitement de l\'image.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Middlewares pour clients (déjà présents dans votre fichier)
exports.uploadProfileImageForClient = [uploadProfile, updateImageInDb('clients', 'profile_image_url', 'profile')];
exports.uploadBackgroundImageForClient = [uploadBackground, updateImageInDb('clients', 'background_image_url', 'background')];

// Middlewares pour users (alias/équivalents) — adaptez la table/champ si nécessaire
exports.uploadProfileImageForUser = [uploadProfile, updateImageInDb('utilisateurs', 'photo_profil', 'profile')];
exports.uploadBackgroundImageForUser = [uploadBackground, updateImageInDb('utilisateurs', 'image_background', 'background')];