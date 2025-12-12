const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { protect, admin } = require('../middlewares/authMiddleware');

// Toutes les routes nécessitent une authentification
router.use(protect);

// --- ROUTES ADMIN ---
// GET /api/feedback/admin/all - Tous les feedbacks (Admin seulement)
router.get('/admin/all', admin, feedbackController.getAllFeedbacks);

// POST /api/feedback/admin/:feedbackId/reply - Réponse Admin (avec fichier optionnel)
router.post('/admin/:feedbackId/reply', admin, feedbackController.uploadMiddleware, feedbackController.adminReplyToFeedback);
// --------------------

// POST /api/feedback - Créer un nouveau feedback (avec fichier optionnel)
router.post('/', feedbackController.uploadMiddleware, feedbackController.createFeedback);

// GET /api/feedback - Liste de mes feedbacks (Utilisateur standard)
router.get('/', feedbackController.getMyFeedbacks);

// GET /api/feedback/:feedbackId/messages - Messages d'un feedback (Commun)
router.get('/:feedbackId/messages', feedbackController.getFeedbackMessages);

// POST /api/feedback/:feedbackId/reply - Répondre avec fichier optionnel (Utilisateur standard)
router.post('/:feedbackId/reply', feedbackController.uploadMiddleware, feedbackController.replyToFeedback);

module.exports = router;
