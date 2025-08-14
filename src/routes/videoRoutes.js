// src/routes/videoRoutes.js
const express = require('express');
const router = express.Router();
const videoCtrl = require('../controllers/videoUploadController');

router.post('/upload', videoCtrl.uploadSingle);

module.exports = router;
