// pubcash-api/src/routes/clientRoutes.js
const express = require('express');
const router = express.Router();
const imageUploadController = require('../controllers/imageUploadController');
const clientController = require('../controllers/clientController');
const authMiddleware = require('../middlewares/authMiddleware');

// On commente les deux routes pour le test
 router.get('/profile', authMiddleware, clientController.getProfile);
 router.put('/profile', authMiddleware, clientController.updateProfile);
 router.post('/recharge', authMiddleware, clientController.rechargeAccount);
// Route pour créer une promotion
router.post('/promotions', authMiddleware, clientController.createPromotion);
router.get('/promotions', authMiddleware, clientController.getClientPromotions);
router.get('/global-stats', authMiddleware, clientController.getGlobalStats);
router.post('/upload-profile-image', authMiddleware, imageUploadController.uploadProfileImage);
router.post('/upload-background-image', authMiddleware, imageUploadController.uploadBackgroundImage);
router.get('/promotions/history', authMiddleware, clientController.getPromotionHistory);
module.exports = router;