// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const nodemailer = require('nodemailer');
const axios = require('axios');
//Inscription pour les Superadmin
// 1. Fonction utilitaire pour créer le code (ne touche pas à la BDD)
const generateReferralCode = (nom) => {
    const prefix = (nom && nom.length >= 3) ? nom.substring(0, 3).toUpperCase() : 'PUB';
    const cleanPrefix = prefix.replace(/[^A-Z]/g, 'X');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${cleanPrefix}${random}`;
};
exports.registerAdmin = async (req, res) => {
    const { nom_utilisateur, email, mot_de_passe, invitationCode } = req.body;

    // ├ëtape 1 : V├⌐rifier le code secret d\'invitation
    if (invitationCode !== process.env.ADMIN_INVITATION_CODE) {
        return res.status(403).json({ message: 'Code d\'invitation incorrect.' });
    }

    // ├ëtape 2 : Valider les autres champs
    if (!nom_utilisateur || !email || !mot_de_passe) {
        return res.status(400).json({ message: 'Tous les champs (sauf le code) sont requis.' });
    }

    try {
        // ├ëtape 3 : Hacher le mot de passe et ins├⌐rer dans la BDD
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
        const [result] = await pool.execute(
            'INSERT INTO administrateurs (nom_utilisateur, email, mot_de_passe, role) VALUES (?, ?, ?, ?)',
            [nom_utilisateur, email, hashedPassword, 'superadmin']
        );
        res.status(201).json({ message: 'Super Admin cr├⌐├⌐ avec succ├¿s !', adminId: result.insertId });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Cet email est d├⌐j├á utilis├⌐.' });
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
        subject: "Votre code de verification PubCash",
        text: `Votre code de verification est : ${otp}`,
        html: `<b>Votre code de verification est : ${otp}</b><p>Ce code expirera dans 10 minutes.</p>`,
    });
};


// --- FONCTION REGISTERCLIENT MISE ├Ç JOUR ---
const checkEmailExists = async (email) => {
    const [admins] = await pool.execute('SELECT id FROM administrateurs WHERE email = ?', [email]);
    const [clients] = await pool.execute('SELECT id FROM clients WHERE email = ?', [email]);
    const [users] = await pool.execute('SELECT id FROM utilisateurs WHERE email = ?', [email]);

    return admins.length > 0 || clients.length > 0 || users.length > 0;
};

// Modifiez registerClient
exports.registerClient = async (req, res) => {
    console.log("📥 Données reçues:", req.body); // Pour voir ce que React envoie

    // 1. On récupère TOUS les champs, y compris les nouveaux pour l\'entreprise
    const {
        nom, prenom, nom_utilisateur, email, mot_de_passe,
        telephone, commune, genre, type_compte, nom_entreprise, rccm
    } = req.body;

    // 2. Validation des champs COMMUNS (ceux que tout le monde doit avoir)
    if (!email || !mot_de_passe || !telephone || !commune) {
        return res.status(400).json({ message: 'Email, mot de passe, téléphone et commune sont requis.' });
    }

    // 3. Validation CONDITIONNELLE (C'est ici que ça bloquait avant)
    const isEntreprise = type_compte === 'entreprise';

    if (isEntreprise) {
        // Si c\'est une entreprise, on exige le nom de l\'entreprise et le RCCM
        if (!nom_entreprise || !rccm) {
            return res.status(400).json({ message: 'Le nom de l\'entreprise et le RCCM sont requis.' });
        }
    } else {
        // Si c\'est un particulier, on exige nom, prénom et pseudo
        if (!nom || !prenom || !nom_utilisateur) {
            return res.status(400).json({ message: 'Nom, prénom et nom d\'utilisateur sont requis.' });
        }
    }

    try {
        // 4. Vérification doublon email
        const emailExists = await checkEmailExists(email);
        if (emailExists) {
            return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
        }

        // 5. Hashage mot de passe et OTP
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
        const otp = Math.floor(10000 + Math.random() * 90000).toString();
        const otpExpiration = new Date(Date.now() + 10 * 60 * 1000);

        // 6. Préparation des données pour SQL (Gestion des NULL)
        const finalNom = isEntreprise ? null : nom;
        const finalPrenom = isEntreprise ? null : prenom;

        // Astuce : On utilise le nom de l\'entreprise comme pseudo interne si c\'est une entreprise (pour éviter les doublons vides)
        const finalNomUtilisateur = isEntreprise ? nom_entreprise.replace(/\s+/g, '_').toLowerCase() : nom_utilisateur;

        const finalNomEntreprise = isEntreprise ? nom_entreprise : null;
        const finalRccm = isEntreprise ? rccm : null;
        const finalGenre = isEntreprise ? null : genre;
        const finalTypeCompte = isEntreprise ? 'entreprise' : 'particulier';

        // 7. Insertion en Base de Données (Mise à jour avec les colonnes entreprise)
        const [result] = await pool.execute(
            `INSERT INTO clients (
                nom, prenom, nom_utilisateur, email, telephone, mot_de_passe, commune, genre, 
                otp_code, otp_expiration, type_compte, nom_entreprise, rccm, est_verifie, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                finalNom,
                finalPrenom,
                finalNomUtilisateur,
                email,
                telephone,
                hashedPassword,
                commune,
                finalGenre || null,
                otp,
                otpExpiration,
                finalTypeCompte,
                finalNomEntreprise,
                finalRccm,
                false // Important : on met est_verifie à false par défaut
            ]
        );

        // 8. Envoi email
        await sendOtpEmail(email, otp);

        res.status(201).json({
            message: 'Inscription réussie. Veuillez vérifier votre email.',
            clientId: result.insertId,
            email
        });

    } catch (error) {
        console.error("❌ Erreur registerClient:", error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Cet email, téléphone ou nom d\'utilisateur est déjà utilisé.' });
        }
        // Gestion de l'erreur si vous avez oublié de mettre à jour la BDD
        if (error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(500).json({ message: 'Erreur technique : Colonnes manquantes dans la base de données (type_compte, nom_entreprise, etc.)' });
        }

        res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
    }
};
// --- NOUVELLE FONCTION UTILITAIRE POUR G├ëN├ëRER LES TOKENS ---


