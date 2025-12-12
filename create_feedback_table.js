require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

async function createFeedbackTable() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected to database.');

        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS feedback (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NULL,
                user_type VARCHAR(50) NULL,
                full_name VARCHAR(255),
                email VARCHAR(255),
                phone VARCHAR(255),
                message TEXT,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `;

        await connection.execute(createTableQuery); // Create feedback table
        console.log('Feedback table created or already exists.');

        // We also need a table for the replies/exchanges if we want to separate them, 
        // OR we can just use this table for the initial thread and use a 'parent_id' or separate table.
        // Given "exchanges", let's assume we might need a way to store subsequent messages.
        // User said "Like messages between promoter and user".
        // In that system, messages are just rows in 'messages' table.
        // Maybe we should create a 'feedback_messages' table?
        // Or just one 'feedback' table where each row is a message?
        // But the first form has "Topic" logic (Name, Email, etc).
        // Let's create a secondary table `feedback_replies` or just use `feedback` with a `parent_id`?
        // Actually, let's keep it simple: `feedback` is the "Ticket".
        // `feedback_messages` holds the conversation.

        const createMessagesQuery = `
            CREATE TABLE IF NOT EXISTS feedback_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                feedback_id INT NOT NULL,
                sender_type ENUM('user', 'admin', 'client') NOT NULL,
                sender_id INT NOT NULL,
                message TEXT NOT NULL,
                read_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `;

        // Wait, the user asked for "A table called feedback". 
        // Maybe I should just put the first message in `feedback` table and let that be it for now unless requested otherwise?
        // "pour les echanges" -> for exchanges.
        // I will create `feedback_messages` just in case, or merge them. 
        // Let's stick to ONE table as requested, maybe with `parent_id`?
        // "je crois qu'on va devoir crée une table appelé feedback" (singular table).

        // Let's add `parent_id` to `feedback` so it can be threaded?
        // But the head of the thread has extra metadata (email, phone).
        // I'll stick to just the `feedback` table for now as the "Ticket" list.
        // If they need chat, we can add `feedback_replies` later or now.
        // Let's create `feedback_replies` too, it's safer for "exchanges".

        await connection.execute(createMessagesQuery);
        console.log('Feedback messages table created.');

    } catch (error) {
        console.error('Error creating table:', error);
    } finally {
        if (connection) await connection.end();
    }
}

createFeedbackTable();
