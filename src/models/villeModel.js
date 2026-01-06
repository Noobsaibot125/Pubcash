const pool = require('../config/db');

class VilleModel {
    static async createTable() {
        await pool.execute(`
        CREATE TABLE IF NOT EXISTS villes (
            id int NOT NULL AUTO_INCREMENT,
            nom varchar(255) NOT NULL,
            created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY nom (nom)
        ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
    `);

        // Seeding
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
            [14, 'Odienné', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [15, 'Gagnoa', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [16, 'Divo', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [17, 'Agboville', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [18, 'Adzopé', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [19, 'Dabou', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [20, 'Man', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [21, 'Guiglo', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [22, 'Duokoué', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [23, 'Bouafé', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [24, 'Korhogo', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [25, 'Boundiali', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [26, 'Soubré', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [27, 'Sassandra', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [28, 'Katiola', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [29, 'Mankono', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [30, 'Touba', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [31, 'Ferkessédougou', '2025-12-16 09:29:37', '2025-12-16 09:29:37'],
            [32, 'Bondoukou', '2025-12-16 09:29:37', '2025-12-16 09:29:37']
        ];
        for (const ville of villesData) {
            await pool.execute(`
            INSERT IGNORE INTO villes (id, nom, created_at, updated_at)
            VALUES (?, ?, ?, ?)
        `, ville);
        }
        console.log('✅ Table villes checked/created and seeded.');
    }
}

module.exports = VilleModel;
