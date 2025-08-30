// pubcash-api/src/middlewares/isSuperAdminMiddleware.js

const isSuperAdmin = (req, res, next) => {
    // Ce middleware doit s'exécuter APRES authMiddleware,
    // donc req.user devrait exister.
    if (req.user && req.user.role === 'superadmin') {
        // L'utilisateur est un superadmin, on le laisse passer
        next();
    } else {
        // L'utilisateur n'est pas un superadmin, on bloque l'accès
        res.status(403).json({ message: 'Accès interdit. Seuls les super-administrateurs peuvent effectuer cette action.' });
    }
};

module.exports = isSuperAdmin;