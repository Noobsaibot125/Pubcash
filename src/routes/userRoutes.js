const express = require('express');
const router = express.Router();

// Importer les contrôleurs
const userController = require('../controllers/userController');
const imageUploadController = require('../controllers/imageUploadController');

// Importer le middleware de protection
const { protect } = require('../middlewares/authMiddleware'); 

// --- ROUTES DE PROFIL (TEXTE) ---
router.get('/profile', protect, userController.getProfileForUser);
router.put('/profile', protect, userController.updateProfileForUser);

// --- ROUTES D'UPLOAD D'IMAGES ---
// IMPORTANT : si imageUploadController.uploadProfileImageForUser est un ARRAY de middlewares,
// il faut le déplier avec spread operator (...) pour fournir des fonctions séparées au routeur.

// Route pour l'image de profil (utilisateurs)
router.post(
  '/upload-profile-image',
  protect,
  ...imageUploadController.uploadProfileImageForUser
);

// Route pour l'image de fond (utilisateurs)
router.post(
  '/upload-background-image',
  protect,
  ...imageUploadController.uploadBackgroundImageForUser
);

module.exports = router;
