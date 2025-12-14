const pool = require('../config/db');

/**
 * Récupère le statut de la maintenance
 * @route GET /api/settings/maintenance
 */
exports.getMaintenanceStatus = async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT setting_value FROM system_settings WHERE setting_key = "maintenance_mode"');
        if (rows.length > 0) {
            return res.json({ maintenance: rows[0].setting_value === 'true' });
        }
        res.json({ maintenance: false });
    } catch (error) {
        console.error('Erreur getMaintenanceStatus:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

/**
 * Met à jour le statut de la maintenance (SuperAdmin seulement)
 * @route PUT /api/settings/maintenance
 */
exports.toggleMaintenanceMode = async (req, res) => {
    try {
        const { enabled } = req.body;
        // enabled doit être un boolean ou string 'true'/'false'
        const value = String(enabled);

        await pool.execute(
            'UPDATE system_settings SET setting_value = ? WHERE setting_key = "maintenance_mode"',
            [value]
        );

        res.json({ message: `Mode maintenance ${value === 'true' ? 'activé' : 'désactivé'}.`, maintenance: value === 'true' });
    } catch (error) {
        console.error('Erreur toggleMaintenanceMode:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};
