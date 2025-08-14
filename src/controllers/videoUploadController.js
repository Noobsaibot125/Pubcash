// pubcash-api/src/controllers/videouploadController.js
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');

// Chemins corrigés
const videosDir = path.join(__dirname, '..', '..', 'uploads', 'videos');
const thumbsDir = path.join(__dirname, '..', '..', 'uploads', 'thumbnails');

// Créer les répertoires s'ils n'existent pas
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, videosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });

exports.uploadSingle = [
  upload.single('video'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Aucun fichier vidéo n\'a été envoyé.' });
      }

      const videoPath = req.file.path;
      const thumbFilename = `${path.parse(req.file.filename).name}.jpg`;

      // Génération de la miniature
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .screenshots({
            timestamps: ['00:00:01.000'],
            filename: thumbFilename,
            folder: thumbsDir,
            size: '640x360'
          })
          .on('end', resolve)
          .on('error', (err) => {
            console.error('Erreur génération thumbnail:', err);
            resolve();
          });
      });

      // CORRECTION : Renvoyer uniquement les noms de fichiers
      return res.status(201).json({
        message: 'Fichier uploadé avec succès.',
        videoFilename: req.file.filename,
        thumbFilename: thumbFilename
      });

    } catch (err) {
      console.error('Erreur upload:', err);
      return res.status(500).json({ message: 'Erreur interne' });
    }
  }
];