/**
 * Script de migration pour ajouter les nouveaux modes de maintenance
 * Execute: node add_maintenance_settings.js
 */
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
        // Ajouter maintenance_web si n'existe pas
        const [webRows] = await connection.execute(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            ['maintenance_web']
        );
        if (webRows.length === 0) {
            await connection.execute(
                `INSERT INTO system_settings (setting_key, setting_value, description) 
                 VALUES ('maintenance_web', 'false', 'Bloque uniquement le site Web')`
            );
            console.log("✅ Setting 'maintenance_web' ajouté.");
        } else {
            console.log("ℹ️ Setting 'maintenance_web' existe déjà.");
        }

        // Ajouter maintenance_api si n'existe pas
        const [apiRows] = await connection.execute(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            ['maintenance_api']
        );
        if (apiRows.length === 0) {
            await connection.execute(
                `INSERT INTO system_settings (setting_key, setting_value, description) 
                 VALUES ('maintenance_api', 'false', 'Bloque uniquement l\\'API mobile')`
            );
            console.log("✅ Setting 'maintenance_api' ajouté.");
        } else {
            console.log("ℹ️ Setting 'maintenance_api' existe déjà.");
        }

        console.log("\n🎉 Migration terminée avec succès!");

    } catch (err) {
        console.error("❌ Erreur migration:", err);
    } finally {
        await connection.end();
    }
}

migrate();
