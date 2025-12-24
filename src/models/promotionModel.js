const pool = require('../config/db');

class PromotionModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS promotions (
          id int NOT NULL AUTO_INCREMENT,
          id_client int NOT NULL,
          titre varchar(255) NOT NULL,
          description text,
          url_video varchar(512) DEFAULT NULL,
          duree_secondes int NOT NULL,
          id_pack int DEFAULT NULL,
          budget_initial decimal(10,2) NOT NULL,
          budget_restant decimal(10,2) NOT NULL,
          statut enum('en_cours','termine','en_attente_validation','rejete') DEFAULT 'en_cours',
          date_creation timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          commission_pubcash decimal(10,2) NOT NULL DEFAULT '0.00',
          vues int NOT NULL DEFAULT '0',
          likes int NOT NULL DEFAULT '0',
          partages int NOT NULL DEFAULT '0',
          thumbnail_url varchar(512) DEFAULT NULL,
          vues_potentielles int NOT NULL DEFAULT '0',
          date_fin datetime DEFAULT NULL,
          tranche_age varchar(20) NOT NULL DEFAULT 'tous',
          ciblage_commune varchar(20) NOT NULL DEFAULT 'toutes',
          PRIMARY KEY (id),
          KEY id_client (id_client),
          KEY id_pack (id_pack)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);
        console.log('✅ Table promotions checked/created.');
    }
}

module.exports = PromotionModel;
