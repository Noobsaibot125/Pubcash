const pool = require('../config/db');

class ActivityModel {
    static async createTables() {
        // 1. DAILY ACTIVITY
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS daily_activity (
          id int NOT NULL AUTO_INCREMENT,
          user_id int NOT NULL,
          date date NOT NULL,
          login_streak int DEFAULT '0',
          videos_watched int DEFAULT '0',
          daily_wheel_spun tinyint(1) DEFAULT '0',
          PRIMARY KEY (id),
          UNIQUE KEY unique_user_date (user_id,date)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 2. GAME HISTORY
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS game_history (
          id int NOT NULL AUTO_INCREMENT,
          user_id int NOT NULL,
          game_id int DEFAULT NULL,
          points_gagnes int DEFAULT '0',
          resultat varchar(50) DEFAULT NULL,
          created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY user_id (user_id),
          KEY game_id (game_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 3. INTERACTIONS
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS interactions (
          id int NOT NULL AUTO_INCREMENT,
          id_utilisateur int NOT NULL,
          id_promotion int NOT NULL,
          type_interaction varchar(50) DEFAULT NULL,
          device_id varchar(255) DEFAULT NULL,
          date_interaction timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY unique_interaction (id_utilisateur,id_promotion,type_interaction),
          KEY id_promotion (id_promotion)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 4. SUIVIS PROMOTEURS
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS suivis_promoteurs (
          id int NOT NULL AUTO_INCREMENT,
          id_utilisateur int NOT NULL,
          id_client int NOT NULL,
          date_suivi timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY unique_follow (id_utilisateur,id_client),
          KEY idx_client_followers (id_client),
          KEY idx_user_following (id_utilisateur),
          CONSTRAINT suivis_promoteurs_ibfk_1 FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs (id) ON DELETE CASCADE,
          CONSTRAINT suivis_promoteurs_ibfk_2 FOREIGN KEY (id_client) REFERENCES clients (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

        // 5. USER GAINS
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS user_gains (
          id int NOT NULL AUTO_INCREMENT,
          id_utilisateur int NOT NULL,
          id_promotion int DEFAULT NULL,
          montant decimal(10,2) NOT NULL,
          type_gain enum('vue','like','partage','conversion_points') NOT NULL DEFAULT 'vue',
          date_gain datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          details varchar(255) DEFAULT NULL,
          PRIMARY KEY (id),
          KEY id_utilisateur (id_utilisateur),
          KEY id_promotion (id_promotion)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        console.log('✅ Activity tables checked/created.');
    }
}

module.exports = ActivityModel;