// 2. MODIFICATION DE LA FONCTION DE GÉNÉRATION DE TOKENS
// C'est ici que la magie opère : on vérifie si le code existe avant d'en créer un.
const generateAndStoreTokens = async (res, user, userTable, role) => {
    const userRole = role || user.role;
    let finalCodeParrainage = user.code_parrainage;

    // A. Si c\'est un utilisateur et qu'il n\'a pas de code (anciens comptes), on en crée un
    if (userTable === 'utilisateurs') {
        if (!finalCodeParrainage) {
            finalCodeParrainage = generateReferralCode(user.nom_utilisateur);
            // On le sauvegarde en base
            await pool.execute(
                'UPDATE utilisateurs SET code_parrainage = ? WHERE id = ?',
                [finalCodeParrainage, user.id]
            );
        }
    }

    const payload = { id: user.id, email: user.email, role: userRole };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

    // Stocker le refresh token
    await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [refreshToken, user.id]);

    if (userTable === 'utilisateurs') {
        await pool.execute(
            'UPDATE utilisateurs SET est_en_ligne = ?, derniere_connexion = NOW() WHERE id = ?',
            [true, user.id]
        );
    }

    // B. ENVOI DE LA RÉPONSE AVEC LE CODE
    res.status(200).json({
        accessToken,
        refreshToken,
        role: userRole,
        user: { 
            id: user.id, 
            email: user.email,
            nom_utilisateur: user.nom_utilisateur, // Ajout utile
            photo_profil: user.photo_profil,       // Ajout utile
            code_parrainage: finalCodeParrainage,
            id_google: user.id_google,
            id_facebook: user.id_facebook,
            commune: user.commune_choisie || user.commune   // <--- C'EST CA QUI MANQUAIT !
        }
    });
};
// --- NOUVELLE FONCTION POUR V├ëRIFIER L'OTP ---
exports.verifyOtp = async (req, res) => {
    const { email, otp } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
        const user = rows[0];

        if (!user) return res.status(404).json({ message: "Utilisateur non trouv├⌐." });
        if (user.otp_code !== otp) return res.status(400).json({ message: "Code OTP incorrect." });
        if (new Date() > new Date(user.otp_expiration)) return res.status(400).json({ message: "Code OTP expir├⌐." });

        // Si tout est bon, on v├⌐rifie l\'utilisateur
        await pool.execute(
            'UPDATE clients SET est_verifie = TRUE, otp_code = NULL, otp_expiration = NULL WHERE id = ?',
            [user.id]
        );

        // CORRECTION : Supprimer la deuxi├¿me r├⌐ponse inutile
        res.status(200).json({ message: "Compte v├⌐rifi├⌐ avec succ├¿s ! Vous pouvez maintenant vous connecter." });

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

        // (user.role est d├⌐j├á 'superadmin' ou 'admin' dans la BDD)
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

        // --- DEBUG : Voir ce que la BDD renvoie ---
        console.log(`Tentative de connexion : ${user.email} | Bloqué ? : ${user.est_bloque}`);

        // --- CORRECTION RENFORCÉE ---
        // On vérifie si c'est 1 (nombre) ou true (booléen)
        if (user.est_bloque == 1 || user.est_bloque === true) {
            console.log(`Connexion REFUSÉE pour ${user.email} (Compte bloqué)`);
            return res.status(403).json({ 
                message: "Votre compte a été bloqué par l'administrateur. Veuillez contacter le support." 
            });
        }
        // -----------------------------

        // Vérification cruciale pour les clients
        if (!user.est_verifie) {
            return res.status(403).json({ message: 'Votre compte n\'est pas vérifié.' });
        }

        const isMatch = await bcrypt.compare(password, user.mot_de_passe);
        if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

        // --- LOGIQUE DE SUPPRESSION / RÉACTIVATION ---
        if (user.deletion_requested_at) {
            const requestDate = new Date(user.deletion_requested_at);
            const currentDate = new Date();
            const daysDifference = (currentDate - requestDate) / (1000 * 3600 * 24);

            if (daysDifference > 45) {
                return res.status(403).json({ message: "Ce compte a été supprimé définitivement." });
            } else {
                await pool.execute('UPDATE clients SET deletion_requested_at = NULL WHERE id = ?', [user.id]);
                console.log(`Compte client ${user.id} réactivé automatiquement.`);
            }
        }

        await generateAndStoreTokens(res, user, 'clients');

    } catch (error) {
        console.error("--- ERREUR DANS loginClient ---", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
// --- HELPER: GESTION DU BONUS DE CONNEXION QUOTIDIENNE ---
const handleDailyLogin = async (userId) => {
    const today = new Date().toISOString().split('T')[0];
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Vérifier si déjà connecté aujourd'hui
        const [todayActivity] = await connection.execute(
            'SELECT id FROM daily_activity WHERE user_id = ? AND date = ?',
            [userId, today]
        );
        
        if (todayActivity.length > 0) {
            await connection.rollback();
            return; // Déjà traité pour aujourd'hui
        }

        // 2. Vérifier le streak d'hier
        const [yesterdayActivity] = await connection.execute(
            'SELECT login_streak FROM daily_activity WHERE user_id = ? AND date = ?',
            [userId, yesterday]
        );

        let currentStreak = 1;
        if (yesterdayActivity.length > 0) {
            const lastStreak = yesterdayActivity[0].login_streak;
            // Si le streak était 7 hier, on repart à 1 aujourd'hui. Sinon on incrémente.
            // Note: Si on veut que le cycle soit 1..7, 1..7.
            // Si hier = 7, (7 % 7) + 1 = 1.
            // Si hier = 1, (1 % 7) + 1 = 2.
            currentStreak = (lastStreak % 7) + 1;
        }

        // 3. Insérer l'activité du jour
        await connection.execute(
            'INSERT INTO daily_activity (user_id, date, login_streak) VALUES (?, ?, ?)',
            [userId, today, currentStreak]
        );

        // 4. Donner les points si streak atteint 7
        if (currentStreak === 7) {
            await connection.execute(
                'UPDATE utilisateurs SET points = points + 10 WHERE id = ?',
                [userId]
            );
            // Historique
            await connection.execute(
                'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
                [userId, 10, 'gagne']
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        console.error('Erreur handleDailyLogin:', error);
    } finally {
        connection.release();
    }
};

// --- NOUVELLE FONCTION : LOGIN UTILISATEUR (avec Email ou Contact) ---
exports.loginUtilisateur = async (req, res) => {
    // AJOUT : on r├⌐cup├¿re push_notification
    const { identifier, password, push_notification } = req.body;

    if (!identifier || !password) return res.status(400).json({ message: 'Identifiant et mot de passe requis.' });

    try {
        const [rows] = await pool.execute(
            'SELECT * FROM utilisateurs WHERE email = ? OR contact = ?',
            [identifier, identifier]
        );
        const user = rows[0];

        if (!user) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
// --- AJOUT VÉRIFICATION BLOCAGE ---
if (user.est_bloque == 1) {
    return res.status(403).json({ 
        message: "Votre compte a été suspendu par l'administrateur. Contactez le support." 
    });
}
        // G├⌐rer les comptes Facebook sans mot de passe
        if (!user.mot_de_passe && user.id_facebook) {
            return res.status(401).json({ message: 'Ce compte est li├⌐ ├á Facebook. Veuillez vous connecter avec Facebook.' });
        }
        if (!user.mot_de_passe) {
            return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
        }

        if (!user.est_actif) {
            return res.status(403).json({ message: 'Votre compte a ├⌐t├⌐ d├⌐sactiv├⌐. Veuillez contacter le support.' });
        }

        const isMatch = await bcrypt.compare(password, user.mot_de_passe);
        if (!isMatch) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });

        // =================================================================
        // <-- NOUVEAU : ENREGISTREMENT DU TOKEN PUSH
        // =================================================================
        if (push_notification) {
            // On met ├á jour le token push de l\'utilisateur
            await pool.execute(
                'UPDATE utilisateurs SET push_notification = ? WHERE id = ?',
                [push_notification, user.id]
            );
        }
        // =================================================================

        // =================================================================

        // GESTION DU BONUS DE CONNEXION
        await handleDailyLogin(user.id);
// --- AJOUTER JUSTE AVANT LA GENERATION DES TOKENS ---
    if (user.deletion_requested_at) {
        const requestDate = new Date(user.deletion_requested_at);
        const currentDate = new Date();
        const daysDifference = (currentDate - requestDate) / (1000 * 3600 * 24);

        if (daysDifference > 45) {
            return res.status(403).json({ message: "Ce compte a été supprimé définitivement." });
        } else {
            // Réactivation automatique
            await pool.execute('UPDATE utilisateurs SET deletion_requested_at = NULL WHERE id = ?', [user.id]);
        }
    }
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
        genre,
        code_parrainage
    } = req.body;

    console.log('🔍 Code parrainage extrait:', code_parrainage);

    // VALIDATION
    if (!nom_utilisateur || !email || !mot_de_passe || !commune || !date_naissance) {
        return res.status(400).json({
            message: 'Nom, email, mot de passe, commune et date de naissance sont obligatoires.'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction(); // DÉBUT DE LA TRANSACTION

        // ==================================================================================
        // 1. Vérifier si l\'email, le nom d\'utilisateur OU LE CONTACT existe déjà (CORRIGÉ)
        // ==================================================================================
        const [existingUsers] = await connection.execute(
            'SELECT id FROM utilisateurs WHERE email = ? OR nom_utilisateur = ? OR contact = ?',
            [email, nom_utilisateur, contact]
        );

        if (existingUsers.length > 0) {
            await connection.rollback();
            // Message d\'erreur mis à jour pour informer l\'utilisateur
            return res.status(409).json({ message: 'Email, nom d\'utilisateur ou numéro de téléphone déjà utilisé.' });
        }

        // 2. LOGIQUE DE PARRAINAGE
        let parrainId = null;

        if (code_parrainage && code_parrainage.trim() !== '') {
            const [parrains] = await connection.execute(
                'SELECT id FROM utilisateurs WHERE code_parrainage = ?',
                [code_parrainage]
            );

            if (parrains.length > 0) {
                parrainId = parrains[0].id;

                // A. Donner 30 points au parrain
                await connection.execute(
                    'UPDATE utilisateurs SET points = COALESCE(points, 0) + 30 WHERE id = ?',
                    [parrainId]
                );

                // B. Créer l'historique de gain pour le parrain
                await connection.execute(
                    'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
                    [parrainId, 30, 'bonus_parrainage_inscription']
                );
            }
        }

        // 3. Hashage et Formatage
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
        
        let formattedDate = date_naissance;
        if (date_naissance.includes('/')) {
            const parts = date_naissance.split('/');
            formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        const myCode = generateReferralCode(nom_utilisateur);

        // 4. Insertion de l\'utilisateur
        const [result] = await connection.execute(
            `INSERT INTO utilisateurs 
            (nom_utilisateur, email, mot_de_passe, ville, commune_choisie, est_actif,
            date_naissance, contact, genre, parrain_id, code_parrainage, date_inscription, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`, 
            [
                nom_utilisateur,
                email,
                hashedPassword,
                ville || '',
                commune,
                true,
                formattedDate,
                contact || null,
                genre || null,
                parrainId,    
                myCode        
            ]
        );

        await connection.commit(); // VALIDATION DE LA TRANSACTION

        console.log('✅ Utilisateur créé avec ID:', result.insertId);
        res.status(201).json({
            message: 'Utilisateur inscrit avec succès !',
            userId: result.insertId
        });

    } catch (error) {
        await connection.rollback(); // ANNULATION SI ERREUR
        console.error('❌ Erreur registerUtilisateur:', error);
        
        if (error.code === 'ER_TRUNCATED_WRONG_VALUE') {
            return res.status(400).json({ message: 'Format de date invalide.' });
        }
        res.status(500).json({ message: 'Erreur serveur lors de la création du compte' });
    } finally {
        connection.release(); // LIBÉRER LA CONNEXION
    }
};
// POST /auth/facebook
exports.facebookAuth = async (req, res) => {
    // AJOUT : on récupère code_parrainage
    const { accessToken, push_notification, code_parrainage } = req.body;

    if (!accessToken) {
        return res.status(400).json({ message: 'Access token requis.' });
    }

    try {
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

        const query = email
            ? 'SELECT * FROM utilisateurs WHERE id_facebook = ? OR email = ?'
            : 'SELECT * FROM utilisateurs WHERE id_facebook = ?';
        const params = email ? [id_facebook, email] : [id_facebook];

        let [rows] = await pool.execute(query, params);
        let user = rows[0];
if (user && user.deletion_requested_at) {
    const requestDate = new Date(user.deletion_requested_at);
    const currentDate = new Date();
    const daysDifference = (currentDate - requestDate) / (1000 * 3600 * 24);

    if (daysDifference > 45) {
        return res.status(403).json({ message: "Ce compte a été supprimé définitivement." });
    } else {
        // Réactivation automatique silencieuse lors de la connexion sociale
        await pool.execute('UPDATE utilisateurs SET deletion_requested_at = NULL WHERE id = ?', [user.id]);
        // On met à jour l'objet user local pour que le reste du code soit propre
        user.deletion_requested_at = null; 
    }
}
        if (!user) {
            // === LOGIQUE PARRAINAGE (NOUVEAU UTILISATEUR) ===
            let parrainId = null;
            if (code_parrainage && code_parrainage.trim() !== '') {
                const [parrains] = await pool.execute('SELECT id FROM utilisateurs WHERE code_parrainage = ?', [code_parrainage]);
                if (parrains.length > 0) {
                    parrainId = parrains[0].id;
                    // Créditer le parrain
                    await pool.execute('UPDATE utilisateurs SET points = COALESCE(points, 0) + 30 WHERE id = ?', [parrainId]);
                    await pool.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())', [parrainId, 30, 'bonus_parrainage_inscription']);
                }
            }
            // ===============================================

            // Création avec parrain_id
            const now = new Date();
            const [inserted] = await pool.execute(
                `INSERT INTO utilisateurs 
              (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_facebook, date_inscription, contact, photo_profil, nom, prenom, parrain_id) 
              VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
                [nom_utilisateur, email, true, id_facebook, now, photo_profil, nom, prenom, parrainId]
            );
            const insertedId = inserted.insertId;
            [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [insertedId]);
            user = rows[0];
        } else {
            // Mise à jour existante...
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

        // Enregistrement Token Push
        if (push_notification) {
            await pool.execute('UPDATE utilisateurs SET push_notification = ? WHERE id = ?', [push_notification, user.id]);
            user.push_notification = push_notification;
        }

        // Génération Tokens
        const payload = { id: user.id, email: user.email, role: 'utilisateur' };
        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });
        const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '365d' });

        await pool.execute(`UPDATE utilisateurs SET refresh_token = ?, est_en_ligne = 1, derniere_connexion = NOW() WHERE id = ?`, [newRefreshToken, user.id]);

        await handleDailyLogin(user.id);

        res.status(200).json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: user.id,
                nom_utilisateur: user.nom_utilisateur,
                email: user.email,
                photo_profil: user.photo_profil,
                role: 'utilisateur',
                push_notification: user.push_notification,
                id_facebook: user.id_facebook, 
                commune: user.commune_choisie
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

        const { commune_choisie, date_naissance, contact, genre } = req.body;

        // 1. Validation des champs
        if (!commune_choisie || !date_naissance || !contact || !genre) {
            return res.status(400).json({ message: 'Commune, date de naissance, contact et genre sont requis.' });
        }

        // =================================================================
        // 2. NOUVEAU : VÉRIFICATION DU DOUBLON DE NUMÉRO (CONTACT)
        // =================================================================
        // On cherche si un AUTRE utilisateur (id != userId) possède déjà ce numéro
        const [existingUser] = await pool.execute(
            'SELECT id FROM utilisateurs WHERE contact = ? AND id != ?',
            [contact, userId]
        );

        if (existingUser.length > 0) {
            // C'est ici qu'on bloque l\'inscription comme dans registerUtilisateur
            return res.status(409).json({ message: 'Ce numéro de téléphone est déjà utilisé par un autre compte.' });
        }
        // =================================================================

        // 3. Mise à jour de la BDD (Si le numéro est libre)
        await pool.execute(
            'UPDATE utilisateurs SET commune_choisie = ?, date_naissance = ?, contact = ?, genre = ? WHERE id = ?',
            [commune_choisie, date_naissance, contact, genre, userId]
        );

        // Recharger l\'utilisateur
        const [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id = ?', [userId]);
        const user = rows[0];

        // Générer un nouveau token (optionnel)
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
                genre: user.genre
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
    // AJOUT : on récupère code_parrainage
    const { accessToken, push_notification, code_parrainage } = req.body;

    if (!accessToken) {
        return res.status(400).json({ message: 'Access token Google requis.' });
    }

    try {
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

        if (!email) return res.status(400).json({ message: "Impossible de récupérer l\'email." });

        let [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id_google = ? OR email = ?', [id_google, email]);
        let user = rows[0];
if (user && user.deletion_requested_at) {
    const requestDate = new Date(user.deletion_requested_at);
    const currentDate = new Date();
    const daysDifference = (currentDate - requestDate) / (1000 * 3600 * 24);

    if (daysDifference > 45) {
        return res.status(403).json({ message: "Ce compte a été supprimé définitivement." });
    } else {
        // Réactivation automatique silencieuse lors de la connexion sociale
        await pool.execute('UPDATE utilisateurs SET deletion_requested_at = NULL WHERE id = ?', [user.id]);
        // On met à jour l'objet user local pour que le reste du code soit propre
        user.deletion_requested_at = null; 
    }
}
        if (!user) {
            // === LOGIQUE PARRAINAGE (NOUVEAU UTILISATEUR) ===
            let parrainId = null;
            if (code_parrainage && code_parrainage.trim() !== '') {
                const [parrains] = await pool.execute('SELECT id FROM utilisateurs WHERE code_parrainage = ?', [code_parrainage]);
                if (parrains.length > 0) {
                    parrainId = parrains[0].id;
                    // Créditer le parrain
                    await pool.execute('UPDATE utilisateurs SET points = COALESCE(points, 0) + 30 WHERE id = ?', [parrainId]);
                    await pool.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())', [parrainId, 30, 'bonus_parrainage_inscription']);
                }
            }
            // ===============================================

            // Création avec parrain_id
            const now = new Date();
            const [inserted] = await pool.execute(
                `INSERT INTO utilisateurs 
                (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_google, date_inscription, photo_profil, nom, prenom, parrain_id) 
                VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
                [nom_utilisateur, email, true, id_google, now, photo_profil, nom, prenom, parrainId]
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

        // Enregistrement Token Push
        if (push_notification) {
            await pool.execute('UPDATE utilisateurs SET push_notification = ? WHERE id = ?', [push_notification, user.id]);
            user.push_notification = push_notification;
        }

        const payload = { id: user.id, email: user.email, role: 'utilisateur' };
        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });
        const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '365d' });

        await pool.execute(`UPDATE utilisateurs SET refresh_token = ?, est_en_ligne = 1, derniere_connexion = NOW() WHERE id = ?`, [newRefreshToken, user.id]);

        await handleDailyLogin(user.id);

        res.status(200).json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: user.id,
                nom_utilisateur: user.nom_utilisateur,
                email: user.email,
                photo_profil: user.photo_profil,
                role: 'utilisateur',
                push_notification: user.push_notification,
                id_google: user.id_google,
                commune: user.commune_choisie
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
        // 1. V├⌐rifier si le refresh token est valide
        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

        // 2. Trouver l\'utilisateur et v├⌐rifier que le token correspond ├á celui en BDD
        const role = decoded.role;
        let userTable;
        if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
        else if (role === 'client') userTable = 'clients';
        else if (role === 'utilisateur') userTable = 'utilisateurs';
        else return res.status(403).json({ message: 'R├┤le invalide dans le token.' });

        const [rows] = await pool.execute(`SELECT refresh_token FROM ${userTable} WHERE id = ?`, [decoded.id]);
        const user = rows[0];

        if (!user || user.refresh_token !== token) {
            return res.status(403).json({ message: 'Refresh Token invalide ou r├⌐voqu├⌐.' });
        }

        // 3. Générer un nouvel accessToken ET un nouveau refreshToken (Rotation)
        const payload = { id: decoded.id, email: decoded.email, role: decoded.role };
        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
        const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

        // 4. Mettre à jour le refresh token en base de données
        await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [newRefreshToken, decoded.id]);

        // 5. Renvoyer les deux tokens
        res.json({ 
            accessToken: newAccessToken,
            refreshToken: newRefreshToken 
        });

    } catch (error) {
        // Si le token est expir├⌐ ou invalide, on renvoie une erreur 403
        console.error("Erreur refreshToken:", error);
        return res.status(403).json({ message: 'Refresh Token invalide ou expir├⌐.' });
    }
};

