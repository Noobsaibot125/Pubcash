const express = require('express');
const router = express.Router();
const promotionRoutes = require('./promotionRoutes');
const videoRoutes = require('./videoRoutes');
const authRoutes = require('./authRoutes');
const adminRoutes = require('./adminRoutes');
const clientRoutes = require('./clientRoutes');
const userRoutes = require('./userRoutes');
const gameRoutes = require('./gameRoutes');
const notificationRoutes = require('./notificationRoutes');
// === NOUVELLES ROUTES MESSAGERIE ===
const subscriptionRoutes = require('./subscriptionRoutes');
const followRoutes = require('./followRoutes');
const messageRoutes = require('./messageRoutes');
const feedbackRoutes = require('./feedbackRoutes');

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/client', clientRoutes);
router.use('/videos', videoRoutes);
router.use('/promotions', promotionRoutes);
router.use('/user', userRoutes);
router.use('/games', gameRoutes);
router.use('/notifications', notificationRoutes);
// === NOUVELLES ROUTES MESSAGERIE ===
router.use('/subscriptions', subscriptionRoutes);
router.use('/follows', followRoutes);
router.use('/messages', messageRoutes);
router.use('/feedback', feedbackRoutes);

module.exports = router;