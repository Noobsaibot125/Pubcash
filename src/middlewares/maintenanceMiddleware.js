const pool = require('../config/db');

/**
 * Middleware de Maintenance
 * Vérifie dans la BDD si un mode maintenance est activé.
 * 
 * Logique:
 * - maintenance_mode (global) = bloque TOUT (Web + API)
 * - maintenance_api = bloque uniquement l'API (utilisateurs mobiles)
 * - maintenance_web = géré côté Frontend via GeoGuard (pas ici)
 * 
 * Ainsi, le mobile est impacté par: maintenance_mode OU maintenance_api
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

        // Récupérer les deux settings pertinents pour le backend
        const [rows] = await pool.execute(
            'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ("maintenance_mode", "maintenance_api")'
        );

        let isGlobalMaintenance = false;
        let isApiMaintenance = false;

        rows.forEach(row => {
            if (row.setting_key === 'maintenance_mode') {
                isGlobalMaintenance = row.setting_value === 'true';
            } else if (row.setting_key === 'maintenance_api') {
                isApiMaintenance = row.setting_value === 'true';
            }
        });

        // Bloquer si maintenance globale OU maintenance API
        if (isGlobalMaintenance || isApiMaintenance) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'Le service est actuellement en maintenance. Veuillez revenir plus tard.',
                maintenance: true,
                type: isGlobalMaintenance ? 'global' : 'api'
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