exports.logout = async (req, res) => {
    // 1. R├⌐cup├⌐rer le token depuis le header Authorization
    const authHeader = req.headers.authorization;

    // Si pas de header ou mal form├⌐, on consid├¿re que c\'est d├⌐j├á "ok" (204 No Content)
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.sendStatus(204);
    }

    const token = authHeader.split(' ')[1]; // On enl├¿ve "Bearer " pour garder juste le token

    try {
        // 2. V├⌐rifier le token (On utilise JWT_SECRET car c\'est l'Access Token qui est dans le header)
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const userId = decoded.id;
        const role = decoded.role;
        let userTable;

        if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
        else if (role === 'client') userTable = 'clients';
        else if (role === 'utilisateur') userTable = 'utilisateurs';
        else return res.sendStatus(204);

        // 3. Effacer le refresh token en base de donn├⌐es (cela d├⌐connecte effectivement la session)
        await pool.execute(`UPDATE ${userTable} SET refresh_token = NULL WHERE id = ?`, [userId]);

        // 4. Gestion sp├⌐cifique utilisateurs (Statut en ligne + Push Notification)
        if (userTable === 'utilisateurs') {
            console.log(`[LOGOUT] D├⌐connexion utilisateur ID: ${userId} via Header Authorization`);

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

        res.status(200).json({ message: 'D├⌐connexion r├⌐ussie.' });

    } catch (error) {
        console.error("Erreur lors de la d├⌐connexion:", error.message);
        // M├¬me si le token est expir├⌐, on renvoie un succ├¿s car l\'utilisateur veut partir
        res.sendStatus(204);
    }
};
// --- FONCTION POUR MOT DE PASSE OUBLI├ë ---
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email requis.' });
    }

    try {
        // V├⌐rifier dans les trois tables si l\'email existe ET a un mot de passe
        let user = null;
        let userType = null;

        // V├⌐rifier dans administrateurs
        const [adminRows] = await pool.execute(
            'SELECT id, email, nom_utilisateur, mot_de_passe FROM administrateurs WHERE email = ? AND mot_de_passe IS NOT NULL',
            [email]
        );
        if (adminRows.length > 0) {
            user = adminRows[0];
            userType = 'administrateur';
        }

        // V├⌐rifier dans clients
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

        // V├⌐rifier dans utilisateurs
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

        // Si aucun utilisateur trouv├⌐ avec mot de passe
        if (!user) {
            return res.status(404).json({
                message: 'Aucun compte actif trouv├⌐ avec cet email.'
            });
        }

        // G├⌐n├⌐rer le code de r├⌐initialisation
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const resetCodeExpiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Stocker le code dans la table appropri├⌐e
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

        // Envoyer l\'email de r├⌐initialisation
        await sendResetPasswordEmail(email, resetCode, user.nom_utilisateur || user.nom);

        res.status(200).json({
            message: 'Un code de r├⌐initialisation a ├⌐t├⌐ envoy├⌐ ├á votre email.',
            email: email
        });

    } catch (error) {
        console.error("Erreur forgotPassword:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// --- FONCTION POUR V├ëRIFIER LE CODE DE R├ëINITIALISATION ---
exports.verifyResetCode = async (req, res) => {
    const { email, resetCode } = req.body;

    if (!email || !resetCode) {
        return res.status(400).json({ message: 'Email et code requis.' });
    }

    try {
        // V├⌐rifier dans les trois tables
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
            return res.status(404).json({ message: 'Utilisateur non trouv├⌐.' });
        }

        // V├⌐rifier le code et son expiration
        if (!user.reset_code || user.reset_code !== resetCode) {
            return res.status(400).json({ message: 'Code de r├⌐initialisation incorrect.' });
        }

        if (new Date() > new Date(user.reset_code_expiration)) {
            return res.status(400).json({ message: 'Code de r├⌐initialisation expir├⌐.' });
        }

        res.status(200).json({
            message: 'Code v├⌐rifi├⌐ avec succ├¿s.',
            email: email
        });

    } catch (error) {
        console.error("Erreur verifyResetCode:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// --- FONCTION POUR R├ëINITIALISER LE MOT DE PASSE ---
exports.resetPassword = async (req, res) => {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
        return res.status(400).json({ message: 'Email, code et nouveau mot de passe requis.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caract├¿res.' });
    }

    try {
        // V├⌐rifier dans les trois tables
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
            return res.status(404).json({ message: 'Utilisateur non trouv├⌐.' });
        }

        // V├⌐rifier le code et son expiration
        if (!user.reset_code || user.reset_code !== resetCode) {
            return res.status(400).json({ message: 'Code de r├⌐initialisation incorrect.' });
        }

        if (new Date() > new Date(user.reset_code_expiration)) {
            return res.status(400).json({ message: 'Code de r├⌐initialisation expir├⌐.' });
        }

        // Hacher le nouveau mot de passe
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Mettre ├á jour le mot de passe et effacer le code de r├⌐initialisation
        await pool.execute(
            `UPDATE ${tableName} SET mot_de_passe = ?, reset_code = NULL, reset_code_expiration = NULL WHERE id = ?`,
            [hashedPassword, user.id]
        );

        res.status(200).json({ message: 'Mot de passe r├⌐initialis├⌐ avec succ├¿s.' });

    } catch (error) {
        console.error("Erreur resetPassword:", error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// --- FONCTION POUR ENVOYER L'EMAIL DE R├ëINITIALISATION ---
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
              <h1>Reinitialisation de mot de passe</h1>
          </div>
          <div class="content">
              <p>Bonjour <strong>${username}</strong>,</p>
              <p>Vous avez demandé la reinitialisation de votre mot de passe PubCash.</p>
              
              <div class="code-container">
                  <p><strong>Votre code de verification :</strong></p>
                  <div class="reset-code">${resetCode}</div>
              </div>

              <div class="warning">
                  <strong>Important :</strong> Ce code expirera dans 15 minutes.
                  Si vous n\'avez pas demande cette reinitialisation, veuillez ignorer cet email.
              </div>

              <p>Pour completer la reinitialisation :</p>
              <ol>
                  <li>Copiez le code ci-dessus</li>
                  <li>Rendez-vous sur la page de reinitialisation</li>
                  <li>Entrez le code et choisissez votre nouveau mot de passe</li>
              </ol>

              <p>Si vous rencontrez des difficultés, n'hésitez pas à contacter notre support.</p>
              
              <p>Cordialement,<br><strong>L'équipe PubCash</strong></p>
          </div>
          <div class="footer">
              © 2025 PubCash. Tous droits reservés.
          </div>
      </div>
  </body>
  </html>
  `;

    await transporter.sendMail({
        from: `"PubCash Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Reinitialisation de votre mot de passe PubCash",
        html: emailHtml,
    });
};
exports.requestAccountDeletion = async (req, res) => {
    // On suppose que l'ID utilisateur est passé via le middleware d'auth dans req.user.id
    // ou passé dans le body si tu n'utilises pas encore de middleware sur cette route.
    // Pour sécuriser, on demande le mot de passe.
    const { id, password } = req.body; 

    if (!id || !password) {
        return res.status(400).json({ message: "ID et mot de passe requis." });
    }

    try {
        // 1. Vérifier le mot de passe
        const [rows] = await pool.execute('SELECT mot_de_passe FROM clients WHERE id = ?', [id]);
        const user = rows[0];

        if (!user) return res.status(404).json({ message: "Utilisateur introuvable." });

        const isMatch = await bcrypt.compare(password, user.mot_de_passe);
        if (!isMatch) return res.status(401).json({ message: "Mot de passe incorrect." });

        // 2. Enregistrer la date de demande de suppression (Soft Delete)
        await pool.execute(
            'UPDATE clients SET deletion_requested_at = NOW() WHERE id = ?',
            [id]
        );

        res.status(200).json({ message: "La suppression de votre compte a été programmée. Il sera définitivement supprimé dans 45 jours." });

    } catch (error) {
        console.error("Erreur requestAccountDeletion:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};
exports.requestUserDeletion = async (req, res) => {
    const { id, password, authProvider } = req.body; 

    // Si c'est un utilisateur social (Google/Facebook), il n'a pas forcément de mot de passe
    // On se base sur l'ID (le token JWT aura déjà validé son identité via le middleware)
    
    if (!id) return res.status(400).json({ message: "ID requis." });

    try {
        // Si l'utilisateur a un mot de passe (inscription email classique), on le vérifie
        if (authProvider === 'email') {
             if (!password) return res.status(400).json({ message: "Mot de passe requis." });
             
             const [rows] = await pool.execute('SELECT mot_de_passe FROM utilisateurs WHERE id = ?', [id]);
             if (rows.length === 0) return res.status(404).json({ message: "Utilisateur introuvable." });
             
             const isMatch = await bcrypt.compare(password, rows[0].mot_de_passe);
             if (!isMatch) return res.status(401).json({ message: "Mot de passe incorrect." });
        }

        // Soft Delete
        await pool.execute(
            'UPDATE utilisateurs SET deletion_requested_at = NOW() WHERE id = ?',
            [id]
        );

        res.status(200).json({ message: "Compte programmé pour suppression dans 45 jours." });

    } catch (error) {
        console.error("Erreur requestUserDeletion:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};