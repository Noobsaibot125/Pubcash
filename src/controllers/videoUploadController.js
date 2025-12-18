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

// --- CONFIGURATION MULTER (Stockage temporaire pour le traitement) ---
// On garde le fichier brut temporairement, on le traitera ensuite
const promotionStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, videosDir); 
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const base = sanitizeFileName(path.parse(file.originalname).name);
    // On ajoute "raw-" pour signifier que c'est le fichier brut
    cb(null, `raw-${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
  }
});

const uploadPromotionVideo = multer({ 
    storage: promotionStorage,
    limits: { fileSize: 500 * 1024 * 1024 } // Limite à 500MB pour l'upload initial
});

// --- CONFIGURATION LANDING (Pas de changement ici) ---
const landingStorage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, landingDir); },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = sanitizeFileName(path.parse(file.originalname).name);
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});
const uploadLandingFiles = multer({ storage: landingStorage });


// --- FONCTION DE TRAITEMENT VIDÉO (Le cœur du système) ---
const processVideo = (inputPath, outputPath, filename) => {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .output(outputPath)
            // 1. Codec vidéo H.264 (Universel)
            .videoCodec('libx264')
            // 2. Audio AAC (Universel)
            .audioCodec('aac')
            .audioBitrate('128k')
            // 3. Redimensionnement : Largeur 1080px, Hauteur auto (divisible par 2 pour ffmpeg)
            // Si la vidéo est verticale, ça garde la qualité. Si 4K, ça réduit à 1080p.
            .outputOptions([
                '-vf scale=1080:-2', 
                '-preset fast',       // Encodage rapide (balance vitesse/taille)
                '-crf 23',            // Qualité visuelle (plus bas = meilleure qualité, 23 est standard)
                '-r 30',              // Force 30 FPS (Standard Instagram/TikTok)
                '-movflags +faststart', // INDISPENSABLE : Permet le streaming immédiat (Web Optimized)
                '-pix_fmt yuv420p'    // Assure la compatibilité avec tous les lecteurs (Android/iOS)
            ])
            .on('end', () => {
                console.log(`✅ Vidéo traitée et optimisée : ${filename}`);
                resolve();
            })
            .on('error', (err) => {
                console.error('❌ Erreur FFmpeg :', err);
                reject(err);
            })
            .run();
    });
};

// --- MIDDLEWARES ---

// Middleware pour l'upload d'UNE SEULE vidéo de promotion avec TRAITEMENT
exports.uploadSingle = [
  uploadPromotionVideo.single('video'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'Aucun fichier vidéo envoyé.' });

      const rawFilePath = req.file.path;
      // Nom final propre (sans "raw-")
      const finalFileName = req.file.filename.replace('raw-', ''); 
      const finalFilePath = path.join(videosDir, finalFileName);
      const thumbFilename = `${path.parse(finalFileName).name}.jpg`;

      console.log('🔄 Début du traitement vidéo...');

      // 1. Lancer la conversion (Ré-encodage style Instagram)
      await processVideo(rawFilePath, finalFilePath, finalFileName);

      // 2. Générer la miniature depuis la vidéo OPTIMISÉE
      await new Promise((resolve) => {
        ffmpeg(finalFilePath)
          .screenshots({
            timestamps: ['20%'], // Prend une image à 20% de la vidéo (souvent mieux que 00:01)
            filename: thumbFilename,
            folder: thumbsDir,
            size: '640x360'
          })
          .on('end', resolve)
          .on('error', (err) => {
            console.warn('⚠️ Erreur miniature (non bloquant) :', err);
            resolve();
          });
      });

      // 3. Supprimer le fichier brut (raw) pour économiser de l'espace
      fs.unlink(rawFilePath, (err) => {
        if (err) console.error("Erreur suppression fichier raw:", err);
        else console.log("🗑️ Fichier brut supprimé.");
      });

      // 4. Retourner le nom du fichier optimisé
      return res.status(201).json({
        message: 'Vidéo uploadée et optimisée avec succès.',
        videoFilename: finalFileName, // C'est ce nom que le frontend enverra à createPromotion
        thumbFilename: thumbFilename
      });

    } catch (err) {
      console.error('Erreur uploadSingle:', err);
      // En cas d'erreur grave, on essaie de nettoyer le fichier brut s'il existe
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({ message: 'Erreur lors du traitement de la vidéo.' });
    }
  }
];

// Middleware pour l'upload Landing (inchangé)
exports.uploadLanding = [
  uploadLandingFiles.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'video', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
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