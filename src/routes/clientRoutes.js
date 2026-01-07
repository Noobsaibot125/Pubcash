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
router.get('/recharge/history', protect, clientController.getRechargeHistory);

// Promotions
router.post('/promotions', protect, clientController.createPromotion);
router.get('/promotions', protect, clientController.getClientPromotions);
router.get('/promotions/history', protect, clientController.getPromotionHistory);
router.get('/detailed-stats-interactions', protect, clientController.getDetailedStatsWithInteractions);
router.get('/detailed-stats', protect, clientController.getDetailedStatsWithInteractions);
router.get('/real-time-stats', protect, clientController.getRealTimeStats);
// Stats
router.get('/global-stats', protect, clientController.getGlobalStats);
router.get('/monthly-stats', protect, clientController.getMonthlyStats);
// Upload images
router.post('/upload-profile-image', protect, ...imageUploadController.uploadProfileImageForClient);
router.post('/upload-background-image', protect, ...imageUploadController.uploadBackgroundImageForClient);

module.exports = router;