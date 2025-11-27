const express = require('express');
const router = express.Router();
const promotionRoutes = require('./promotionRoutes');
const videoRoutes = require('./videoRoutes');
const authRoutes = require('./authRoutes');
const adminRoutes = require('./adminRoutes');
const clientRoutes = require('./clientRoutes');
const userRoutes = require('./userRoutes');
const gameRoutes = require('./gameRoutes');

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/client', clientRoutes);
router.use('/videos', videoRoutes);
router.use('/promotions', promotionRoutes);
router.use('/user', userRoutes);
router.use('/games', gameRoutes);

module.exports = router;