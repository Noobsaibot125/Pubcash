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
        let user, userTable;

        let [adminRows] = await pool.execute('SELECT * FROM administrateurs WHERE email = ?', [email]);
        if (adminRows.length > 0) {
            user = adminRows[0];
            userTable = 'administrateurs';
            // Note: la table administrateurs n'a pas de champ est_actif pour l'instant, donc pas de vérification ici.
        } else {
            let [clientRows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
            if (clientRows.length > 0) {
                user = clientRows[0];
                userTable = 'clients';
                if (!user.est_verifie) {
                    return res.status(403).json({ message: 'Votre compte n\'est pas vérifié.' });
                }
                // Note: la table clients a 'est_verifie' mais pas 'est_actif'. On pourrait l'ajouter.
            } else {
                let [userRows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE email = ?', [email]);
                if (userRows.length > 0) {
                    user = userRows[0];
                    userTable = 'utilisateurs';
                    
                    // --- VÉRIFICATION CRUCIALE ICI ---
                    // Si l'utilisateur a été désactivé par un admin, on bloque la connexion.
                    if (!user.est_actif) { // ou user.est_actif == 0
                        return res.status(403).json({ message: 'Votre compte a été désactivé. Veuillez contacter le support.' });
                    }
                    // --- FIN DE LA VÉRIFICATION ---
                }
            }
        }
        
        if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

        const isMatch = await bcrypt.compare(password, user.mot_de_passe);
        if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

        // Le reste de la fonction (génération des tokens) est identique
        const payload = { id: user.id, email: user.email, role: user.role };
        const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
        const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

        await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [refreshToken, user.id]);
        if (userTable === 'utilisateurs') {
          await pool.execute(
            'UPDATE utilisateurs SET est_en_ligne = ?, derniere_connexion = NOW() WHERE id = ?',
            [true, user.id]
          );
        }
        res.status(200).json({
            accessToken,
            refreshToken,
            role: user.role,
            user: { id: user.id, email: user.email }
        });

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
    // Attendu : Authorization: Bearer <token>
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token manquant.' });
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id;
      const { commune_choisie, date_naissance, contact } = req.body;
  
      if (!commune_choisie || !date_naissance) {
        return res.status(400).json({ message: 'commune_choisie et date_naissance requis.' });
      }
  
      await pool.execute(
        'UPDATE utilisateurs SET commune_choisie = ?, date_naissance = ?, contact = ? WHERE id = ?',
        [commune_choisie, date_naissance, contact || null, userId]
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
          contact: user.contact
        }
      });
  
    } catch (error) {
      console.error("Erreur completeFacebookProfile:", error);
      if (error.name === 'JsonWebTokenError') return res.status(401).json({ message: 'Token invalide.' });
      res.status(500).json({ message: 'Erreur serveur.' });
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