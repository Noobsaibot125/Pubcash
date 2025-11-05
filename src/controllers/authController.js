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
  // Accepte un 'identifier' qui peut être email ou contact
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ message: 'Identifiant (Email/Téléphone) et mot de passe requis.' });

  try {
      // Cherche dans les deux colonnes
      const [rows] = await pool.execute(
          'SELECT * FROM utilisateurs WHERE email = ? OR contact = ?', 
          [identifier, identifier]
      );
      const user = rows[0];

      if (!user) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });

      // Gérer les comptes Facebook qui n'ont pas de mot_de_passe
      if (!user.mot_de_passe && user.id_facebook) {
           return res.status(401).json({ message: 'Ce compte est lié à Facebook. Veuillez vous connecter avec Facebook.' });
      }
      if (!user.mot_de_passe) {
           return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
      }

      // Vérification du statut actif
      if (!user.est_actif) {
          return res.status(403).json({ message: 'Votre compte a été désactivé. Veuillez contacter le support.' });
      }

      const isMatch = await bcrypt.compare(password, user.mot_de_passe);
      if (!isMatch) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });

      // On force le rôle 'utilisateur'
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
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ message: 'Access token requis.' });
  }

  try {
    console.log('Tentative de connexion Facebook avec token:', accessToken.substring(0, 10) + '...');

    // Récupération des informations depuis l'API Graph Facebook
    const fbRes = await axios.get(`https://graph.facebook.com/v12.0/me`, {
      params: {
        fields: 'id,first_name,last_name,email,picture.type(large)',
        access_token: accessToken
      }
    });
    
    const profile = fbRes.data;
    console.log('Profil Facebook complet reçu:', JSON.stringify(profile, null, 2)); // Ajout pour debug

    const id_facebook = profile.id;
    const nom = profile.last_name || '';
    const prenom = profile.first_name || '';
    const nom_utilisateur = [prenom, nom].filter(Boolean).join(' ') || `fb_user_${id_facebook}`;
    const email = profile.email || null;
    let photo_profil = null;
    if (profile.picture) {
      if (profile.picture.data && profile.picture.data.url) {
        photo_profil = profile.picture.data.url;
      } else if (typeof profile.picture === 'string') {
        photo_profil = profile.picture;
      }
    }
    
    // Alternative: construction manuelle de l'URL de photo
    if (!photo_profil) {
      photo_profil = `https://graph.facebook.com/${id_facebook}/picture?type=large`;
    }
    
    console.log('Photo de profil récupérée:', photo_profil); // Debug

    // Vérification si l'utilisateur existe déjà
    const query = email 
      ? 'SELECT * FROM utilisateurs WHERE id_facebook = ? OR email = ?'
      : 'SELECT * FROM utilisateurs WHERE id_facebook = ?';
    const params = email ? [id_facebook, email] : [id_facebook];
    
    let [rows] = await pool.execute(query, params);
    let user = rows[0];

    if (!user) {
      console.log('Création d\'un nouvel utilisateur Facebook');
      const now = new Date();
      
      // Insertion avec toutes les informations Facebook
      const [inserted] = await pool.execute(
        `INSERT INTO utilisateurs 
        (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_facebook, date_inscription, contact, photo_profil, nom, prenom) 
        VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          nom_utilisateur,
          email,
          true,
          id_facebook,
          now,
          photo_profil,
          nom,
          prenom
        ]
      );

      const insertedId = inserted.insertId;
      [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [insertedId]);
      user = rows[0];

    } else {
      console.log('Utilisateur Facebook existant trouvé:', user.id);
      
      // Mise à jour des informations si nécessaire
      const updates = [];
      const updateParams = [];
      
      if (photo_profil && photo_profil !== user.photo_profil) {
        updates.push('photo_profil = ?');
        updateParams.push(photo_profil);
      }
      
      if (nom && nom !== user.nom) {
        updates.push('nom = ?');
        updateParams.push(nom);
      }
      
      if (prenom && prenom !== user.prenom) {
        updates.push('prenom = ?');
        updateParams.push(prenom);
      }
      
      if (nom_utilisateur && nom_utilisateur !== user.nom_utilisateur) {
        updates.push('nom_utilisateur = ?');
        updateParams.push(nom_utilisateur);
      }
      
      // Mettre à jour l'ID Facebook si l'utilisateur se connecte pour la première fois avec Facebook
      if (!user.id_facebook) {
        updates.push('id_facebook = ?');
        updateParams.push(id_facebook);
      }
      
      if (updates.length > 0) {
        updateParams.push(user.id);
        await pool.execute(
          `UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = ?`,
          updateParams
        );
        
        // Recharger les données utilisateur
        [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [user.id]);
        user = rows[0];
      }
    }

    // Génération des tokens
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role || 'utilisateur',
    };

    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
    const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

    // Stocker le refresh token
    await pool.execute(`UPDATE utilisateurs SET refresh_token = ? WHERE id = ?`, [newRefreshToken, user.id]);

    console.log('Authentification Facebook réussie pour l\'utilisateur:', user.id);

    res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        nom_utilisateur: user.nom_utilisateur,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        photo_profil: user.photo_profil,
        role: user.role || 'utilisateur'
      },
      profileCompleted: Boolean(user.commune_choisie && user.date_naissance)
    });

  } catch (error) {
    console.error("--- ERREUR DANS facebookAuth ---", error);
    if (error.response) console.error('Erreur API Facebook:', error.response.data);
    else console.error('Erreur:', error.message);
    
    if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Un compte avec cet email ou cet ID Facebook existe déjà.' });
    }
    res.status(500).json({ message: 'Erreur serveur lors de l\'authentification Facebook.', error: error.message });
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
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ message: 'Access token Google requis.' });
  }

  try {
    console.log('Tentative de connexion Google avec token:', accessToken.substring(0, 10) + '...');

    // 1. Vérifier le token et récupérer les infos utilisateur depuis Google
    const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const profile = googleRes.data;
    console.log('Profil Google complet reçu:', JSON.stringify(profile, null, 2));

    const id_google = profile.sub; // 'sub' est l'ID Google unique
    const email = profile.email;
    const nom = profile.family_name || '';
    const prenom = profile.given_name || '';
    const photo_profil = profile.picture || null;
    const nom_utilisateur = profile.name || [prenom, nom].filter(Boolean).join(' ') || `google_user_${id_google}`;

    if (!email) {
      return res.status(400).json({ message: "Impossible de récupérer l'email depuis Google." });
    }

    // 2. Vérifier si l'utilisateur existe
    const [rows] = await pool.execute(
      'SELECT * FROM utilisateurs WHERE id_google = ? OR email = ?',
      [id_google, email]
    );
    let user = rows[0];

    // 3. Créer ou Mettre à jour l'utilisateur
    if (!user) {
      console.log('Création d\'un nouvel utilisateur Google');
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
      console.log('Utilisateur Google existant trouvé:', user.id);
      // Mettre à jour les infos
      const updates = [];
      const updateParams = [];
      
      if (photo_profil && photo_profil !== user.photo_profil) updates.push('photo_profil = ?'), updateParams.push(photo_profil);
      if (nom && nom !== user.nom) updates.push('nom = ?'), updateParams.push(nom);
      if (prenom && prenom !== user.prenom) updates.push('prenom = ?'), updateParams.push(prenom);
      if (nom_utilisateur && nom_utilisateur !== user.nom_utilisateur) updates.push('nom_utilisateur = ?'), updateParams.push(nom_utilisateur);
      if (!user.id_google) updates.push('id_google = ?'), updateParams.push(id_google);

      if (updates.length > 0) {
        updateParams.push(user.id);
        await pool.execute(`UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = ?`, updateParams);
        
        [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [user.id]);
        user = rows[0];
      }
    }

    // 4. Générer les tokens (en utilisant votre fonction utilitaire)
    // Note : J'appelle generateAndStoreTokens, mais je dois renvoyer la réponse ici
    // pour inclure 'profileCompleted'
    const payload = { id: user.id, email: user.email, role: 'utilisateur' };
    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
    const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });
    
    await pool.execute(`UPDATE utilisateurs SET refresh_token = ? WHERE id = ?`, [newRefreshToken, user.id]);

    console.log('Authentification Google réussie pour l\'utilisateur:', user.id);

    res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        nom_utilisateur: user.nom_utilisateur,
        email: user.email,
        photo_profil: user.photo_profil,
        role: 'utilisateur'
      },
      // Vérifie si le profil est complet (l'utilisateur devra le remplir si ce n'est pas le cas)
      profileCompleted: Boolean(user.commune_choisie && user.date_naissance && user.contact)
    });

  } catch (error) {
    console.error("--- ERREUR DANS googleAuth ---", error);
    if (error.response) console.error('Erreur API Google:', error.response.data);
    else console.error('Erreur:', error.message);
    res.status(500).json({ message: 'Erreur serveur lors de l\'authentification Google.', error: error.message });
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
  const { token } = req.body;
  if (!token) return res.sendStatus(204);

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const userId = decoded.id;
    const role = decoded.role;
    let userTable;
    
    if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
    else if (role === 'client') userTable = 'clients';
    else if (role === 'utilisateur') userTable = 'utilisateurs';
    else return res.sendStatus(204);

    // Effacer le refresh token
    await pool.execute(`UPDATE ${userTable} SET refresh_token = NULL WHERE id = ?`, [userId]);

    // Mettre à jour le statut en ligne pour les utilisateurs
    if (userTable === 'utilisateurs') {
      // --- AJOUT DE LOGS POUR VÉRIFIER ---
      console.log(`[LOGOUT] Tentative de déconnexion pour l'utilisateur ID: ${userId}`);
      const [result] = await pool.execute('UPDATE utilisateurs SET est_en_ligne = 0 WHERE id = ?', [userId]);
      console.log(`[LOGOUT] Résultat de la mise à jour 'est_en_ligne':`, result.info);
      // --- FIN DES LOGS ---
      const io = req.app.get('io');
      if (io) {
        try {
          // on utilise la même requête et la même normalisation
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
          console.error('Logout: erreur fetch users after logout:', e);
        }
      }
    }

    res.status(200).json({ message: 'Déconnexion réussie.' });
  } catch (error) {
    console.error("Erreur lors de la déconnexion:", error);
    res.sendStatus(204);
  }
};