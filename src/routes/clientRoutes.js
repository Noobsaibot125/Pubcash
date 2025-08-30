const express = require('express');
const router = express.Router();
const imageUploadController = require('../controllers/imageUploadController');
const clientController = require('../controllers/clientController');

// CORRECTION : On importe 'protect' depuis le middleware avec la déstructuration
const { protect } = require('../middlewares/authMiddleware');

// On remplace partout 'authMiddleware' par 'protect'

// Profil
router.get('/profile', protect, clientController.getProfile);
router.put('/profile', protect, clientController.updateProfile);

// Recharge
router.post('/recharge', protect, clientController.rechargeAccount);
router.post('/recharge/verify', protect, clientController.verifyRecharge);

// Promotions
router.post('/promotions', protect, clientController.createPromotion);
router.get('/promotions', protect, clientController.getClientPromotions);
router.get('/promotions/history', protect, clientController.getPromotionHistory);

// Stats
router.get('/global-stats', protect, clientController.getGlobalStats);

// Upload images
router.post('/upload-profile-image', protect, ...imageUploadController.uploadProfileImageForClient);
router.post('/upload-background-image', protect, ...imageUploadController.uploadBackgroundImageForClient);

module.exports = router;