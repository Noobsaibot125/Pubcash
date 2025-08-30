const express = require('express');
const router = express.Router();

// --- Contrôleurs ---
const adminController = require('../controllers/adminController');
const adminLandingController = require('../controllers/adminLandingController');

// --- Middlewares ---
// CORRECTION : Un seul import propre pour l'authentification et l'autorisation
const { protect, authorize } = require('../middlewares/authMiddleware');
// On garde votre middleware spécifique pour les super-admins
const isSuperAdminMiddleware = require('../middlewares/isSuperAdminMiddleware');


/* ===== Routes Admin et SuperAdmin ===== */

// CORRECTION : Remplacement de 'authMiddleware' par 'protect'
router.get('/clients', protect, authorize('admin', 'superadmin'), adminController.getClients);
router.get('/wallet', protect, authorize('admin', 'superadmin'), adminController.getAdminWallet);
router.get('/profile', protect, authorize('admin', 'superadmin'), adminController.getProfile);
router.put('/profile', protect, authorize('admin', 'superadmin'), adminController.updateProfile);
router.get('/dashboard-data', protect, authorize('admin', 'superadmin'), adminController.getDashboardData);
router.delete('/client/:clientId', protect, authorize('admin', 'superadmin'), adminController.deleteClient);

router.get('/withdrawal-requests', protect, authorize('admin', 'superadmin'), adminController.getWithdrawalRequests);
router.put('/withdrawal-requests/:requestId', protect, authorize('admin', 'superadmin'), adminController.processWithdrawalRequest);

// Nouvelle route pour les utilisateurs en ligne (déjà correcte mais confirmée)
router.get('/online-users', protect, authorize('admin', 'superadmin'), adminController.getOnlineUsers);

/* ===== Routes SuperAdmin Uniquement ===== */
// CORRECTION : Remplacement de 'authMiddleware' par 'protect'
router.get('/admins', protect, isSuperAdminMiddleware, adminController.getAllAdmins);
router.post('/admins', protect, isSuperAdminMiddleware, adminController.createAdmin);
router.delete('/admins/:id', protect, isSuperAdminMiddleware, adminController.deleteAdmin);


/* ===== ROUTES INFO ACCUEIL (landing) ===== */
// GET public (pas besoin de middleware)
router.get('/info-accueil', adminLandingController.getInfoAccueil);

// POST pour créer / mettre à jour (protégé et pour superadmin)
router.post(
    '/info-accueil',
    protect, // CORRECTION : Remplacement de 'authMiddleware'
    isSuperAdminMiddleware,
    adminLandingController.createOrUpdateInfoAccueil
);

module.exports = router;