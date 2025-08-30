// pubcash-api/src/controllers/videoUploadController.js

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');

// Définition des chemins de dossiers
const uploadsBase = path.join(__dirname, '..', '..', 'uploads');
const videosDir = path.join(uploadsBase, 'videos');
const thumbsDir = path.join(uploadsBase, 'thumbnails');
const landingDir = path.join(uploadsBase, 'landing');

// Création des dossiers si nécessaire
[uploadsBase, videosDir, thumbsDir, landingDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Helper pour nettoyer les noms de fichiers
const sanitizeFileName = (name) => name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-._]/g, '');


// --- CONFIGURATION N°1 : Pour les vidéos des promotions ---
const promotionStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, videosDir); // Enregistre dans /uploads/videos/
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const base = sanitizeFileName(path.parse(file.originalname).name);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
  }
});
const uploadPromotionVideo = multer({ storage: promotionStorage });


// --- CONFIGURATION N°2 : Pour les fichiers de la page d'accueil (landing) ---
const landingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, landingDir); // Enregistre dans /uploads/landing/
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = sanitizeFileName(path.parse(file.originalname).name);
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});
const uploadLandingFiles = multer({ storage: landingStorage });


// --- EXPORTS DES MIDDLEWARES ---

// Middleware pour l'upload d'UNE SEULE vidéo de promotion
exports.uploadSingle = [
  uploadPromotionVideo.single('video'), // On utilise la bonne instance multer
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'Aucun fichier vidéo envoyé.' });

      const filePath = req.file.path;
      const thumbFilename = `${path.parse(req.file.filename).name}.jpg`;
      
      await new Promise((resolve) => {
        ffmpeg(filePath)
          .screenshots({
            timestamps: ['00:00:01.000'],
            filename: thumbFilename,
            folder: thumbsDir, // Le thumbnail va dans /uploads/thumbnails/
            size: '640x360'
          })
          .on('end', resolve)
          .on('error', (err) => {
            console.warn('Erreur génération miniature (ffmpeg) — on continue :', err);
            resolve();
          });
      });

      // On renvoie les noms de fichiers simples
      return res.status(201).json({
        message: 'Fichier uploadé avec succès.',
        videoFilename: req.file.filename,
        thumbFilename: thumbFilename
      });

    } catch (err) {
      console.error('Erreur uploadSingle:', err);
      return res.status(500).json({ message: 'Erreur interne du serveur lors de l\'upload.' });
    }
  }
];

// Middleware pour l'upload des fichiers de la page d'accueil
exports.uploadLanding = [
  uploadLandingFiles.fields([ // On utilise la bonne instance multer
    { name: 'logo', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'video', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      // Le reste de cette fonction est déjà correct et n'a pas besoin de changer
      req.uploadResults = {};
      if (req.files?.logo?.[0]) req.uploadResults.logoPath = `/uploads/landing/${req.files.logo[0].filename}`;
      if (req.files?.image?.[0]) req.uploadResults.imagePath = `/uploads/landing/${req.files.image[0].filename}`;
      if (req.files?.video?.[0]) req.uploadResults.videoPath = `/uploads/landing/${req.files.video[0].filename}`;
      next();
    } catch (err) {
      next(err);
    }
  }
];