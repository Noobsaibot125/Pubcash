const pool = require('../config/db');

/**
 * Middleware de Maintenance
 * Vérifie dans la BDD si le mode maintenance global est activé.
 */
const maintenanceMiddleware = async (req, res, next) => {
    try {
        // Liste blanche des prefixes de routes qui doivent toujours fonctionner
        const allowedPrefixes = [
            '/api/settings',
            '/api/auth/login-admin',
            '/api/auth/admin/login',
            '/api/admin',
            '/api/check-geo',
            '/api/auth/refresh-token'
        ];

        // Si la route commence par un des préfixes autorisés, on laisse passer
        if (allowedPrefixes.some(prefix => req.path.startsWith(prefix))) {
            return next();
        }

        // Récupérer le setting de maintenance globale
        const [rows] = await pool.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = "maintenance_mode"'
        );

        let isMaintenance = false;
        if (rows.length > 0) {
            const val = rows[0].setting_value;
            isMaintenance = val === true || val === 'true' || val === '1' || val === 1;
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
        // Fail open pour ne pas bloquer si erreur DB
        next();
    }
};

module.exports = maintenanceMiddleware;
