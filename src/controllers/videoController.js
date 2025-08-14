// controllers/videoController.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/videos/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// route: POST /api/videos/upload
exports.uploadVideo = [
  upload.single('video'),
  async (req, res) => {
    try {
      const videopath = req.file.path; // ex: uploads/videos/165....mp4
      const thumbName = Date.now() + '.jpg';
      const thumbPath = path.join('uploads/thumbnails', thumbName);

      // Capture 1s pour le thumbnail
      await new Promise((resolve, reject) => {
        ffmpeg(videopath)
          .screenshots({
            timestamps: ['00:00:01.000', '00:00:02.000'],
            filename: thumbName,
            folder: 'uploads/thumbnails',
            size: '640x?'
          })
          .on('end', resolve)
          .on('error', reject);
      });

      // Retourne les URLs publiques
      const base = `${req.protocol}://${req.get('host')}:${process.env.PORT || 5000}`;
      const videoUrl = `${base}/uploads/videos/${path.basename(videopath)}`;
      const thumbUrl = `${base}/uploads/thumbnails/${thumbName}`;

      return res.status(201).json({ videoUrl, thumbUrl });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Erreur upload/generation thumbnail' });
    }
  }
];
