const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { protect, admin } = require('../middlewares/authMiddleware');

// Toutes les routes nécessitent une authentification
router.use(protect);

// --- ROUTES ADMIN ---
// GET /api/feedback/admin/all - Tous les feedbacks (Admin seulement)
// Note: On met 'admin/all' avant '/:feedbackId' pour éviter les conflits d'URL si possible, 
// ou on utilise un préfixe différent. Ici c'est safe car 'admin' != un ID numérique généralement.
router.get('/admin/all', admin, feedbackController.getAllFeedbacks);

// POST /api/feedback/admin/:feedbackId/reply - Réponse Admin
router.post('/admin/:feedbackId/reply', admin, feedbackController.adminReplyToFeedback);
// --------------------

// POST /api/feedback - Créer un nouveau feedback
router.post('/', feedbackController.createFeedback);

// GET /api/feedback - Liste de mes feedbacks (Utilisateur standard)
router.get('/', feedbackController.getMyFeedbacks);

// GET /api/feedback/:feedbackId/messages - Messages d'un feedback (Commun)
router.get('/:feedbackId/messages', feedbackController.getFeedbackMessages);

// POST /api/feedback/:feedbackId/reply - Répondre (Utilisateur standard)
router.post('/:feedbackId/reply', feedbackController.replyToFeedback);

module.exports = router;
