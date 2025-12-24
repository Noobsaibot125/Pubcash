const pool = require('../config/db');

class PackModel {
    static async createTable() {
        await pool.execute(`
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

        // Seeding
        const packsData = [
            [1, 'Agent', 0, 11, 50],
            [2, 'Gold', 12, 30, 75],
            [3, 'Diamant', 31, 60, 100]
        ];
        for (const pack of packsData) {
            await pool.execute(`
            INSERT IGNORE INTO packs (id, nom_pack, duree_min_secondes, duree_max_secondes, remuneration)
            VALUES (?, ?, ?, ?, ?)
        `, pack);
        }
        console.log('✅ Table packs checked/created and seeded.');
    }
}

module.exports = PackModel;
