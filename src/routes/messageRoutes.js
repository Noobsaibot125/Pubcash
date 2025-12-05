// src/routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middlewares/authMiddleware');

// Toutes les routes nécessitent une authentification
router.use(protect);

// GET /api/messages/conversations - Liste des conversations
router.get('/conversations', messageController.getConversations);

// GET /api/messages/unread-count - Nombre total de messages non lus
router.get('/unread-count', messageController.getUnreadCount);

// GET /api/messages/:contactType/:contactId - Messages d'une conversation
router.get('/:contactType/:contactId', messageController.getMessages);

// POST /api/messages/send - Envoyer un message (avec upload possible)
router.post('/send', messageController.uploadMiddleware, messageController.sendMessage);

// PUT /api/messages/:contactType/:contactId/read - Marquer comme lu
router.put('/:contactType/:contactId/read', messageController.markAsRead);

module.exports = router;
