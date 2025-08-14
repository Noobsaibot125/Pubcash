// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Route pour l'inscription d'un Promoteur (Client)
router.post('/client/register', authController.registerClient);

// Route pour la connexion (unifiée)
router.post('/login', authController.login);
router.post('/admin/register', authController.registerAdmin);
router.post('/verify-otp', authController.verifyOtp);
router.post('/utilisateur/register', authController.registerUtilisateur);
module.exports = router;