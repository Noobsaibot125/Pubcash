const pool = require('../config/db');

class ContentModel {
    static async createTables() {
        // 1. INFO ACCUEIL
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS info_accueil (
          id int NOT NULL AUTO_INCREMENT,
          logo_path varchar(255) DEFAULT NULL,
          hero_image_path varchar(255) DEFAULT NULL,
          hero_video_path varchar(255) DEFAULT NULL,
          video_thumb varchar(255) DEFAULT NULL,
          title varchar(255) DEFAULT NULL,
          subtitle text,
          updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          ecosystem_title varchar(255) DEFAULT 'L''Écosystème PubCash',
          ecosystem_description text,
          advertisers_title varchar(255) DEFAULT 'Pour les Annonceurs',
          advertisers_description text,
          advertisers_features json DEFAULT NULL,
          advertisers_image_path varchar(255) DEFAULT NULL,
          users_title varchar(255) DEFAULT 'Pour les Utilisateurs',
          users_description text,
          users_features json DEFAULT NULL,
          users_image_path varchar(255) DEFAULT NULL,
          testimonial_text text,
          testimonial_author varchar(255) DEFAULT NULL,
          tutorial_image_1 varchar(255) DEFAULT NULL,
          tutorial_image_2 varchar(255) DEFAULT NULL,
          tutorial_image_3 varchar(255) DEFAULT NULL,
          PRIMARY KEY (id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 2. COMMENTAIRES
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS commentaires (
          id int NOT NULL AUTO_INCREMENT,
          id_utilisateur int NOT NULL,
          id_promotion int NOT NULL,
          commentaire text NOT NULL,
          date_commentaire timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY unique_user_promo (id_utilisateur,id_promotion),
          KEY id_promotion (id_promotion)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 3. FEEDBACK
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS feedback (
          id int NOT NULL AUTO_INCREMENT,
          user_id int DEFAULT NULL,
          user_type varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          full_name varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          email varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          phone varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          message text COLLATE utf8mb4_unicode_ci,
          status varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'active',
          created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

        // 4. FEEDBACK MESSAGES
        await pool.execute(`
         CREATE TABLE IF NOT EXISTS feedback_messages (
          id int NOT NULL AUTO_INCREMENT,
          feedback_id int NOT NULL,
          sender_type enum('user','admin','client') COLLATE utf8mb4_unicode_ci NOT NULL,
          sender_id int NOT NULL,
          message text COLLATE utf8mb4_unicode_ci NOT NULL,
          read_at timestamp NULL DEFAULT NULL,
          created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          file_url varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          file_name varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          file_type varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          PRIMARY KEY (id),
          KEY feedback_id (feedback_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

        console.log('✅ Content and Feedback tables checked/created.');
    }
}

module.exports = ContentModel;
