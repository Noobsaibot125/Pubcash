// routes/publicRoutes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Routes publiques pour lire villes/communes (lecture seule)
router.get('/villes', adminController.getAllVilles);
router.get('/villes/:id/communes', adminController.getCommunesByVille);
router.get('/communes', adminController.getAllCommunes); // facultatif - si tu veux tout charger

module.exports = router;
