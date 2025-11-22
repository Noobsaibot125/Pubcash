const pool = require('../src/config/db');

async function updateSchema() {
    try {
        console.log('Starting schema update...');

        const columnsToAdd = [
            "ADD COLUMN ecosystem_title VARCHAR(255) DEFAULT 'L\\'Écosystème PubCash'",
            "ADD COLUMN ecosystem_description TEXT",
            "ADD COLUMN advertisers_title VARCHAR(255) DEFAULT 'Pour les Annonceurs'",
            "ADD COLUMN advertisers_description TEXT",
            "ADD COLUMN advertisers_features JSON",
            "ADD COLUMN advertisers_image_path VARCHAR(255)",
            "ADD COLUMN users_title VARCHAR(255) DEFAULT 'Pour les Utilisateurs'",
            "ADD COLUMN users_description TEXT",
            "ADD COLUMN users_features JSON",
            "ADD COLUMN users_image_path VARCHAR(255)",
            "ADD COLUMN testimonial_text TEXT",
            "ADD COLUMN testimonial_author VARCHAR(255)"
        ];

        // Check if columns exist before adding (naive check, but safe with ADD COLUMN IF NOT EXISTS in newer MySQL, 
        // but standard MySQL doesn't support IF NOT EXISTS for columns easily in one go without a procedure.
        // Instead, we'll wrap each in a try-catch block or just run it and ignore "Duplicate column" errors.)

        for (const columnDef of columnsToAdd) {
            try {
                await pool.query(`ALTER TABLE info_accueil ${columnDef}`);
                console.log(`Executed: ALTER TABLE info_accueil ${columnDef}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`Column already exists (skipped): ${columnDef}`);
                } else {
                    console.error(`Error executing ${columnDef}:`, err.message);
                }
            }
        }

        console.log('Schema update completed.');
        process.exit(0);
    } catch (error) {
        console.error('Fatal error during schema update:', error);
        process.exit(1);
    }
}

updateSchema();
