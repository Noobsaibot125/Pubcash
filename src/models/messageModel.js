const pool = require('../config/db');

class MessageModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id int NOT NULL AUTO_INCREMENT,
          id_expediteur int NOT NULL,
          type_expediteur enum('utilisateur','client') COLLATE utf8mb4_unicode_ci NOT NULL,
          id_destinataire int NOT NULL,
          type_destinataire enum('utilisateur','client') COLLATE utf8mb4_unicode_ci NOT NULL,
          contenu text COLLATE utf8mb4_unicode_ci,
          type_contenu enum('texte','image','video','fichier') COLLATE utf8mb4_unicode_ci DEFAULT 'texte',
          url_media varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          nom_fichier varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
          taille_fichier int DEFAULT NULL,
          lu tinyint(1) DEFAULT '0',
          date_envoi timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_conversation (id_expediteur,type_expediteur,id_destinataire,type_destinataire),
          KEY idx_destinataire_lu (id_destinataire,type_destinataire,lu),
          KEY idx_date (date_envoi DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        console.log('✅ Table messages checked/created.');
    }
}

module.exports = MessageModel;
