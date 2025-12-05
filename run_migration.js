const fs = require('fs');
const path = require('path');
const pool = require('./src/config/db');

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, 'migrations', 'create_messaging_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolon to get individual statements, filtering out empty ones
        const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);

        console.log(`Found ${statements.length} statements to execute.`);

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            for (const statement of statements) {
                if (statement.trim()) {
                    console.log('Executing statement...');
                    await connection.query(statement);
                }
            }

            await connection.commit();
            console.log('Migration executed successfully!');
        } catch (err) {
            await connection.rollback();
            console.error('Error executing statements:', err);
            throw err;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        process.exit();
    }
}

runMigration();
