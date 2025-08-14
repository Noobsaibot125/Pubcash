// pubcash-api/src/routes/promotionRoutes.js
const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const authMiddleware = require('../middlewares/authMiddleware');

// Route pour que l'utilisateur voie les promotions de sa commune
router.get('/', authMiddleware, promotionController.getPromotionsForUser);

// Route pour liker une promotion
router.post('/:promotionId/like', authMiddleware, promotionController.likePromotion);
router.post('/:promotionId/partage', authMiddleware, promotionController.sharePromotion);
router.post('/:promotionId/comment', authMiddleware, promotionController.addComment);
router.post('/:promotionId/view', authMiddleware, promotionController.viewPromotion);
// Route pour récupérer l'historique (promos likées/partagées par l'utilisateur)
router.get('/historique', authMiddleware, promotionController.getPromotionsHistorique);
module.exports = router;