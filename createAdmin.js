// createAdmin.js
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db'); // Chemin vers votre config BDD
require('dotenv').config();

const createAdmin = async () => {
  try {
    const nom_utilisateur = 'superadmin';
    const email = 'admin@pubcash.com';
    const plainPassword = 'SuperAdminPassword123!'; // Choisissez un mot de passe fort

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const [result] = await pool.execute(
      'INSERT INTO administrateurs (nom_utilisateur, email, mot_de_passe, role) VALUES (?, ?, ?, ?)',
      [nom_utilisateur, email, hashedPassword, 'superadmin']
    );
    
    console.log('--- SUPER ADMIN CRÉÉ AVEC SUCCÈS ---');
    console.log(`ID: ${result.insertId}, Email: ${email}`);

  } catch (error) {
    console.error('--- ERREUR LORS DE LA CRÉATION DU SUPER ADMIN ---');
    console.error(error.message);
  } finally {
    pool.end(); // Ferme la connexion à la BDD
  }
};

createAdmin();