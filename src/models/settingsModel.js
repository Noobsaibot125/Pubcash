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
}

module.exports = SettingsModel;
