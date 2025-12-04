
content = """1: // src/controllers/authController.js
2: const bcrypt = require('bcryptjs');
3: const jwt = require('jsonwebtoken');
4: const pool = require('../config/db');
5: const nodemailer = require('nodemailer');
6: const axios = require('axios');
7: //Inscription pour les Superadmin
8: // 1. Fonction utilitaire pour créer le code (ne touche pas à la BDD)
9: const generateReferralCode = (nom) => {
10:     const prefix = (nom && nom.length >= 3) ? nom.substring(0, 3).toUpperCase() : 'PUB';
11:     const cleanPrefix = prefix.replace(/[^A-Z]/g, 'X');
12:     const random = Math.floor(1000 + Math.random() * 9000);
13:     return `${cleanPrefix}${random}`;
14: };
15: exports.registerAdmin = async (req, res) => {
16:     const { nom_utilisateur, email, mot_de_passe, invitationCode } = req.body;
17: 
18:     // ├ëtape 1 : V├⌐rifier le code secret d'invitation
19:     if (invitationCode !== process.env.ADMIN_INVITATION_CODE) {
20:         return res.status(403).json({ message: 'Code d\'invitation incorrect.' });
21:     }
22: 
23:     // ├ëtape 2 : Valider les autres champs
24:     if (!nom_utilisateur || !email || !mot_de_passe) {
25:         return res.status(400).json({ message: 'Tous les champs (sauf le code) sont requis.' });
26:     }
27: 
28:     try {
29:         // ├ëtape 3 : Hacher le mot de passe et ins├⌐rer dans la BDD
30:         const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
31:         const [result] = await pool.execute(
32:             'INSERT INTO administrateurs (nom_utilisateur, email, mot_de_passe, role) VALUES (?, ?, ?, ?)',
33:             [nom_utilisateur, email, hashedPassword, 'superadmin']
34:         );
35:         res.status(201).json({ message: 'Super Admin cr├⌐├⌐ avec succ├¿s !', adminId: result.insertId });
36: 
37:     } catch (error) {
38:         if (error.code === 'ER_DUP_ENTRY') {
39:             return res.status(409).json({ message: 'Cet email est d├⌐j├á utilis├⌐.' });
40:         }
41:         console.error("Erreur registerAdmin:", error);
42:         res.status(500).json({ message: 'Erreur serveur' });
43:     }
44: };
45: // --- FONCTION UTILITAIRE POUR L'ENVOI D'EMAIL ---
46: const sendOtpEmail = async (email, otp) => {
47:     let transporter = nodemailer.createTransport({
48:         host: process.env.EMAIL_HOST,
49:         port: process.env.EMAIL_PORT,
50:         secure: false, // true for 465, false for other ports
51:         auth: {
52:             user: process.env.EMAIL_USER,
53:             pass: process.env.EMAIL_PASS,
54:         },
55:     });
56: 
57:     await transporter.sendMail({
58:         from: `"PubCash" <${process.env.EMAIL_USER}>`,
59:         to: email,
60:         subject: "Votre code de verification PubCash",
61:         text: `Votre code de verification est : ${otp}`,
62:         html: `<b>Votre code de verification est : ${otp}</b><p>Ce code expirera dans 10 minutes.</p>`,
63:     });
64: };
65: 
66: 
67: // --- FONCTION REGISTERCLIENT MISE ├Ç JOUR ---
68: const checkEmailExists = async (email) => {
69:     const [admins] = await pool.execute('SELECT id FROM administrateurs WHERE email = ?', [email]);
70:     const [clients] = await pool.execute('SELECT id FROM clients WHERE email = ?', [email]);
71:     const [users] = await pool.execute('SELECT id FROM utilisateurs WHERE email = ?', [email]);
72: 
73:     return admins.length > 0 || clients.length > 0 || users.length > 0;
74: };
75: 
76: // Modifiez registerClient
77: exports.registerClient = async (req, res) => {
78:     console.log("📥 Données reçues:", req.body); // Pour voir ce que React envoie
79: 
80:     // 1. On récupère TOUS les champs, y compris les nouveaux pour l'entreprise
81:     const {
82:         nom, prenom, nom_utilisateur, email, mot_de_passe,
83:         telephone, commune, genre, type_compte, nom_entreprise, rccm
84:     } = req.body;
85: 
86:     // 2. Validation des champs COMMUNS (ceux que tout le monde doit avoir)
87:     if (!email || !mot_de_passe || !telephone || !commune) {
88:         return res.status(400).json({ message: 'Email, mot de passe, téléphone et commune sont requis.' });
89:     }
90: 
91:     // 3. Validation CONDITIONNELLE (C'est ici que ça bloquait avant)
92:     const isEntreprise = type_compte === 'entreprise';
93: 
94:     if (isEntreprise) {
95:         // Si c'est une entreprise, on exige le nom de l'entreprise et le RCCM
96:         if (!nom_entreprise || !rccm) {
97:             return res.status(400).json({ message: 'Le nom de l\'entreprise et le RCCM sont requis.' });
98:         }
99:     } else {
100:         // Si c'est un particulier, on exige nom, prénom et pseudo
101:         if (!nom || !prenom || !nom_utilisateur) {
102:             return res.status(400).json({ message: 'Nom, prénom et nom d\'utilisateur sont requis.' });
103:         }
104:     }
105: 
106:     try {
107:         // 4. Vérification doublon email
108:         const emailExists = await checkEmailExists(email);
109:         if (emailExists) {
110:             return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
111:         }
112: 
113:         // 5. Hashage mot de passe et OTP
114:         const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
115:         const otp = Math.floor(10000 + Math.random() * 90000).toString();
116:         const otpExpiration = new Date(Date.now() + 10 * 60 * 1000);
117: 
118:         // 6. Préparation des données pour SQL (Gestion des NULL)
119:         const finalNom = isEntreprise ? null : nom;
120:         const finalPrenom = isEntreprise ? null : prenom;
121: 
122:         // Astuce : On utilise le nom de l'entreprise comme pseudo interne si c'est une entreprise (pour éviter les doublons vides)
123:         const finalNomUtilisateur = isEntreprise ? nom_entreprise.replace(/\s+/g, '_').toLowerCase() : nom_utilisateur;
124: 
125:         const finalNomEntreprise = isEntreprise ? nom_entreprise : null;
126:         const finalRccm = isEntreprise ? rccm : null;
127:         const finalGenre = isEntreprise ? null : genre;
128:         const finalTypeCompte = isEntreprise ? 'entreprise' : 'particulier';
129: 
130:         // 7. Insertion en Base de Données (Mise à jour avec les colonnes entreprise)
131:         const [result] = await pool.execute(
132:             `INSERT INTO clients (
133:                 nom, prenom, nom_utilisateur, email, telephone, mot_de_passe, commune, genre, 
134:                 otp_code, otp_expiration, type_compte, nom_entreprise, rccm, est_verifie, created_at
135:             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
136:             [
137:                 finalNom,
138:                 finalPrenom,
139:                 finalNomUtilisateur,
140:                 email,
141:                 telephone,
142:                 hashedPassword,
143:                 commune,
144:                 finalGenre || null,
145:                 otp,
146:                 otpExpiration,
147:                 finalTypeCompte,
148:                 finalNomEntreprise,
149:                 finalRccm,
150:                 false // Important : on met est_verifie à false par défaut
151:             ]
152:         );
153: 
154:         // 8. Envoi email
155:         await sendOtpEmail(email, otp);
156: 
157:         res.status(201).json({
158:             message: 'Inscription réussie. Veuillez vérifier votre email.',
159:             clientId: result.insertId,
160:             email
161:         });
162: 
163:     } catch (error) {
164:         console.error("❌ Erreur registerClient:", error);
165: 
166:         if (error.code === 'ER_DUP_ENTRY') {
167:             return res.status(409).json({ message: 'Cet email, téléphone ou nom d\'utilisateur est déjà utilisé.' });
168:         }
169:         // Gestion de l'erreur si vous avez oublié de mettre à jour la BDD
170:         if (error.code === 'ER_BAD_FIELD_ERROR') {
171:             return res.status(500).json({ message: 'Erreur technique : Colonnes manquantes dans la base de données (type_compte, nom_entreprise, etc.)' });
172:         }
173: 
174:         res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
175:     }
176: };
177: // --- NOUVELLE FONCTION UTILITAIRE POUR G├ëN├ëRER LES TOKENS ---
178: 
179: 
180: // 2. MODIFICATION DE LA FONCTION DE GÉNÉRATION DE TOKENS
181: // C'est ici que la magie opère : on vérifie si le code existe avant d'en créer un.
182: const generateAndStoreTokens = async (res, user, userTable, role) => {
183:     const userRole = role || user.role;
184:     let finalCodeParrainage = user.code_parrainage;
185: 
186:     // A. Si c'est un utilisateur et qu'il n'a pas de code (anciens comptes), on en crée un
187:     if (userTable === 'utilisateurs') {
188:         if (!finalCodeParrainage) {
189:             finalCodeParrainage = generateReferralCode(user.nom_utilisateur);
190:             // On le sauvegarde en base
191:             await pool.execute(
192:                 'UPDATE utilisateurs SET code_parrainage = ? WHERE id = ?',
193:                 [finalCodeParrainage, user.id]
194:             );
195:         }
196:     }
197: 
198:     const payload = { id: user.id, email: user.email, role: userRole };
199: 
200:     const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });
"""

import re
import os

# Clean line numbers
cleaned = re.sub(r'^\d+: ', '', content, flags=re.MULTILINE)

# Remove leading newline if present
cleaned = cleaned.lstrip('\n')

with open(r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js', 'w', encoding='utf-8') as f:
    f.write(cleaned)

print("Part 1 written.")
