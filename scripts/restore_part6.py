
content = """1001:             return res.status(404).json({
1002:                 message: 'Aucun compte actif trouv├⌐ avec cet email.'
1003:             });
1004:         }
1005: 
1006:         // G├⌐n├⌐rer le code de r├⌐initialisation
1007:         const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
1008:         const resetCodeExpiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
1009: 
1010:         // Stocker le code dans la table appropri├⌐e
1011:         let tableName;
1012:         switch (userType) {
1013:             case 'administrateur':
1014:                 tableName = 'administrateurs';
1015:                 break;
1016:             case 'client':
1017:                 tableName = 'clients';
1018:                 break;
1019:             case 'utilisateur':
1020:                 tableName = 'utilisateurs';
1021:                 break;
1022:         }
1023: 
1024:         await pool.execute(
1025:             `UPDATE ${tableName} SET reset_code = ?, reset_code_expiration = ? WHERE id = ?`,
1026:             [resetCode, resetCodeExpiration, user.id]
1027:         );
1028: 
1029:         // Envoyer l'email de r├⌐initialisation
1030:         await sendResetPasswordEmail(email, resetCode, user.nom_utilisateur || user.nom);
1031: 
1032:         res.status(200).json({
1033:             message: 'Un code de r├⌐initialisation a ├⌐t├⌐ envoy├⌐ ├á votre email.',
1034:             email: email
1035:         });
1036: 
1037:     } catch (error) {
1038:         console.error("Erreur forgotPassword:", error);
1039:         res.status(500).json({ message: 'Erreur serveur' });
1040:     }
1041: };
1042: 
1043: // --- FONCTION POUR V├ëRIFIER LE CODE DE R├ëINITIALISATION ---
1044: exports.verifyResetCode = async (req, res) => {
1045:     const { email, resetCode } = req.body;
1046: 
1047:     if (!email || !resetCode) {
1048:         return res.status(400).json({ message: 'Email et code requis.' });
1049:     }
1050: 
1051:     try {
1052:         // V├⌐rifier dans les trois tables
1053:         let user = null;
1054:         let userType = null;
1055: 
1056:         const [adminRows] = await pool.execute(
1057:             'SELECT id, reset_code, reset_code_expiration FROM administrateurs WHERE email = ?',
1058:             [email]
1059:         );
1060:         if (adminRows.length > 0) {
1061:             user = adminRows[0];
1062:             userType = 'administrateur';
1063:         }
1064: 
1065:         if (!user) {
1066:             const [clientRows] = await pool.execute(
1067:                 'SELECT id, reset_code, reset_code_expiration FROM clients WHERE email = ?',
1068:                 [email]
1069:             );
1070:             if (clientRows.length > 0) {
1071:                 user = clientRows[0];
1072:                 userType = 'client';
1073:             }
1074:         }
1075: 
1076:         if (!user) {
1077:             const [userRows] = await pool.execute(
1078:                 'SELECT id, reset_code, reset_code_expiration FROM utilisateurs WHERE email = ?',
1079:                 [email]
1080:             );
1081:             if (userRows.length > 0) {
1082:                 user = userRows[0];
1083:                 userType = 'utilisateur';
1084:             }
1085:         }
1086: 
1087:         if (!user) {
1088:             return res.status(404).json({ message: 'Utilisateur non trouv├⌐.' });
1089:         }
1090: 
1091:         // V├⌐rifier le code et son expiration
1092:         if (!user.reset_code || user.reset_code !== resetCode) {
1093:             return res.status(400).json({ message: 'Code de r├⌐initialisation incorrect.' });
1094:         }
1095: 
1096:         if (new Date() > new Date(user.reset_code_expiration)) {
1097:             return res.status(400).json({ message: 'Code de r├⌐initialisation expir├⌐.' });
1098:         }
1099: 
1100:         res.status(200).json({
1101:             message: 'Code v├⌐rifi├⌐ avec succ├¿s.',
1102:             email: email
1103:         });
1104: 
1105:     } catch (error) {
1106:         console.error("Erreur verifyResetCode:", error);
1107:         res.status(500).json({ message: 'Erreur serveur' });
1108:     }
1109: };
1110: 
1111: // --- FONCTION POUR R├ëINITIALISER LE MOT DE PASSE ---
1112: exports.resetPassword = async (req, res) => {
1113:     const { email, resetCode, newPassword } = req.body;
1114: 
1115:     if (!email || !resetCode || !newPassword) {
1116:         return res.status(400).json({ message: 'Email, code et nouveau mot de passe requis.' });
1117:     }
1118: 
1119:     if (newPassword.length < 6) {
1120:         return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caract├¿res.' });
1121:     }
1122: 
1123:     try {
1124:         // V├⌐rifier dans les trois tables
1125:         let user = null;
1126:         let userType = null;
1127:         let tableName;
1128: 
1129:         const [adminRows] = await pool.execute(
1130:             'SELECT id, reset_code, reset_code_expiration FROM administrateurs WHERE email = ?',
1131:             [email]
1132:         );
1133:         if (adminRows.length > 0) {
1134:             user = adminRows[0];
1135:             userType = 'administrateur';
1136:             tableName = 'administrateurs';
1137:         }
1138: 
1139:         if (!user) {
1140:             const [clientRows] = await pool.execute(
1141:                 'SELECT id, reset_code, reset_code_expiration FROM clients WHERE email = ?',
1142:                 [email]
1143:             );
1144:             if (clientRows.length > 0) {
1145:                 user = clientRows[0];
1146:                 userType = 'client';
1147:                 tableName = 'clients';
1148:             }
1149:         }
1150: 
1151:         if (!user) {
1152:             const [userRows] = await pool.execute(
1153:                 'SELECT id, reset_code, reset_code_expiration FROM utilisateurs WHERE email = ?',
1154:                 [email]
1155:             );
1156:             if (userRows.length > 0) {
1157:                 user = userRows[0];
1158:                 userType = 'utilisateur';
1159:                 tableName = 'utilisateurs';
1160:             }
1161:         }
1162: 
1163:         if (!user) {
1164:             return res.status(404).json({ message: 'Utilisateur non trouv├⌐.' });
1165:         }
1166: 
1167:         // V├⌐rifier le code et son expiration
1168:         if (!user.reset_code || user.reset_code !== resetCode) {
1169:             return res.status(400).json({ message: 'Code de r├⌐initialisation incorrect.' });
1170:         }
1171: 
1172:         if (new Date() > new Date(user.reset_code_expiration)) {
1173:             return res.status(400).json({ message: 'Code de r├⌐initialisation expir├⌐.' });
1174:         }
1175: 
1176:         // Hacher le nouveau mot de passe
1177:         const hashedPassword = await bcrypt.hash(newPassword, 10);
1178: 
1179:         // Mettre ├á jour le mot de passe et effacer le code de r├⌐initialisation
1180:         await pool.execute(
1181:             `UPDATE ${tableName} SET mot_de_passe = ?, reset_code = NULL, reset_code_expiration = NULL WHERE id = ?`,
1182:             [hashedPassword, user.id]
1183:         );
1184: 
1185:         res.status(200).json({ message: 'Mot de passe r├⌐initialis├⌐ avec succ├¿s.' });
1186: 
1187:     } catch (error) {
1188:         console.error("Erreur resetPassword:", error);
1189:         res.status(500).json({ message: 'Erreur serveur' });
1190:     }
1191: };
1192: 
1193: // --- FONCTION POUR ENVOYER L'EMAIL DE R├ëINITIALISATION ---
1194: const sendResetPasswordEmail = async (email, resetCode, username) => {
1195:     let transporter = nodemailer.createTransport({
1196:         host: process.env.EMAIL_HOST,
1197:         port: process.env.EMAIL_PORT,
1198:         secure: false,
1199:         auth: {
1200:             user: process.env.EMAIL_USER,
1201:             pass: process.env.EMAIL_PASS,
1202:         },
1203:     });
1204: 
1205:     const emailHtml = `
1206:   <!DOCTYPE html>
1207:   <html lang="fr">
1208:   <head>
1209:       <meta charset="UTF-8">
1210:       <meta name="viewport" content="width=device-width, initial-scale=1.0">
1211:       <style>
1212:           body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4; }
1213:           .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #dddddd; }
1214:           .header { background-color: #FF7F00; padding: 20px; text-align: center; }
1215:           .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
1216:           .content { 
1217:               padding: 30px; 
1218:               color: #333333; 
1219:               line-height: 1.6; 
1220:           }
1221:           .code-container { 
1222:               text-align: center; 
1223:               margin: 30px 0; 
1224:               padding: 20px;
1225:               background-color: #f8f9fa;
1226:               border-radius: 8px;
1227:               border: 2px dashed #dee2e6;
1228:           }
1229:           .reset-code { 
1230:               font-size: 32px; 
1231:               font-weight: bold; 
1232:               color: #FF7F00;
1233:               letter-spacing: 5px;
1234:           }
1235:           .footer { padding: 20px; text-align: center; color: #777777; font-size: 12px; }
1236:           .warning { 
1237:               background-color: #fff3cd; 
1238:               border: 1px solid #ffeaa7; 
1239:               color: #856404; 
1240:               padding: 15px; 
1241:               border-radius: 5px; 
1242:               margin: 20px 0;
1243:           }
1244:       </style>
1245:   </head>
1246:   <body>
1247:       <div class="container">
1248:           <div class="header">
1249:               <h1>Reinitialisation de mot de passe</h1>
1250:           </div>
1251:           <div class="content">
1252:               <p>Bonjour <strong>${username}</strong>,</p>
1253:               <p>Vous avez demand├⌐ la reinitialisation de votre mot de passe PubCash.</p>
1254:               
1255:               <div class="code-container">
1256:                   <p><strong>Votre code de verification :</strong></p>
1257:                   <div class="reset-code">${resetCode}</div>
1258:               </div>
1259: 
1260:               <div class="warning">
1261:                   <strong>ΓÜá∩╕Å Important :</strong> Ce code expirera dans 15 minutes.
1262:                   Si vous n'avez pas demand├⌐ cette r├⌐initialisation, veuillez ignorer cet email.
1263:               </div>
1264: 
1265:               <p>Pour compl├⌐ter la reinitialisation :</p>
1266:               <ol>
1267:                   <li>Copiez le code ci-dessus</li>
1268:                   <li>Rendez-vous sur la page de reinitialisation</li>
1269:                   <li>Entrez le code et choisissez votre nouveau mot de passe</li>
1270:               </ol>
1271: 
1272:               <p>Si vous rencontrez des difficultés, n'hésitez pas à contacter notre support.</p>
1273:               
1274:               <p>Cordialement,<br><strong>L'équipe PubCash</strong></p>
1275:           </div>
1276:           <div class="footer">
1277:               © 2025 PubCash. Tous droits reservés.
1278:           </div>
1279:       </div>
1280:   </body>
1281:   </html>
1282:   `;
1283: 
1284:     await transporter.sendMail({
1285:         from: `"PubCash Support" <${process.env.EMAIL_USER}>`,
1286:         to: email,
1287:         subject: "Reinitialisation de votre mot de passe PubCash",
1288:         html: emailHtml,
1289:     });
1290: };
"""

import re
import os

# Clean line numbers
cleaned = re.sub(r'^\d+: ', '', content, flags=re.MULTILINE)

# Remove leading newline if present
cleaned = cleaned.lstrip('\n')

with open(r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js', 'a', encoding='utf-8') as f:
    f.write(cleaned)

print("Part 6 appended.")
