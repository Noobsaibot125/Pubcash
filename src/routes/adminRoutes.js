// pubcash-api/src/routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// --- CORRECTION DE L'IMPORTATION ---
// On importe directement la fonction 'authMiddleware'
const authMiddleware = require('../middlewares/authMiddleware');

// Route pour obtenir la liste de tous les clients
// On utilise 'authMiddleware' comme gardien
router.get('/clients', authMiddleware, adminController.getClients);
router.get('/wallet', authMiddleware, adminController.getAdminWallet);
router.get('/profile', authMiddleware, adminController.getProfile);
router.put('/profile', authMiddleware, adminController.updateProfile);
router.get('/dashboard-data', authMiddleware, adminController.getDashboardData);
router.delete('/client/:clientId', authMiddleware, adminController.deleteClient);
// On supprime la route '/login' qui n'a plus sa place ici
// router.post('/login', adminController.login); // <-- LIGNE SUPPRIMÉE

// Ici, vous ajouterez les futures routes de l'admin, comme la création d'un autre admin
// router.post('/create-admin', authMiddleware, adminController.createAdmin);

module.exports = router;