const pool = require('../config/db');

/**
 * Middleware de Maintenance
 * Vérifie dans la BDD si le mode maintenance est activé.
 * Si oui, bloque tout SAUF :
 * 1. Les routes d'admin (/api/admin, /api/auth/login-admin)
 * 2. Les webhooks (déjà gérés avant dans server.js normalement)
 * 3. La route pour désactiver la maintenance
 */
const maintenanceMiddleware = async (req, res, next) => {
    try {
        // Liste blanche des prefixes de routes qui doivent toujours fonctionner
        // - /api/settings : Pour que l'admin puisse changer le setting
        // - /api/auth/login-admin : Pour que l'admin puisse se connecter
        // - /api/admin : Pour le dashboard admin
        const allowedPrefixes = [
            '/api/settings',
            '/api/auth/login-admin',
            '/api/auth/admin/login',
            '/api/admin',
            '/api/check-geo', // Debug
            '/api/auth/refresh-token' // Auth logic
        ];

        // Si la route commence par un des préfixes autorisés, on laisse passer
        if (allowedPrefixes.some(prefix => req.path.startsWith(prefix))) {
            return next();
        }

        // Vérification en base de données (Note: Pour optimiser, on pourrait utiliser un cache Redis ou variable globale ms à jour)
        // Mais ici une requête SQL simple est acceptable pour ce besoin.
        const [rows] = await pool.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = "maintenance_mode"'
        );

        let isMaintenance = false;
        if (rows.length > 0) {
            isMaintenance = rows[0].setting_value === 'true';
        }

        if (isMaintenance) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'Le site est actuellement en maintenance. Veuillez revenir plus tard.',
                maintenance: true
            });
        }

        next();
    } catch (error) {
        console.error('Erreur maintenanceMiddleware:', error);
        // En cas d'erreur DB, on laisse passer (fail open) ou on bloque ? 
        // Fail open pour ne pas bloquer le site si la DB a un hoquet, mais avec log.
        next();
    }
};

module.exports = maintenanceMiddleware;
