const pool = require('./src/config/db');

async function migrate() {
    const connection = await pool.getConnection();
    try {
        console.log('Début de la migration...');

        // 1. Ajouter les colonnes à la table utilisateurs
        try {
            await connection.execute(`
        ALTER TABLE utilisateurs 
        ADD COLUMN points INT DEFAULT 0,
        ADD COLUMN code_parrainage VARCHAR(255) UNIQUE,
        ADD COLUMN parrain_id INT,
        ADD FOREIGN KEY (parrain_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
      `);
            console.log('Colonnes ajoutées à la table utilisateurs.');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('Colonnes déjà existantes dans utilisateurs.');
            } else {
                throw err;
            }
        }

        // 2. Créer la table daily_activity
        await connection.execute(`
      CREATE TABLE IF NOT EXISTS daily_activity (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        date DATE NOT NULL,
        login_streak INT DEFAULT 0,
        videos_watched INT DEFAULT 0,
        daily_wheel_spun BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_date (user_id, date)
      )
    `);
        console.log('Table daily_activity créée.');

        // 3. Créer la table games
        await connection.execute(`
      CREATE TABLE IF NOT EXISTS games (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('puzzle', 'quiz') NOT NULL,
        titre VARCHAR(255),
        image_url VARCHAR(255),
        question TEXT,
        reponses JSON,
        bonne_reponse VARCHAR(255),
        duree_limite INT,
        points_recompense INT DEFAULT 0,
        ciblage_commune VARCHAR(255) DEFAULT 'toutes',
        statut ENUM('actif', 'inactif') DEFAULT 'actif',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log('Table games créée.');

        // 4. Créer la table game_history
        await connection.execute(`
      CREATE TABLE IF NOT EXISTS game_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        game_id INT,
        points_gagnes INT DEFAULT 0,
        resultat ENUM('gagne', 'perdu') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
      )
    `);
        console.log('Table game_history créée.');

        console.log('Migration terminée avec succès.');
    } catch (error) {
        console.error('Erreur lors de la migration:', error);
    } finally {
        connection.release();
        process.exit();
    }
}

migrate();
