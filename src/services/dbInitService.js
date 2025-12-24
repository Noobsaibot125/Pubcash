const pool = require('../config/db');

const initDatabase = async () => {
    console.log('🔄 Checking database initialization...');
    const connection = await pool.getConnection();

    try {
        // ==========================================
        // 1. INDEPENDENT TABLES (Create first)
        // ==========================================

        // --- ADMINISTRATEURS ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS administrateurs (
                id int NOT NULL AUTO_INCREMENT,
                nom_utilisateur varchar(255) NOT NULL,
                email varchar(255) NOT NULL,
                mot_de_passe varchar(255) NOT NULL,
                role varchar(50) DEFAULT 'superadmin',
                photo varchar(255) DEFAULT NULL,
                date_creation timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                refresh_token varchar(512) DEFAULT NULL,
                reset_code varchar(6) DEFAULT NULL,
                reset_code_expiration datetime DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY email (email)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
        `);

        // --- CLIENTS ---
        await connection.execute(`
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

        // --- UTILISATEURS ---
        await connection.execute(`
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
                UNIQUE KEY code_parrainage (code_parrainage),
                KEY parrain_id (parrain_id),
                CONSTRAINT utilisateurs_ibfk_1 FOREIGN KEY (parrain_id) REFERENCES utilisateurs (id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
        `);

        // --- PACKS (With Seeding) ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS packs (
                id int NOT NULL AUTO_INCREMENT,
                nom_pack varchar(50) NOT NULL,
                duree_min_secondes int NOT NULL,
                duree_max_secondes int NOT NULL,
                remuneration int NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY nom_pack (nom_pack)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
        `);

        const packsData = [
            [1, 'Agent', 0, 11, 50],
            [2, 'Gold', 12, 30, 75],
            [3, 'Diamant', 31, 60, 100]
        ];
        for (const pack of packsData) {
            await connection.execute(`
                INSERT IGNORE INTO packs (id, nom_pack, duree_min_secondes, duree_max_secondes, remuneration)
                VALUES (?, ?, ?, ?, ?)
            `, pack);
        }

        // --- VILLES (With Seeding) ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS villes (
                id int NOT NULL AUTO_INCREMENT,
                nom varchar(255) NOT NULL,
                created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY nom (nom)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
        `);

        const villesData = [
            [1, 'Abidjan', '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [2, 'Bouna', '2025-09-29 21:52:11', '2025-09-29 21:52:11'],
            [3, 'Yamoussoukro', '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [4, 'Bouaké', '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [5, 'San-Pédro', '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [6, 'Daloa', '2025-09-29 22:41:53', '2025-09-29 22:41:53'],
            [7, 'Dimbokro', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [8, 'Daoukro', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [9, 'Toumodi', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [10, 'Bongouanou', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [11, 'Abengourou', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [12, 'Aboisso', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [13, 'Minignan', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [14, 'Odiennu00e9', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [15, 'Gagnoa', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [16, 'Divo', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [17, 'Agboville', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [18, 'Adzopu00e9', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [19, 'Dabou', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [20, 'Man', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [21, 'Guiglo', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [22, 'Duu00e9kouu00e9', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [23, 'Bouaflu00e9', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [24, 'Korhogo', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [25, 'Boundiali', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [26, 'Soubru00e9', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [27, 'Sassandra', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [28, 'Katiola', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [29, 'Mankono', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [30, 'Touba', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [31, 'Ferkessu00e9dougou', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [32, 'Bondoukou', '2025-12-16 09:29:37', '2025-12-16 09:29:37']
        ];
        for (const ville of villesData) {
            await connection.execute(`
                INSERT IGNORE INTO villes (id, nom, created_at, updated_at)
                VALUES (?, ?, ?, ?)
            `, ville);
        }

        // --- COMMUNES (With Seeding) ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS communes (
                id int NOT NULL AUTO_INCREMENT,
                nom varchar(255) NOT NULL,
                id_ville int NOT NULL,
                created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY id_ville (id_ville)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
        `);

        const communesData = [
            [1, 'Plateau', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [2, 'Yopougon', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [3, 'Cocody', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [4, 'Abobo', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [5, 'Koumassi', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [6, 'Marcory', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [7, 'Port-Bouët', 1, '2025-09-29 21:51:07', '2025-09-29 21:51:07'],
            [8, 'AKB', 2, '2025-09-29 21:52:24', '2025-09-29 21:52:24'],
            [9, '220 Logements', 3, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [10, 'Assabou', 3, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [11, 'Habitat', 3, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [12, 'Kokrenou', 3, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [13, 'Morofé', 3, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [14, 'Commerce', 4, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [15, 'Koko', 4, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [16, 'Air France', 4, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [17, 'Ahougnanssou', 4, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [18, 'Kennedy', 4, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [19, 'Dar-Es-Salam', 4, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [20, 'Cité', 5, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [21, 'Lac', 5, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [22, 'Bardot', 5, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [23, 'Sewellé', 5, '2025-09-29 21:53:43', '2025-09-29 21:53:43'],
            [25, 'Treichville', 1, '2025-09-29 22:41:44', '2025-09-29 22:41:44'],
            [26, 'Dimbokro', 7, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [27, 'Daoukro', 8, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [28, 'Toumodi', 9, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [29, 'Bongouanou', 10, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [30, 'Abengourou', 11, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [31, 'Aboisso', 12, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [32, 'Minignan', 13, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [33, 'Odiennu00e9', 14, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [34, 'Gagnoa', 15, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [35, 'Divo', 16, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [36, 'Agboville', 17, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [37, 'Adzopu00e9', 18, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [38, 'Dabou', 19, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [39, 'Man', 20, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [40, 'Guiglo', 21, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [41, 'Duu00e9kouu00e9', 22, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [42, 'Bouaflu00e9', 23, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [43, 'Korhogo', 24, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [44, 'Boundiali', 25, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [45, 'Soubru00e9', 26, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [46, 'Sassandra', 27, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [47, 'Katiola', 28, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [48, 'Mankono', 29, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [49, 'Touba', 30, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [50, 'Ferkessu00e9dougou', 31, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [51, 'Bondoukou', 32, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [52, 'Bu00e9diala', 6, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [53, 'Daloa', 6, '2025-12-16 09:30:36', '2025-12-16 09:30:36'],
            [54, 'Gboguhu00e9', 6, '2025-12-16 09:30:36', '2025-12-16 09:30:36']
        ];

        for (const commune of communesData) {
            await connection.execute(`
                INSERT IGNORE INTO communes (id, nom, id_ville, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `, commune);
        }

        // ==========================================
        // 2. DEPENDENT TABLES (Create after independents)
        // ==========================================

        // --- ABONNEMENTS_PROMOTEURS ---
        await connection.execute(`
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

        // --- PROMOTIONS ---
        await connection.execute(`
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

        // --- ADMIN_PORTEFEUILLE_HISTORY ---
        await connection.execute(`
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

        // --- CINETPAY_TRANSACTIONS ---
        await connection.execute(`
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

        // --- COMMENTAIRES ---
        await connection.execute(`
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

        // --- DAILY_ACTIVITY ---
        await connection.execute(`
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

        // --- DEMANDES_RETRAIT ---
        await connection.execute(`
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

        // --- FEEDBACK ---
        await connection.execute(`
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

        // --- FEEDBACK_MESSAGES ---
        await connection.execute(`
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

        // --- GAMES ---
        await connection.execute(`
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

        // --- GAME_HISTORY ---
        await connection.execute(`
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

        // --- INFO_ACCUEIL ---
        await connection.execute(`
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

        // --- INTERACTIONS ---
        await connection.execute(`
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

        // --- MESSAGES ---
        await connection.execute(`
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

        // --- NOTIFICATIONS ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS notifications (
              id int NOT NULL AUTO_INCREMENT,
              id_utilisateur int DEFAULT NULL,
              type varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
              titre varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
              contenu text COLLATE utf8mb4_unicode_ci NOT NULL,
              donnees json DEFAULT NULL,
              lu tinyint(1) DEFAULT '0',
              date_creation timestamp NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              KEY idx_utilisateur_date (id_utilisateur,date_creation DESC),
              KEY idx_non_lues (id_utilisateur,lu),
              CONSTRAINT notifications_ibfk_1 FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Historique des notifications push et in-app pour les utilisateurs';
        `);

        // --- PORTEFEUILLE_ADMIN ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS portefeuille_admin (
              id int NOT NULL AUTO_INCREMENT,
              solde decimal(15,2) NOT NULL DEFAULT '0.00',
              PRIMARY KEY (id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
        `);

        // --- SOLDE_RECHARGE ---
        await connection.execute(`
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

        // --- SUIVIS_PROMOTEURS ---
        await connection.execute(`
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

        // --- SYSTEM_SETTINGS ---
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS system_settings (
              setting_key varchar(50) NOT NULL,
              setting_value varchar(255) NOT NULL,
              description varchar(255) DEFAULT NULL,
              updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (setting_key)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
        `);

        // --- TRANSFERTS_DIRECTS ---
        await connection.execute(`
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

        // --- USER_GAINS ---
        await connection.execute(`
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


        console.log('✅ All database tables checked and seeded if necessary.');

    } catch (error) {
        console.error('❌ Error initializing database:', error);
    } finally {
        connection.release();
    }
};

module.exports = initDatabase;
