// src/middlewares/uploadMiddleware.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsRoot = path.join(__dirname, '../../uploads');
const landingDir = path.join(uploadsRoot, 'landing');

// create dirs if missing
if (!fs.existsSync(landingDir)) fs.mkdirSync(landingDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, landingDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});

const upload = multer({ storage });

const toUploadResults = (req, res, next) => {
  if (!req.files) return next();
  const buildPath = (file) => file ? `/uploads/landing/${file.filename}` : null;
  req.uploadResults = {
    logoPath: req.files.logo?.[0] ? buildPath(req.files.logo[0]) : null,
    imagePath: req.files.image?.[0] ? buildPath(req.files.image[0]) : null,
    videoPath: req.files.video?.[0] ? buildPath(req.files.video[0]) : null,
  };
  next();
};

module.exports = { upload, toUploadResults };
