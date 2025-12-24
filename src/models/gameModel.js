const pool = require('../config/db');

class GameModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS games (
          id int NOT NULL AUTO_INCREMENT,
          type enum('puzzle','quiz') NOT NULL,
          titre varchar(255) DEFAULT NULL,
          image_url varchar(255) DEFAULT NULL,
          question text,
          reponses json DEFAULT NULL,
          bonne_reponse varchar(255) DEFAULT NULL,
          duree_limite int DEFAULT NULL,
          points_recompense int DEFAULT '0',
          ciblage_commune varchar(255) DEFAULT 'toutes',
          statut enum('actif','inactif') DEFAULT 'actif',
          created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          promotion_id int DEFAULT NULL,
          PRIMARY KEY (id),
          KEY fk_games_promotion (promotion_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);
        console.log('✅ Table games checked/created.');
    }
}

module.exports = GameModel;
