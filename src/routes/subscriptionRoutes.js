// src/routes/subscriptionRoutes.js
const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { protect } = require('../middlewares/authMiddleware');

// Toutes les routes nécessitent une authentification
router.use(protect);

// GET /api/subscriptions/status - Statut d'abonnement du client
router.get('/status', subscriptionController.getSubscriptionStatus);

// GET /api/subscriptions/plans - Liste des plans disponibles
router.get('/plans', subscriptionController.getPlans);

// POST /api/subscriptions/subscribe - Souscrire à un plan
router.post('/subscribe', subscriptionController.subscribe);

// GET /api/subscriptions/unread-count - Nombre de messages non lus
router.get('/unread-count', subscriptionController.getUnreadMessagesCount);

module.exports = router;
