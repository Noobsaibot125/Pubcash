const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

// --- CORRECTION ---
// 1. On garde UNIQUEMENT 'protect' (car c'est le nom dans ton export)
const { protect } = require('../middlewares/authMiddleware'); 

// 2. On utilise 'protect' ici pour sécuriser les routes
router.use(protect); 
// ------------------

// GET /api/notifications - Récupérer les notifications
router.get('/', notificationController.getNotifications);

// GET /api/notifications/non-lues/count - Nombre de notifications non lues
router.get('/non-lues/count', notificationController.getNombreNonLues);

// PATCH /api/notifications/:id/lire - Marquer une notification comme lue
router.patch('/:id/lire', notificationController.marquerCommeLue);

// PATCH /api/notifications/lire-toutes - Marquer toutes comme lues
router.patch('/lire-toutes', notificationController.marquerToutesCommeLues);

// DELETE /api/notifications/:id - Supprimer une notification
router.delete('/:id', notificationController.supprimerNotification);

// POST /api/notifications/token - Sauvegarder le token FCM
router.post('/token', notificationController.sauvegarderToken);

// POST /api/notifications/test - Envoyer une notification de test (DEV)
if (process.env.NODE_ENV !== 'production') {
    router.post('/test', notificationController.testNotification);
}

module.exports = router;