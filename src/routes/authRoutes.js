// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Route pour l'inscription d'un Promoteur (Client)
router.post('/client/register', authController.registerClient);

// --- MODIFICATION ICI ---
// L'ancienne route router.post('/login', authController.login); est SUPPRIMÉE.
// Nouvelles routes de connexion séparées
router.post('/admin/login', authController.loginAdmin);
router.post('/client/login', authController.loginClient);
router.post('/utilisateur/login', authController.loginUtilisateur);
// --- FIN MODIFICATION ---

router.post('/admin/register', authController.registerAdmin);
router.post('/verify-otp', authController.verifyOtp);
router.post('/utilisateur/register', authController.registerUtilisateur);
router.post('/facebook', authController.facebookAuth);
router.post('/google', authController.googleAuth);
router.patch('/utilisateur/complete-profile', authController.completeFacebookProfile);
router.post('/refresh-token', authController.refreshToken); 
router.post('/logout', authController.logout); 
module.exports = router;