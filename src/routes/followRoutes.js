// src/routes/followRoutes.js
const express = require('express');
const router = express.Router();
const followController = require('../controllers/followController');
const { protect } = require('../middlewares/authMiddleware');

// Toutes les routes nécessitent une authentification
router.use(protect);

// --- Routes pour les utilisateurs (mobile) ---

// POST /api/follows/:clientId - Suivre un promoteur
router.post('/:clientId', followController.followPromoter);

// DELETE /api/follows/:clientId - Ne plus suivre
router.delete('/:clientId', followController.unfollowPromoter);

// GET /api/follows/:clientId/status - Vérifier si on suit
router.get('/:clientId/status', followController.isFollowing);

// GET /api/follows/following - Liste des promoteurs suivis
router.get('/me/following', followController.getFollowing);

// --- Routes pour les promoteurs (web) ---

// GET /api/follows/followers - Liste des followers du promoteur connecté
router.get('/me/followers', followController.getFollowers);

// GET /api/follows/:clientId/count - Nombre de followers d'un promoteur
router.get('/:clientId/count', followController.getFollowersCount);

module.exports = router;
