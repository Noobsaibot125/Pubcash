const mysql = require('mysql2/promise');
require('dotenv').config();

const createDatabaseAuth = async () => {
    try {
        // Connexion SANS base de données spécifiée pour pouvoir la créer
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        });

        const dbName = process.env.DB_NAME;

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        console.log(`✅ Base de données '${dbName}' vérifiée/créée.`);

        await connection.end();
    } catch (error) {
        console.error('❌ Erreur lors de la création de la base de données:', error);
        // On ne throw pas forcément l'erreur, car si la connexion échoue ici, 
        // elle échouera probablement aussi ensuite, mais on laisse le flux continuer.
    }
};

module.exports = createDatabaseAuth;
