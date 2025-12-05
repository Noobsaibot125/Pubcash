const pool = require('./src/config/db');

async function checkTable() {
    try {
        const [rows] = await pool.execute("SHOW CREATE TABLE clients");
        console.log("Clients table definition:", rows[0]['Create Table']);

        const [users] = await pool.execute("SHOW CREATE TABLE utilisateurs");
        console.log("Utilisateurs table definition:", users[0]['Create Table']);

    } catch (error) {
        console.error('Error checking table:', error);
    } finally {
        process.exit();
    }
}

checkTable();
