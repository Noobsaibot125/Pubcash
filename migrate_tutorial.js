const pool = require('./src/config/db');

async function migrate() {
    try {
        console.log('🚀 Démarrage de la migration pour le tutoriel mobile...');

        // Ajout des colonnes pour les images du tutoriel
        const columns = [
            'tutorial_image_1',
            'tutorial_image_2',
            'tutorial_image_3'
        ];

        for (const col of columns) {
            try {
                await pool.execute(`ALTER TABLE info_accueil ADD COLUMN ${col} VARCHAR(255) DEFAULT NULL`);
                console.log(`✅ Colonne ${col} ajoutée.`);
            } catch (e) {
                if (e.code === 'ER_DUP_COLUMN_NAME') {
                    console.log(`ℹ️ Colonne ${col} existe déjà.`);
                } else {
                    throw e;
                }
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Erreur lors de la migration:', err);
        process.exit(1);
    }
}

migrate();
