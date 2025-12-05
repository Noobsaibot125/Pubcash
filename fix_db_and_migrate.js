const fs = require('fs');
const path = require('path');
const pool = require('./src/config/db');

async function fixAndMigrate() {
    const connection = await pool.getConnection();
    try {
        console.log("Converting 'clients' table to InnoDB...");
        await connection.query("ALTER TABLE clients ENGINE=InnoDB");
        console.log("'clients' table converted successfully.");

        const sqlPath = path.join(__dirname, 'migrations', 'create_messaging_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);

        console.log(`Found ${statements.length} statements to execute.`);

        await connection.beginTransaction();

        for (const statement of statements) {
            if (statement.trim()) {
                console.log('Executing statement...');
                await connection.query(statement);
            }
        }

        await connection.commit();
        console.log('Migration executed successfully!');

    } catch (error) {
        await connection.rollback();
        console.error('Operation failed:', error);
    } finally {
        connection.release();
        process.exit();
    }
}

fixAndMigrate();
