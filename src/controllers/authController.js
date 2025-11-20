// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const nodemailer = require('nodemailer');
const axios = require('axios');
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
  const checkEmailExists = async (email) => {
    const [admins] = await pool.execute('SELECT id FROM administrateurs WHERE email = ?', [email]);
    const [clients] = await pool.execute('SELECT id FROM clients WHERE email = ?', [email]);
    const [users] = await pool.execute('SELECT id FROM utilisateurs WHERE email = ?', [email]);
    
    return admins.length > 0 || clients.length > 0 || users.length > 0;
};

// Modifiez registerClient
exports.registerClient = async (req, res) => {
  // AJOUT DE 'genre'
  const { nom, prenom, nom_utilisateur, email, mot_de_passe, telephone, commune, genre } = req.body;

  if (!nom || !prenom || !nom_utilisateur || !email || !mot_de_passe || !telephone || !commune) {
      return res.status(400).json({ message: 'Tous les champs (sauf genre) sont requis.' });
  }

  try {
      const emailExists = await checkEmailExists(email);
      if (emailExists) {
          return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
      }

      const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
      const otp = Math.floor(10000 + Math.random() * 90000).toString(); 
      const otpExpiration = new Date(Date.now() + 10 * 60 * 1000);

      const [result] = await pool.execute(
          // AJOUT DE 'genre' DANS LA REQUÊTE
          `INSERT INTO clients (nom, prenom, nom_utilisateur, email, telephone, mot_de_passe, commune, genre, otp_code, otp_expiration) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          // AJOUT DE 'genre' DANS LES VALEURS
          [nom, prenom, nom_utilisateur, email, telephone, hashedPassword, commune, genre || null, otp, otpExpiration]
      );

      await sendOtpEmail(email, otp);
      res.status(201).json({ message: 'Promoteur inscrit. Veuillez vérifier votre email pour le code OTP.', email });
  } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Cet email ou téléphone est déjà utilisé.' });
      }
      console.error("Erreur registerClient:", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};
// --- NOUVELLE FONCTION UTILITAIRE POUR GÉNÉRER LES TOKENS ---
// (Pour éviter la duplication de code)
const generateAndStoreTokens = async (res, user, userTable, role) => {
  // Le rôle est soit passé en argument (pour utilisateur), soit pris de la BDD
  const userRole = role || user.role;
  const payload = { id: user.id, email: user.email, role: userRole };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

  // Stocker le refresh token
  await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [refreshToken, user.id]);

  // Mettre à jour le statut 'en ligne' pour les utilisateurs
  if (userTable === 'utilisateurs') {
      await pool.execute(
          'UPDATE utilisateurs SET est_en_ligne = ?, derniere_connexion = NOW() WHERE id = ?',
          [true, user.id]
      );
  }

  res.status(200).json({
      accessToken,
      refreshToken,
      role: userRole,
      user: { id: user.id, email: user.email }
  });
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
  
  
// --- NOUVELLE FONCTION : LOGIN ADMIN ---
exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });

  try {
      const [rows] = await pool.execute('SELECT * FROM administrateurs WHERE email = ?', [email]);
      const user = rows[0];

      if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

      const isMatch = await bcrypt.compare(password, user.mot_de_passe);
      if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

      // (user.role est déjà 'superadmin' ou 'admin' dans la BDD)
      await generateAndStoreTokens(res, user, 'administrateurs');

  } catch (error) {
      console.error("--- ERREUR DANS loginAdmin ---", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- NOUVELLE FONCTION : LOGIN CLIENT ---
exports.loginClient = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });

  try {
      const [rows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
      const user = rows[0];

      if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

      // Vérification cruciale pour les clients
      if (!user.est_verifie) {
          return res.status(403).json({ message: 'Votre compte n\'est pas vérifié.' });
      }

      const isMatch = await bcrypt.compare(password, user.mot_de_passe);
      if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

      // (user.role est 'client' par défaut dans la BDD)
      await generateAndStoreTokens(res, user, 'clients');

  } catch (error) {
      console.error("--- ERREUR DANS loginClient ---", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- NOUVELLE FONCTION : LOGIN UTILISATEUR (avec Email ou Contact) ---
exports.loginUtilisateur = async (req, res) => {
  // AJOUT : on récupère push_notification
  const { identifier, password, push_notification } = req.body;
  
  if (!identifier || !password) return res.status(400).json({ message: 'Identifiant et mot de passe requis.' });

  try {
      const [rows] = await pool.execute(
          'SELECT * FROM utilisateurs WHERE email = ? OR contact = ?', 
          [identifier, identifier]
      );
      const user = rows[0];

      if (!user) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });

      // Gérer les comptes Facebook sans mot de passe
      if (!user.mot_de_passe && user.id_facebook) {
           return res.status(401).json({ message: 'Ce compte est lié à Facebook. Veuillez vous connecter avec Facebook.' });
      }
      if (!user.mot_de_passe) {
           return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
      }

      if (!user.est_actif) {
          return res.status(403).json({ message: 'Votre compte a été désactivé. Veuillez contacter le support.' });
      }

      const isMatch = await bcrypt.compare(password, user.mot_de_passe);
      if (!isMatch) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });

      // =================================================================
      // <-- NOUVEAU : ENREGISTREMENT DU TOKEN PUSH
      // =================================================================
      if (push_notification) {
          // On met à jour le token push de l'utilisateur
          await pool.execute(
              'UPDATE utilisateurs SET push_notification = ? WHERE id = ?',
              [push_notification, user.id]
          );
      }
      // =================================================================

      await generateAndStoreTokens(res, user, 'utilisateurs', 'utilisateur');

  } catch (error) {
      console.error("--- ERREUR DANS loginUtilisateur ---", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};
exports.registerUtilisateur = async (req, res) => {
  console.log('📨 Données reçues registerUtilisateur:', req.body);

  const {
    nom_utilisateur,
    email,
    mot_de_passe,
    ville,
    commune,
    date_naissance,
    contact,
    genre // AJOUT DE 'genre'
  } = req.body;

  // VALIDATION STRICTE selon le message d'erreur
  if (!nom_utilisateur || !email || !mot_de_passe || !commune || !date_naissance) {
    console.log('❌ Champs manquants:', {
      nom_utilisateur: !nom_utilisateur,
      email: !email,
      mot_de_passe: !mot_de_passe,
      commune: !commune,
      date_naissance: !date_naissance
    });
    return res.status(400).json({
      message: 'Nom, email, mot de passe, commune et date de naissance sont obligatoires.'
    });
  }

  try {
    // Vérifier si l'email existe déjà
    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
    
    // FORMATAGE DE LA DATE
    let formattedDate = date_naissance;
    if (date_naissance.includes('/')) {
      const parts = date_naissance.split('/');
      formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    console.log('✅ Données prêtes pour insertion:', {
      nom_utilisateur,
      email,
      ville: ville || '',
      commune,
      date_naissance: formattedDate,
      contact: contact || null,
      genre: genre || null // Ajout pour log
    });

    // INSERTION avec tous les champs nécessaires
    // INSERTION avec 'genre'
    const [result] = await pool.execute(
      `INSERT INTO utilisateurs 
       (nom_utilisateur, email, mot_de_passe, ville, commune_choisie, est_actif,
        date_naissance, contact, genre, date_inscription, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
       [
        nom_utilisateur,
        email,
        hashedPassword,
        ville || '',
        commune,
        true,
        formattedDate,
        contact || null,
        genre || null // AJOUT DE 'genre'
      ]
    );

    console.log('✅ Utilisateur créé avec ID:', result.insertId);
    res.status(201).json({ 
      message: 'Utilisateur inscrit avec succès !',
      userId: result.insertId 
    });

  } catch (error) {
    console.error('❌ Erreur registerUtilisateur:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('email')) {
        return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
      }
      if (error.sqlMessage.includes('nom_utilisateur')) {
        return res.status(409).json({ message: 'Ce nom d\'utilisateur est déjà utilisé.' });
      }
      return res.status(409).json({ message: 'Nom d\'utilisateur ou email déjà utilisé.' });
    }
    
    if (error.code === 'ER_TRUNCATED_WRONG_VALUE') {
      return res.status(400).json({ message: 'Format de date invalide.' });
    }
    
    res.status(500).json({ 
      message: 'Erreur serveur lors de la création du compte',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// POST /auth/facebook
exports.facebookAuth = async (req, res) => {
  // AJOUT : on récupère push_notification
  const { accessToken, push_notification } = req.body;

  if (!accessToken) {
      return res.status(400).json({ message: 'Access token requis.' });
  }

  try {
      // ... [LOGIQUE FACEBOOK EXISTANTE : RÉCUPÉRATION PROFIL] ...
      console.log('Tentative de connexion Facebook...');
      const fbRes = await axios.get(`https://graph.facebook.com/v12.0/me`, {
          params: {
              fields: 'id,first_name,last_name,email,picture.type(large)',
              access_token: accessToken
          }
      });
      
      const profile = fbRes.data;
      const id_facebook = profile.id;
      const nom = profile.last_name || '';
      const prenom = profile.first_name || '';
      const nom_utilisateur = [prenom, nom].filter(Boolean).join(' ') || `fb_user_${id_facebook}`;
      const email = profile.email || null;
      
      let photo_profil = null;
      if (profile.picture && profile.picture.data && profile.picture.data.url) {
          photo_profil = profile.picture.data.url;
      } else {
           photo_profil = `https://graph.facebook.com/${id_facebook}/picture?type=large`;
      }

      // ... [LOGIQUE FACEBOOK EXISTANTE : CHECK USER EXIST] ...
      const query = email 
          ? 'SELECT * FROM utilisateurs WHERE id_facebook = ? OR email = ?'
          : 'SELECT * FROM utilisateurs WHERE id_facebook = ?';
      const params = email ? [id_facebook, email] : [id_facebook];
      
      let [rows] = await pool.execute(query, params);
      let user = rows[0];

      if (!user) {
          // Création
          const now = new Date();
          const [inserted] = await pool.execute(
              `INSERT INTO utilisateurs 
              (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_facebook, date_inscription, contact, photo_profil, nom, prenom) 
              VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
              [nom_utilisateur, email, true, id_facebook, now, photo_profil, nom, prenom]
          );
          const insertedId = inserted.insertId;
          [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [insertedId]);
          user = rows[0];
      } else {
          // Mise à jour existante...
          // ... [LOGIQUE UPDATE EXISTANTE COPIÉE DE TON CODE] ...
          const updates = [];
          const updateParams = [];
          if (photo_profil && photo_profil !== user.photo_profil) { updates.push('photo_profil = ?'); updateParams.push(photo_profil); }
          if (nom && nom !== user.nom) { updates.push('nom = ?'); updateParams.push(nom); }
          if (prenom && prenom !== user.prenom) { updates.push('prenom = ?'); updateParams.push(prenom); }
          if (!user.id_facebook) { updates.push('id_facebook = ?'); updateParams.push(id_facebook); }
          
          if (updates.length > 0) {
              updateParams.push(user.id);
              await pool.execute(`UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = ?`, updateParams);
              [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [user.id]);
              user = rows[0];
          }
      }

      // =================================================================
      // <-- NOUVEAU : ENREGISTREMENT DU TOKEN PUSH FACEBOOK
      // =================================================================
      if (push_notification) {
          await pool.execute(
              'UPDATE utilisateurs SET push_notification = ? WHERE id = ?',
              [push_notification, user.id]
          );
          // Mettre à jour l'objet user en mémoire pour le renvoyer au front (optionnel)
          user.push_notification = push_notification; 
      }
      // =================================================================

      // Génération des tokens
      const payload = { id: user.id, email: user.email, role: 'utilisateur' };
      const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
      const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

      await pool.execute(`UPDATE utilisateurs SET refresh_token = ?, est_en_ligne = 1, derniere_connexion = NOW() WHERE id = ?`, [newRefreshToken, user.id]);

      res.status(200).json({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          user: {
              id: user.id,
              nom_utilisateur: user.nom_utilisateur,
              email: user.email,
              photo_profil: user.photo_profil,
              role: 'utilisateur',
              push_notification: user.push_notification // On renvoie le token stocké
          },
          profileCompleted: Boolean(user.commune_choisie && user.date_naissance)
      });

  } catch (error) {
      console.error("--- ERREUR DANS facebookAuth ---", error);
      res.status(500).json({ message: 'Erreur serveur.', error: error.message });
  }
};

  // PATCH /auth/utilisateur/complete-profile
  exports.completeFacebookProfile = async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token manquant.' });
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id;
      
      // MODIFICATION : Récupérer 'genre' et 'contact'
      const { commune_choisie, date_naissance, contact, genre } = req.body;
  
      // MODIFICATION : Validation
      if (!commune_choisie || !date_naissance || !contact || !genre) {
        return res.status(400).json({ message: 'Commune, date de naissance, contact et genre sont requis.' });
      }
  
      // MODIFICATION : Mettre à jour la BDD
      await pool.execute(
        'UPDATE utilisateurs SET commune_choisie = ?, date_naissance = ?, contact = ?, genre = ? WHERE id = ?',
        [commune_choisie, date_naissance, contact, genre, userId]
      );
  
      // Recharger l'utilisateur
      const [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id = ?', [userId]);
      const user = rows[0];
  
      // Nouvelle token (optionnel) pour rafraîchir payload si tu stockes la commune dedans
      const payload = { 
        id: user.id, 
        email: user.email, 
        role: user.role || 'utilisateur',
        commune_choisie: user.commune_choisie 
    };
    const newToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
  
      res.status(200).json({
        message: 'Profil mis à jour.',
        token: newToken,
        user: {
          id: user.id,
          nom_utilisateur: user.nom_utilisateur,
          email: user.email,
          commune_choisie: user.commune_choisie,
          date_naissance: user.date_naissance,
          contact: user.contact,
          genre: user.genre // AJOUT : Renvoyer le genre
        }
      });
  
    } catch (error) {
      console.error("Erreur completeFacebookProfile:", error);
      if (error.name === 'JsonWebTokenError') return res.status(401).json({ message: 'Token invalide.' });
      res.status(500).json({ message: 'Erreur serveur.' });
    }
  };
  // POST /auth/google
  exports.googleAuth = async (req, res) => {
    // AJOUT : on récupère push_notification
    const { accessToken, push_notification } = req.body;

    if (!accessToken) {
        return res.status(400).json({ message: 'Access token Google requis.' });
    }

    try {
        // ... [LOGIQUE GOOGLE EXISTANTE : RÉCUPÉRATION PROFIL] ...
        console.log('Tentative connexion Google...');
        const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const profile = googleRes.data;
        const id_google = profile.sub;
        const email = profile.email;
        const nom = profile.family_name || '';
        const prenom = profile.given_name || '';
        const photo_profil = profile.picture || null;
        const nom_utilisateur = profile.name || [prenom, nom].filter(Boolean).join(' ') || `google_user_${id_google}`;

        if (!email) return res.status(400).json({ message: "Impossible de récupérer l'email." });

        let [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id_google = ? OR email = ?', [id_google, email]);
        let user = rows[0];

        if (!user) {
            // Création
            const now = new Date();
            const [inserted] = await pool.execute(
                `INSERT INTO utilisateurs 
                (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_google, date_inscription, photo_profil, nom, prenom) 
                VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
                [nom_utilisateur, email, true, id_google, now, photo_profil, nom, prenom]
            );
            const insertedId = inserted.insertId;
            [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [insertedId]);
            user = rows[0];
        } else {
             // Mise à jour existante...
             const updates = [];
             const updateParams = [];
             if (photo_profil && photo_profil !== user.photo_profil) { updates.push('photo_profil = ?'), updateParams.push(photo_profil); }
             if (nom && nom !== user.nom) { updates.push('nom = ?'), updateParams.push(nom); }
             if (prenom && prenom !== user.prenom) { updates.push('prenom = ?'), updateParams.push(prenom); }
             if (!user.id_google) { updates.push('id_google = ?'), updateParams.push(id_google); }
 
             if (updates.length > 0) {
                updateParams.push(user.id);
                await pool.execute(`UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = ?`, updateParams);
                [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [user.id]);
                user = rows[0];
             }
        }

        // =================================================================
        // <-- NOUVEAU : ENREGISTREMENT DU TOKEN PUSH GOOGLE
        // =================================================================
        if (push_notification) {
            await pool.execute(
                'UPDATE utilisateurs SET push_notification = ? WHERE id = ?',
                [push_notification, user.id]
            );
            user.push_notification = push_notification;
        }
        // =================================================================

        const payload = { id: user.id, email: user.email, role: 'utilisateur' };
        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
        const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });
        
        // On met aussi à jour est_en_ligne ici pour être cohérent
        await pool.execute(`UPDATE utilisateurs SET refresh_token = ?, est_en_ligne = 1, derniere_connexion = NOW() WHERE id = ?`, [newRefreshToken, user.id]);

        res.status(200).json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: user.id,
                nom_utilisateur: user.nom_utilisateur,
                email: user.email,
                photo_profil: user.photo_profil,
                role: 'utilisateur',
                push_notification: user.push_notification
            },
            profileCompleted: Boolean(user.commune_choisie && user.date_naissance && user.contact)
        });

    } catch (error) {
        console.error("--- ERREUR DANS googleAuth ---", error);
        res.status(500).json({ message: 'Erreur serveur.', error: error.message });
    }
};
  exports.refreshToken = async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(401).json({ message: 'Refresh Token requis.' });
    }

    try {
        // 1. Vérifier si le refresh token est valide
        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        
        // 2. Trouver l'utilisateur et vérifier que le token correspond à celui en BDD
        const role = decoded.role;
        let userTable;
        if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
        else if (role === 'client') userTable = 'clients';
        else if (role === 'utilisateur') userTable = 'utilisateurs';
        else return res.status(403).json({ message: 'Rôle invalide dans le token.' });

        const [rows] = await pool.execute(`SELECT refresh_token FROM ${userTable} WHERE id = ?`, [decoded.id]);
        const user = rows[0];

        if (!user || user.refresh_token !== token) {
            return res.status(403).json({ message: 'Refresh Token invalide ou révoqué.' });
        }

        // 3. Générer un nouvel accessToken
        const payload = { id: decoded.id, email: decoded.email, role: decoded.role };
        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });

        res.json({ accessToken: newAccessToken });

    } catch (error) {
        // Si le token est expiré ou invalide, on renvoie une erreur 403
        console.error("Erreur refreshToken:", error);
        return res.status(403).json({ message: 'Refresh Token invalide ou expiré.' });
    }
};

