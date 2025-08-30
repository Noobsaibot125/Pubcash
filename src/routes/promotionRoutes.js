const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');

// CORRECTION : On importe 'protect' depuis le middleware avec la déstructuration
const { protect } = require('../middlewares/authMiddleware');

// --- ROUTES GÉNÉRALES ---
// On remplace partout 'authMiddleware' par 'protect'

// GET /api/promotions -> Récupère les promotions pour l'utilisateur connecté
router.get('/', protect, promotionController.getPromotionsForUser);

// GET /api/promotions/historique -> Récupère l'historique des interactions de l'utilisateur
router.get('/historique', protect, promotionController.getPromotionsHistorique);

// --- ROUTES SPÉCIFIQUES À L'UTILISATEUR ---

// GET /api/promotions/utilisateur/gains
router.get('/utilisateur/gains', protect, promotionController.getUserEarnings);

// POST /api/promotions/utilisateur/retrait
router.post('/utilisateur/retrait', protect, promotionController.withdrawEarnings);

// GET /api/promotions/utilisateur/historique-retraits
router.get('/utilisateur/historique-retraits', protect, promotionController.getWithdrawalHistoryForUser);

// --- ROUTES SPÉCIFIQUES À UNE PROMOTION (avec :promotionId) ---

// POST /api/promotions/:promotionId/like
router.post('/:promotionId/like', protect, promotionController.likePromotion);

// POST /api/promotions/:promotionId/partage
router.post('/:promotionId/partage', protect, promotionController.sharePromotion);

// POST /api/promotions/:promotionId/comment
router.post('/:promotionId/comment', protect, promotionController.addComment);

// POST /api/promotions/:promotionId/view
router.post('/:promotionId/view', protect, promotionController.viewPromotion);

module.exports = router;