const pool = require('../config/db');

class AdminModel {
  static async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM administrateurs WHERE email = ?', [email]);
    return rows[0];
  }

  static async createTable() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS administrateurs (
            id int NOT NULL AUTO_INCREMENT,
            nom_utilisateur varchar(255) NOT NULL,
            email varchar(255) NOT NULL,
            mot_de_passe varchar(255) NOT NULL,
            role varchar(50) DEFAULT 'superadmin',
            photo varchar(255) DEFAULT NULL,
            date_creation timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            refresh_token varchar(512) DEFAULT NULL,
            reset_code varchar(6) DEFAULT NULL,
            reset_code_expiration datetime DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY email (email)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);
    console.log('✅ Table administrateurs checked/created.');
  }

  // ... futures fonctions :
  // static async getPlatformStats() { ... }
  // static async getAllUsers() { ... }
}

module.exports = AdminModel;