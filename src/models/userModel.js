const pool = require('../config/db');

class UserModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS utilisateurs (
            id int NOT NULL AUTO_INCREMENT,
            nom_utilisateur varchar(255) NOT NULL,
            email varchar(255) DEFAULT NULL,
            mot_de_passe varchar(255) DEFAULT NULL,
            commune_choisie varchar(100) DEFAULT NULL,
            solde decimal(10,2) NOT NULL DEFAULT '0.00',
            est_actif tinyint(1) DEFAULT '1',
            id_facebook varchar(255) DEFAULT NULL,
            id_tiktok varchar(255) DEFAULT NULL,
            date_inscription timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            date_naissance date DEFAULT NULL,
            contact varchar(255) DEFAULT NULL,
            genre varchar(50) DEFAULT NULL,
            remuneration_utilisateur decimal(10,2) NOT NULL DEFAULT '0.00',
            photo_profil varchar(500) DEFAULT NULL,
            image_background varchar(255) DEFAULT NULL,
            refresh_token varchar(512) DEFAULT NULL,
            push_notification varchar(255) DEFAULT NULL,
            nom varchar(255) DEFAULT NULL,
            prenom varchar(255) DEFAULT NULL,
            est_en_ligne tinyint(1) NOT NULL DEFAULT '0',
            derniere_connexion datetime DEFAULT NULL,
            created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            ville varchar(100) DEFAULT NULL,
            id_google varchar(255) DEFAULT NULL,
            id_apple varchar(255) DEFAULT NULL,
            reset_code varchar(6) DEFAULT NULL,
            reset_code_expiration datetime DEFAULT NULL,
            points int DEFAULT '0',
            code_parrainage varchar(255) DEFAULT NULL,
            parrain_id int DEFAULT NULL,
            fcm_token varchar(255) DEFAULT NULL,
            deletion_requested_at datetime DEFAULT NULL,
            est_bloque tinyint(1) DEFAULT '0',
            PRIMARY KEY (id),
            UNIQUE KEY nom_utilisateur (nom_utilisateur),
            UNIQUE KEY email (email),
            UNIQUE KEY idx_id_google (id_google),
            UNIQUE KEY idx_id_apple (id_apple),
            UNIQUE KEY code_parrainage (code_parrainage),
            KEY parrain_id (parrain_id),
            CONSTRAINT utilisateurs_ibfk_1 FOREIGN KEY (parrain_id) REFERENCES utilisateurs (id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
    `);
        console.log('✅ Table utilisateurs checked/created.');
    }
}

module.exports = UserModel;
