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

const { upload, toUploadResults } = require('../middlewares/uploadMiddleware');

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
router.get('/client/:id', protect, authorize('admin', 'superadmin'), adminController.getClientDetails);
router.post('/client/:id/recharge', protect, authorize('admin', 'superadmin'), adminController.adminRechargeClient);
router.post('/client/:id/subscription', protect, authorize('admin', 'superadmin'), adminController.adminActivateSubscription);
router.put('/client/:id/block', protect, authorize('admin', 'superadmin'), adminController.toggleBlockClient);
/* ===== Routes SuperAdmin Uniquement ===== */
// CORRECTION : Remplacement de 'authMiddleware' par 'protect'
router.get('/admins', protect, isSuperAdminMiddleware, adminController.getAllAdmins);
router.post('/admins', protect, isSuperAdminMiddleware, adminController.createAdmin);
router.delete('/admins/:id', protect, isSuperAdminMiddleware, adminController.deleteAdmin);
// --- Routes pour la gestion des Communes et Villes (SuperAdmin) ---
router.post('/villes', protect, isSuperAdminMiddleware, adminController.createVille);
router.get('/villes', protect, isSuperAdminMiddleware, adminController.getAllVilles);
router.post('/communes', protect, isSuperAdminMiddleware, adminController.createCommune);
router.get('/communes', protect, isSuperAdminMiddleware, adminController.getAllCommunes); // Pour lister les communes créées
// RECHARGEMENT COMPTE ADMIN
router.post('/recharge', protect, isSuperAdminMiddleware, adminController.rechargeAdminAccount);
// AJOUTER CETTE LIGNE :
router.post('/recharge/verify', protect, isSuperAdminMiddleware, adminController.verifyAdminRecharge);
router.get('/recharge-history', protect, isSuperAdminMiddleware, adminController.getAdminRechargeHistory);
/* ===== ROUTES INFO ACCUEIL (landing) ===== */
// GET public (pas besoin de middleware)
router.get('/info-accueil', adminLandingController.getInfoAccueil);

// POST info accueil (superadmin + upload)
router.post(
  '/info-accueil',
  protect,
  isSuperAdminMiddleware,
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'video', maxCount: 1 },
    { name: 'advertisers_image', maxCount: 1 },
    { name: 'users_image', maxCount: 1 },
    { name: 'tutorial_1', maxCount: 1 },
    { name: 'tutorial_2', maxCount: 1 },
    { name: 'tutorial_3', maxCount: 1 }
  ]),
  toUploadResults,
  adminLandingController.createOrUpdateInfoAccueil
);
// --- GESTION UTILISATEURS (MOBILES) ---
router.get('/users', protect, authorize('admin', 'superadmin'), adminController.getAllUsers);
router.get('/users/:id', protect, authorize('admin', 'superadmin'), adminController.getUserDetailsAdmin);
router.put('/users/:id', protect, authorize('admin', 'superadmin'), adminController.updateUserByAdmin);
router.put('/users/:id/block', protect, authorize('admin', 'superadmin'), adminController.toggleBlockUser);
module.exports = router;