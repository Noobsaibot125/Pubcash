// src/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

// Middleware de protection pour toutes les routes
router.use(protect);

// --- ROUTES ---
router.get('/', notificationController.getNotifications);
router.get('/non-lues/count', notificationController.getNombreNonLues);
router.patch('/:id/lire', notificationController.marquerCommeLue);
router.patch('/lire-toutes', notificationController.marquerToutesCommeLues);
router.delete('/:id', notificationController.supprimerNotification);
router.delete('/toutes', notificationController.supprimerToutesNotifications);
// C'est la route cruciale
router.post('/token', notificationController.sauvegarderToken);

// Route de test (Dev uniquement)
if (process.env.NODE_ENV !== 'production') {
    router.post('/test', notificationController.testNotification);
}

module.exports = router;