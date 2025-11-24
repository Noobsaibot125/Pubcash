const pool = require('./src/config/db');

const migrate = async () => {
    try {
        console.log('Starting migration...');

        // Add new columns
        try {
            await pool.execute("ALTER TABLE clients ADD COLUMN type_compte ENUM('particulier', 'entreprise') DEFAULT 'particulier'");
            console.log('Added type_compte column');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log('type_compte column already exists');
            else console.error('Error adding type_compte:', e.message);
        }

        try {
            await pool.execute("ALTER TABLE clients ADD COLUMN nom_entreprise VARCHAR(255) NULL");
            console.log('Added nom_entreprise column');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log('nom_entreprise column already exists');
            else console.error('Error adding nom_entreprise:', e.message);
        }

        try {
            await pool.execute("ALTER TABLE clients ADD COLUMN rccm VARCHAR(255) NULL");
            console.log('Added rccm column');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log('rccm column already exists');
            else console.error('Error adding rccm:', e.message);
        }

        // Modify existing columns to be nullable
        try {
            await pool.execute("ALTER TABLE clients MODIFY COLUMN nom VARCHAR(255) NULL");
            console.log('Modified nom to be NULLABLE');
        } catch (e) {
            console.error('Error modifying nom:', e.message);
        }

        try {
            await pool.execute("ALTER TABLE clients MODIFY COLUMN prenom VARCHAR(255) NULL");
            console.log('Modified prenom to be NULLABLE');
        } catch (e) {
            console.error('Error modifying prenom:', e.message);
        }

        try {
            await pool.execute("ALTER TABLE clients MODIFY COLUMN nom_utilisateur VARCHAR(255) NULL");
            console.log('Modified nom_utilisateur to be NULLABLE');
        } catch (e) {
            console.error('Error modifying nom_utilisateur:', e.message);
        }

        console.log('Migration completed.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
