const pool = require('../config/db');

class AdminModel {
  static async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM administrateurs WHERE email = ?', [email]);
    return rows[0];
  }

  // ... futures fonctions :
  // static async getPlatformStats() { ... }
  // static async getAllUsers() { ... }
}

module.exports = AdminModel;