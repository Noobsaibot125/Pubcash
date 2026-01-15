const pool = require('../config/db');

/**
 * Récupère le statut de tous les modes de maintenance
 * @route GET /api/settings/maintenance
 */
exports.getMaintenanceStatus = async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ("maintenance_mode", "maintenance_web", "maintenance_api")'
        );

        const result = {
            maintenance: false,      // Global (ancien, garde le nom pour compatibilité)
            maintenance_web: false,  // Web seulement
            maintenance_api: false   // API/Mobile seulement
        };

        rows.forEach(row => {
            if (row.setting_key === 'maintenance_mode') {
                result.maintenance = row.setting_value === 'true';
            } else if (row.setting_key === 'maintenance_web') {
                result.maintenance_web = row.setting_value === 'true';
            } else if (row.setting_key === 'maintenance_api') {
                result.maintenance_api = row.setting_value === 'true';
            }
        });

        res.json(result);
    } catch (error) {
        console.error('Erreur getMaintenanceStatus:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

/**
 * Met à jour le statut d'un mode de maintenance (SuperAdmin seulement)
 * @route PUT /api/settings/maintenance
 * @body { type: 'global' | 'web' | 'api', enabled: boolean }
 */
exports.toggleMaintenanceMode = async (req, res) => {
    try {
        const { enabled, type = 'global' } = req.body;
        const value = String(enabled);

        // Mapper le type au setting_key correspondant
        const typeToKey = {
            'global': 'maintenance_mode',
            'web': 'maintenance_web',
            'api': 'maintenance_api'
        };

        const settingKey = typeToKey[type];
        if (!settingKey) {
            return res.status(400).json({ error: 'Type de maintenance invalide. Utilisez: global, web, ou api.' });
        }

        // Vérifier si le setting existe, sinon le créer
        const [existing] = await pool.execute(
            'SELECT setting_key FROM system_settings WHERE setting_key = ?',
            [settingKey]
        );

        if (existing.length === 0) {
            await pool.execute(
                'INSERT INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
                [settingKey, value, `Mode maintenance ${type}`]
            );
        } else {
            await pool.execute(
                'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
                [value, settingKey]
            );
        }

        const labels = {
            'global': 'globale',
            'web': 'Web',
            'api': 'API/Mobile'
        };

        res.json({
            message: `Maintenance ${labels[type]} ${value === 'true' ? 'activée' : 'désactivée'}.`,
            [type === 'global' ? 'maintenance' : `maintenance_${type}`]: value === 'true'
        });
    } catch (error) {
        console.error('Erreur toggleMaintenanceMode:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};
