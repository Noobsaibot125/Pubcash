require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        await connection.execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value VARCHAR(255) NOT NULL,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
        console.log("Table system_settings created.");

        // Insert default if not exists
        const [rows] = await connection.execute('SELECT * FROM system_settings WHERE setting_key = ?', ['maintenance_mode']);
        if (rows.length === 0) {
            await connection.execute(`
            INSERT INTO system_settings (setting_key, setting_value, description)
            VALUES ('maintenance_mode', 'false', 'Met le site en mode maintenance (true/false)')
        `);
            console.log("Default maintenance_mode setting inserted.");
        } else {
            console.log("maintenance_mode setting already exists.");
        }

    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

migrate();
