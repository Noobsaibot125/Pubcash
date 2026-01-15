const pool = require('../config/db');

class SettingsModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS system_settings (
          setting_key varchar(50) NOT NULL,
          setting_value varchar(255) NOT NULL,
          description varchar(255) DEFAULT NULL,
          updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (setting_key)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);
        console.log('✅ Table system_settings checked/created.');
    }

    /**
     * Initialise les settings par défaut si ils n'existent pas
     */
    static async initializeDefaultSettings() {
        const defaultSettings = [
            { key: 'maintenance_mode', value: 'false', description: 'Mode maintenance global (bloque tout)' },
            { key: 'maintenance_web', value: 'false', description: 'Bloque uniquement le site Web' },
            { key: 'maintenance_api', value: 'false', description: 'Bloque uniquement l\'API mobile' }
        ];

        for (const setting of defaultSettings) {
            const [rows] = await pool.execute(
                'SELECT setting_key FROM system_settings WHERE setting_key = ?',
                [setting.key]
            );

            if (rows.length === 0) {
                await pool.execute(
                    'INSERT INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
                    [setting.key, setting.value, setting.description]
                );
                console.log(`✅ Setting '${setting.key}' créé.`);
            }
        }
    }

    /**
     * Récupère un setting par sa clé
     */
    static async getSetting(key) {
        const [rows] = await pool.execute(
            'SELECT setting_value FROM system_settings WHERE setting_key = ?',
            [key]
        );
        return rows.length > 0 ? rows[0].setting_value : null;
    }

    /**
     * Met à jour un setting
     */
    static async updateSetting(key, value) {
        await pool.execute(
            'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
            [value, key]
        );
    }

    /**
     * Récupère tous les settings de maintenance
     */
    static async getMaintenanceSettings() {
        const [rows] = await pool.execute(
            'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ("maintenance_mode", "maintenance_web", "maintenance_api")'
        );

        const result = {
            maintenance_mode: false,
            maintenance_web: false,
            maintenance_api: false
        };

        rows.forEach(row => {
            result[row.setting_key] = row.setting_value === 'true';
        });

        return result;
    }
}

module.exports = SettingsModel;
