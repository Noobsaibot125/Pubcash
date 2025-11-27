const pool = require('./src/config/db');

const migrate = async () => {
    try {
        const connection = await pool.getConnection();
        console.log("Adding promotion_id to games table...");

        // Check if column exists first to avoid error
        const [columns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = '${process.env.DB_NAME}' 
        AND TABLE_NAME = 'games' 
        AND COLUMN_NAME = 'promotion_id'
    `);

        if (columns.length === 0) {
            await connection.query(`
          ALTER TABLE games
          ADD COLUMN promotion_id INT NULL,
          ADD CONSTRAINT fk_games_promotion FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
        `);
            console.log("Column promotion_id added.");
        } else {
            console.log("Column promotion_id already exists.");
        }

        console.log("Migration successful!");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
};

migrate();
