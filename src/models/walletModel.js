const pool = require('../config/db');

class WalletModel {
    static async createTables() {
        // 1. PORTEFEUILLE ADMIN
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS portefeuille_admin (
          id int NOT NULL AUTO_INCREMENT,
          solde decimal(15,2) NOT NULL DEFAULT '0.00',
          PRIMARY KEY (id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 2. ADMIN PORTEFEUILLE HISTORY
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS admin_portefeuille_history (
          id int NOT NULL AUTO_INCREMENT,
          id_promotion int DEFAULT NULL,
          montant decimal(12,2) NOT NULL,
          type_operation enum('credit','debit') NOT NULL,
          description varchar(255) DEFAULT NULL,
          date_operation datetime DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY id_promotion (id_promotion)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 3. CINETPAY TRANSACTIONS
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS cinetpay_transactions (
          id int NOT NULL AUTO_INCREMENT,
          transaction_id varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
          client_id int NOT NULL,
          amount decimal(15,2) NOT NULL,
          status varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
          cinetpay_response json DEFAULT NULL,
          created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY transaction_id (transaction_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

        // 4. DEMANDES RETRAIT
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS demandes_retrait (
          id int NOT NULL AUTO_INCREMENT,
          id_utilisateur int NOT NULL,
          montant decimal(10,2) NOT NULL,
          operateur_mobile varchar(50) DEFAULT NULL,
          date_demande timestamp NULL DEFAULT CURRENT_TIMESTAMP,
          statut enum('en_attente','traite','rejete','en_cours') DEFAULT 'en_attente',
          erreur_details text,
          date_traitement datetime DEFAULT NULL,
          id_admin int DEFAULT NULL,
          transaction_id varchar(255) DEFAULT NULL,
          numero_telephone varchar(20) DEFAULT NULL,
          PRIMARY KEY (id),
          KEY id_utilisateur (id_utilisateur)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 5. SOLDE RECHARGE
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS solde_recharge (
          id int NOT NULL AUTO_INCREMENT,
          transaction_id varchar(100) NOT NULL,
          admin_id int NOT NULL,
          montant decimal(10,2) NOT NULL,
          telephone_utilise varchar(20) DEFAULT NULL,
          statut enum('PENDING','ACCEPTED','FAILED') DEFAULT 'PENDING',
          date_recharge datetime DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY admin_id (admin_id)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // 6. TRANSFERTS DIRECTS
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS transferts_directs (
          id int NOT NULL AUTO_INCREMENT,
          id_utilisateur int NOT NULL,
          montant decimal(10,2) NOT NULL,
          operateur_mobile varchar(50) NOT NULL,
          numero_telephone varchar(50) NOT NULL,
          client_transaction_id varchar(100) NOT NULL,
          operator_transaction_id varchar(100) DEFAULT NULL,
          statut_cinetpay varchar(50) NOT NULL,
          message_cinetpay text,
          date_creation datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY client_transaction_id (client_transaction_id),
          KEY id_utilisateur (id_utilisateur),
          CONSTRAINT transferts_directs_ibfk_1 FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

        // 7. ABONNEMENTS PROMOTEURS (Moved here essentially)
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS abonnements_promoteurs (
            id int NOT NULL AUTO_INCREMENT,
            id_client int NOT NULL,
            type_abonnement enum('free','super_promoteur','promoteur_ultra') COLLATE utf8mb4_unicode_ci DEFAULT 'free',
            prix int DEFAULT '0',
            date_debut datetime DEFAULT NULL,
            date_fin datetime DEFAULT NULL,
            statut enum('actif','expire','annule') COLLATE utf8mb4_unicode_ci DEFAULT 'actif',
            transaction_id varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
            created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_client_statut (id_client,statut),
            CONSTRAINT abonnements_promoteurs_ibfk_1 FOREIGN KEY (id_client) REFERENCES clients (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

        console.log('✅ Financial tables checked/created.');
    }
}

module.exports = WalletModel;
