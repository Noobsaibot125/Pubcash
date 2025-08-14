// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const nodemailer = require('nodemailer');
//Inscription pour les Superadmin
exports.registerAdmin = async (req, res) => {
    const { nom_utilisateur, email, mot_de_passe, invitationCode } = req.body;

    // Étape 1 : Vérifier le code secret d'invitation
    if (invitationCode !== process.env.ADMIN_INVITATION_CODE) {
        return res.status(403).json({ message: 'Code d\'invitation incorrect.' });
    }

    // Étape 2 : Valider les autres champs
    if (!nom_utilisateur || !email || !mot_de_passe) {
        return res.status(400).json({ message: 'Tous les champs (sauf le code) sont requis.' });
    }
        
    try {
        // Étape 3 : Hacher le mot de passe et insérer dans la BDD
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
        const [result] = await pool.execute(
            'INSERT INTO administrateurs (nom_utilisateur, email, mot_de_passe, role) VALUES (?, ?, ?, ?)',
            [nom_utilisateur, email, hashedPassword, 'superadmin']
        );
        res.status(201).json({ message: 'Super Admin créé avec succès !', adminId: result.insertId });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
        }
        console.error("Erreur registerAdmin:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
// --- FONCTION UTILITAIRE POUR L'ENVOI D'EMAIL ---
const sendOtpEmail = async (email, otp) => {
    let transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  
    await transporter.sendMail({
      from: `"PubCash" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Votre code de vérification PubCash",
      text: `Votre code de vérification est : ${otp}`,
      html: `<b>Votre code de vérification est : ${otp}</b><p>Ce code expirera dans 10 minutes.</p>`,
    });
  };
  
  
  // --- FONCTION REGISTERCLIENT MISE À JOUR ---
  exports.registerClient = async (req, res) => {
      const { nom, prenom, nom_utilisateur, email, mot_de_passe, commune } = req.body;
      
      try {
          const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
          const otp = Math.floor(10000 + Math.random() * 90000).toString(); // Génère un code à 5 chiffres
          const otpExpiration = new Date(Date.now() + 10 * 60 * 1000); // Valide pour 10 minutes
  
          const [result] = await pool.execute(
              'INSERT INTO clients (nom, prenom, nom_utilisateur, email, mot_de_passe, commune, otp_code, otp_expiration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [nom, prenom, nom_utilisateur, email, hashedPassword, commune, otp, otpExpiration]
          );
          
          await sendOtpEmail(email, otp);
  
          res.status(201).json({ message: 'Promoteur inscrit. Veuillez vérifier votre email pour le code OTP.', email: email });
  
      } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') {
              return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
          }
          console.error("Erreur registerClient:", error);
          res.status(500).json({ message: 'Erreur serveur' });
      }
  };
  
  // --- NOUVELLE FONCTION POUR VÉRIFIER L'OTP ---
  exports.verifyOtp = async (req, res) => {
    const { email, otp } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
        const user = rows[0];

        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé." });
        if (user.otp_code !== otp) return res.status(400).json({ message: "Code OTP incorrect." });
        if (new Date() > new Date(user.otp_expiration)) return res.status(400).json({ message: "Code OTP expiré." });

        // Si tout est bon, on vérifie l'utilisateur
        await pool.execute(
            'UPDATE clients SET est_verifie = TRUE, otp_code = NULL, otp_expiration = NULL WHERE id = ?',
            [user.id]
        );

        // CORRECTION : Supprimer la deuxième réponse inutile
        res.status(200).json({ message: "Compte vérifié avec succès ! Vous pouvez maintenant vous connecter." });
        
    } catch (error) {
        console.error("Erreur verifyOtp:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
  
  
  // --- FONCTION LOGIN MISE À JOUR ---
  exports.login = async (req, res) => {
      const { email, password } = req.body;
      try {
          let [rows] = await pool.execute('SELECT * FROM administrateurs WHERE email = ?', [email]);
          let user = rows[0];
  
          if (!user) {
              [rows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
              user = rows[0];
  
              // NOUVELLE VÉRIFICATION : Le compte du client est-il vérifié ?
              if (user && !user.est_verifie) {
                  return res.status(403).json({ message: 'Votre compte n\'est pas vérifié. Veuillez utiliser le code OTP envoyé par email.' });
              }
          }
          // --- NOUVELLE LOGIQUE ---
// 3. Si toujours non trouvé, chercher dans la table des utilisateurs
if (!user) {
    // Note : Pour les tests, on autorise l'email. En production, ce serait nom_utilisateur.
    [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE email = ?', [email]);
    user = rows[0];
}
// --- FIN NOUVELLE LOGIQUE ---
          
          if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
  
          const isMatch = await bcrypt.compare(password, user.mot_de_passe);
          if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
  
          const payload = { id: user.id, email: user.email, role: user.role , commune_choisie: user.role === 'utilisateur' ? user.commune_choisie : undefined};
          const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
          
          res.status(200).json({ token, role: user.role, user: { id: user.id, email: user.email } });
  
      } catch (error) {
          console.error("--- ERREUR DANS LA FONCTION LOGIN ---", error);
          res.status(500).json({ message: 'Erreur serveur' });
      }
  };

  exports.registerUtilisateur = async (req, res) => {
    // Ajout des nouveaux champs dans la destructuration
    const { nom_utilisateur, email, mot_de_passe, commune_choisie, date_naissance, contact } = req.body;

    // Validation des champs obligatoires
    if (!nom_utilisateur || !email || !mot_de_passe || !commune_choisie || !date_naissance) {
        return res.status(400).json({ message: 'Nom, email, mot de passe, commune et date de naissance sont obligatoires.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
        
        // Modification de la requête SQL pour inclure les nouveaux champs
        await pool.execute(
            'INSERT INTO utilisateurs (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, date_naissance, contact) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                nom_utilisateur,
                email,
                hashedPassword,
                commune_choisie,
                true,
                date_naissance,  // Format attendu : YYYY-MM-DD
                contact || null  // NULL si non fourni
            ]
        );
        
        res.status(201).json({ message: 'Utilisateur inscrit avec succès !' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Ce nom d\'utilisateur ou cet email est déjà utilisé.' });
        }
        console.error("Erreur registerUtilisateur:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};