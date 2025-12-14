const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
// IMPORTANT: Protéger la route PUT avec l'auth admin si possible.
// Puisque l'utilisateur n'a pas fourni de middleware d'auth ici, je vais assumer qu'il faut authMiddleware + checkRole
// Mais pour simplifier et éviter les erreurs d'import circulaires ou manquants :
const { protect } = require('../middlewares/authMiddleware'); // Import destructuré correct
const isSuperAdminMiddleware = require('../middlewares/isSuperAdminMiddleware'); // A vérifier

// Route publique pour check
router.get('/maintenance', settingsController.getMaintenanceStatus);

// Route protégée pour update (SuperAdmin seulement)
router.put('/maintenance', protect, isSuperAdminMiddleware, settingsController.toggleMaintenanceMode);

module.exports = router;
