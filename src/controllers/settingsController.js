const pool = require('../config/db');

/**
 * Helper pour parser les valeurs booléennes de façon robuste
 */
const isTrue = (val) => {
    if (val === true || val === 1) return true;
    if (typeof val === 'string') {
        return val.toLowerCase() === 'true' || val === '1';
    }
    return false;
};

/**
 * Récupère le statut du mode de maintenance global
 * @route GET /api/settings/maintenance
 */
exports.getMaintenanceStatus = async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = "maintenance_mode"'
        );

        let maintenance = false;
        if (rows.length > 0) {
            maintenance = isTrue(rows[0].setting_value);
        }

        res.json({ maintenance });
    } catch (error) {
        console.error('Erreur getMaintenanceStatus:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

/**
 * Met à jour le statut du mode de maintenance (SuperAdmin seulement)
 * @route PUT /api/settings/maintenance
 * @body { enabled: boolean }
 */
exports.toggleMaintenanceMode = async (req, res) => {
    try {
        const { enabled } = req.body;
        const value = String(enabled);

        // Vérifier si le setting existe, sinon le créer
        const [existing] = await pool.execute(
            'SELECT setting_key FROM system_settings WHERE setting_key = "maintenance_mode"'
        );

        if (existing.length === 0) {
            await pool.execute(
                'INSERT INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
                ['maintenance_mode', value, 'Mode maintenance global']
            );
        } else {
            await pool.execute(
                'UPDATE system_settings SET setting_value = ? WHERE setting_key = "maintenance_mode"',
                [value]
            );
        }

        res.json({
            message: `Mode maintenance ${value === 'true' ? 'activé' : 'désactivé'}.`,
            maintenance: value === 'true'
        });
    } catch (error) {
        console.error('Erreur toggleMaintenanceMode:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};