exports.logout = async (req, res) => {
  // 1. Récupérer le token depuis le header Authorization
  const authHeader = req.headers.authorization;
  
  // Si pas de header ou mal formé, on considère que c'est déjà "ok" (204 No Content)
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.sendStatus(204); 
  }

  const token = authHeader.split(' ')[1]; // On enlève "Bearer " pour garder juste le token

  try {
      // 2. Vérifier le token (On utilise JWT_SECRET car c'est l'Access Token qui est dans le header)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const userId = decoded.id;
      const role = decoded.role;
      let userTable;
      
      if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
      else if (role === 'client') userTable = 'clients';
      else if (role === 'utilisateur') userTable = 'utilisateurs';
      else return res.sendStatus(204);

      // 3. Effacer le refresh token en base de données (cela déconnecte effectivement la session)
      await pool.execute(`UPDATE ${userTable} SET refresh_token = NULL WHERE id = ?`, [userId]);

      // 4. Gestion spécifique utilisateurs (Statut en ligne + Push Notification)
      if (userTable === 'utilisateurs') {
          console.log(`[LOGOUT] Déconnexion utilisateur ID: ${userId} via Header Authorization`);
          
          // =================================================================
          // SUPPRESSION DU TOKEN DE NOTIFICATION ET STATUT HORS LIGNE
          // =================================================================
          await pool.execute(
              'UPDATE utilisateurs SET est_en_ligne = 0, push_notification = NULL WHERE id = ?', 
              [userId]
          );

          // Notification Socket.io
          const io = req.app.get('io');
          if (io) {
              try {
                  const [rows] = await pool.execute(
                      `SELECT id, nom_utilisateur, email, photo_profil, derniere_connexion, est_en_ligne
                       FROM utilisateurs WHERE est_en_ligne = 1 ORDER BY derniere_connexion DESC`
                  );
                  const normalized = rows.map(r => ({
                      id: r.id,
                      nom_utilisateur: r.nom_utilisateur,
                      email: r.email,
                      photo_profil: r.photo_profil,
                      derniere_connexion: r.derniere_connexion,
                      est_en_ligne: !!r.est_en_ligne
                  }));
                  io.emit('update_online_users', normalized);
              } catch (e) {
                  console.error('Logout: erreur socket update:', e);
              }
          }
      }

      res.status(200).json({ message: 'Déconnexion réussie.' });

  } catch (error) {
      console.error("Erreur lors de la déconnexion:", error.message);
      // Même si le token est expiré, on renvoie un succès car l'utilisateur veut partir
      res.sendStatus(204);
  }
};
// --- FONCTION POUR MOT DE PASSE OUBLIÉ ---
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
      return res.status(400).json({ message: 'Email requis.' });
  }

  try {
      // Vérifier dans les trois tables si l'email existe ET a un mot de passe
      let user = null;
      let userType = null;

      // Vérifier dans administrateurs
      const [adminRows] = await pool.execute(
          'SELECT id, email, nom_utilisateur, mot_de_passe FROM administrateurs WHERE email = ? AND mot_de_passe IS NOT NULL',
          [email]
      );
      if (adminRows.length > 0) {
          user = adminRows[0];
          userType = 'administrateur';
      }

      // Vérifier dans clients
      if (!user) {
          const [clientRows] = await pool.execute(
              'SELECT id, email, nom_utilisateur, mot_de_passe FROM clients WHERE email = ? AND mot_de_passe IS NOT NULL',
              [email]
          );
          if (clientRows.length > 0) {
              user = clientRows[0];
              userType = 'client';
          }
      }

      // Vérifier dans utilisateurs
      if (!user) {
          const [userRows] = await pool.execute(
              'SELECT id, email, nom_utilisateur, mot_de_passe FROM utilisateurs WHERE email = ? AND mot_de_passe IS NOT NULL',
              [email]
          );
          if (userRows.length > 0) {
              user = userRows[0];
              userType = 'utilisateur';
          }
      }

      // Si aucun utilisateur trouvé avec mot de passe
      if (!user) {
          return res.status(404).json({ 
              message: 'Aucun compte actif trouvé avec cet email.' 
          });
      }

      // Générer le code de réinitialisation
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      const resetCodeExpiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Stocker le code dans la table appropriée
      let tableName;
      switch (userType) {
          case 'administrateur':
              tableName = 'administrateurs';
              break;
          case 'client':
              tableName = 'clients';
              break;
          case 'utilisateur':
              tableName = 'utilisateurs';
              break;
      }

      await pool.execute(
          `UPDATE ${tableName} SET reset_code = ?, reset_code_expiration = ? WHERE id = ?`,
          [resetCode, resetCodeExpiration, user.id]
      );

      // Envoyer l'email de réinitialisation
      await sendResetPasswordEmail(email, resetCode, user.nom_utilisateur || user.nom);

      res.status(200).json({ 
          message: 'Un code de réinitialisation a été envoyé à votre email.',
          email: email 
      });

  } catch (error) {
      console.error("Erreur forgotPassword:", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- FONCTION POUR VÉRIFIER LE CODE DE RÉINITIALISATION ---
exports.verifyResetCode = async (req, res) => {
  const { email, resetCode } = req.body;

  if (!email || !resetCode) {
      return res.status(400).json({ message: 'Email et code requis.' });
  }

  try {
      // Vérifier dans les trois tables
      let user = null;
      let userType = null;

      const [adminRows] = await pool.execute(
          'SELECT id, reset_code, reset_code_expiration FROM administrateurs WHERE email = ?',
          [email]
      );
      if (adminRows.length > 0) {
          user = adminRows[0];
          userType = 'administrateur';
      }

      if (!user) {
          const [clientRows] = await pool.execute(
              'SELECT id, reset_code, reset_code_expiration FROM clients WHERE email = ?',
              [email]
          );
          if (clientRows.length > 0) {
              user = clientRows[0];
              userType = 'client';
          }
      }

      if (!user) {
          const [userRows] = await pool.execute(
              'SELECT id, reset_code, reset_code_expiration FROM utilisateurs WHERE email = ?',
              [email]
          );
          if (userRows.length > 0) {
              user = userRows[0];
              userType = 'utilisateur';
          }
      }

      if (!user) {
          return res.status(404).json({ message: 'Utilisateur non trouvé.' });
      }

      // Vérifier le code et son expiration
      if (!user.reset_code || user.reset_code !== resetCode) {
          return res.status(400).json({ message: 'Code de réinitialisation incorrect.' });
      }

      if (new Date() > new Date(user.reset_code_expiration)) {
          return res.status(400).json({ message: 'Code de réinitialisation expiré.' });
      }

      res.status(200).json({ 
          message: 'Code vérifié avec succès.',
          email: email 
      });

  } catch (error) {
      console.error("Erreur verifyResetCode:", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- FONCTION POUR RÉINITIALISER LE MOT DE PASSE ---
exports.resetPassword = async (req, res) => {
  const { email, resetCode, newPassword } = req.body;

  if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ message: 'Email, code et nouveau mot de passe requis.' });
  }

  if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  try {
      // Vérifier dans les trois tables
      let user = null;
      let userType = null;
      let tableName;

      const [adminRows] = await pool.execute(
          'SELECT id, reset_code, reset_code_expiration FROM administrateurs WHERE email = ?',
          [email]
      );
      if (adminRows.length > 0) {
          user = adminRows[0];
          userType = 'administrateur';
          tableName = 'administrateurs';
      }

      if (!user) {
          const [clientRows] = await pool.execute(
              'SELECT id, reset_code, reset_code_expiration FROM clients WHERE email = ?',
              [email]
          );
          if (clientRows.length > 0) {
              user = clientRows[0];
              userType = 'client';
              tableName = 'clients';
          }
      }

      if (!user) {
          const [userRows] = await pool.execute(
              'SELECT id, reset_code, reset_code_expiration FROM utilisateurs WHERE email = ?',
              [email]
          );
          if (userRows.length > 0) {
              user = userRows[0];
              userType = 'utilisateur';
              tableName = 'utilisateurs';
          }
      }

      if (!user) {
          return res.status(404).json({ message: 'Utilisateur non trouvé.' });
      }

      // Vérifier le code et son expiration
      if (!user.reset_code || user.reset_code !== resetCode) {
          return res.status(400).json({ message: 'Code de réinitialisation incorrect.' });
      }

      if (new Date() > new Date(user.reset_code_expiration)) {
          return res.status(400).json({ message: 'Code de réinitialisation expiré.' });
      }

      // Hacher le nouveau mot de passe
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Mettre à jour le mot de passe et effacer le code de réinitialisation
      await pool.execute(
          `UPDATE ${tableName} SET mot_de_passe = ?, reset_code = NULL, reset_code_expiration = NULL WHERE id = ?`,
          [hashedPassword, user.id]
      );

      res.status(200).json({ message: 'Mot de passe réinitialisé avec succès.' });

  } catch (error) {
      console.error("Erreur resetPassword:", error);
      res.status(500).json({ message: 'Erreur serveur' });
  }
};

// --- FONCTION POUR ENVOYER L'EMAIL DE RÉINITIALISATION ---
const sendResetPasswordEmail = async (email, resetCode, username) => {
  let transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
      },
  });

  const emailHtml = `
  <!DOCTYPE html>
  <html lang="fr">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dddddd; }
          .header { background-color: #FF7F00; padding: 20px; text-align: center; }
          .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
          .content { 
              padding: 30px; 
              color: #333333; 
              line-height: 1.6; 
          }
          .code-container { 
              text-align: center; 
              margin: 30px 0; 
              padding: 20px;
              background-color: #f8f9fa;
              border-radius: 8px;
              border: 2px dashed #dee2e6;
          }
          .reset-code { 
              font-size: 32px; 
              font-weight: bold; 
              color: #FF7F00;
              letter-spacing: 5px;
          }
          .footer { padding: 20px; text-align: center; color: #777777; font-size: 12px; }
          .warning { 
              background-color: #fff3cd; 
              border: 1px solid #ffeaa7; 
              color: #856404; 
              padding: 15px; 
              border-radius: 5px; 
              margin: 20px 0;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="header">
              <h1>RÉINITIALISATION DE MOT DE PASSE</h1>
          </div>
          <div class="content">
              <p>Bonjour <strong>${username}</strong>,</p>
              <p>Vous avez demandé la réinitialisation de votre mot de passe PubCash.</p>
              
              <div class="code-container">
                  <p><strong>Votre code de vérification :</strong></p>
                  <div class="reset-code">${resetCode}</div>
              </div>

              <div class="warning">
                  <strong>⚠️ Important :</strong> Ce code expirera dans 15 minutes.
                  Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.
              </div>

              <p>Pour compléter la réinitialisation :</p>
              <ol>
                  <li>Copiez le code ci-dessus</li>
                  <li>Rendez-vous sur la page de réinitialisation</li>
                  <li>Entrez le code et choisissez votre nouveau mot de passe</li>
              </ol>

              <p>Si vous rencontrez des difficultés, n'hésitez pas à contacter notre support.</p>
              
              <p>Cordialement,<br><strong>L'ÉQUIPE PUBCASH</strong></p>
          </div>
          <div class="footer">
              © 2025 PubCash. Tous droits réservés.
          </div>
      </div>
  </body>
  </html>
  `;

  await transporter.sendMail({
      from: `"PubCash Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Réinitialisation de votre mot de passe PubCash",
      html: emailHtml,
  });
};