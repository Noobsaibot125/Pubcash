const pool = require('../config/db');

class ClientModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS clients (
            id int NOT NULL AUTO_INCREMENT,
            nom varchar(255) DEFAULT NULL,
            prenom varchar(255) DEFAULT NULL,
            nom_utilisateur varchar(255) DEFAULT NULL,
            email varchar(255) NOT NULL,
            telephone varchar(20) DEFAULT NULL,
            mot_de_passe varchar(255) NOT NULL,
            commune enum('plateau','yopougon','cocody','abobo','koumassi','marcory','portbouet') NOT NULL,
            genre varchar(50) DEFAULT NULL,
            role varchar(50) DEFAULT 'client',
            solde_recharge decimal(10,2) DEFAULT '0.00',
            date_inscription timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            est_verifie tinyint(1) NOT NULL DEFAULT '0',
            otp_code varchar(10) DEFAULT NULL,
            otp_expiration datetime DEFAULT NULL,
            description text,
            profile_image_url varchar(512) DEFAULT NULL,
            background_image_url varchar(512) DEFAULT NULL,
            refresh_token varchar(512) DEFAULT NULL,
            created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            reset_code varchar(6) DEFAULT NULL,
            reset_code_expiration datetime DEFAULT NULL,
            type_compte enum('particulier','entreprise') DEFAULT 'particulier',
            nom_entreprise varchar(255) DEFAULT NULL,
            rccm varchar(255) DEFAULT NULL,
            deletion_requested_at datetime DEFAULT NULL,
            est_bloque tinyint(1) DEFAULT '0',
            PRIMARY KEY (id),
            UNIQUE KEY email (email),
            UNIQUE KEY nom_utilisateur (nom_utilisateur)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COMMENT='Table for clients/promoteurs';
    `);
        console.log('✅ Table clients checked/created.');
    }
}

module.exports = ClientModel;
