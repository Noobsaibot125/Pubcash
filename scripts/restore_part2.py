
content = """201:     const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '365d' });
202: 
203:     // Stocker le refresh token
204:     await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [refreshToken, user.id]);
205: 
206:     if (userTable === 'utilisateurs') {
207:         await pool.execute(
208:             'UPDATE utilisateurs SET est_en_ligne = ?, derniere_connexion = NOW() WHERE id = ?',
209:             [true, user.id]
210:         );
211:     }
212: 
213:     // B. ENVOI DE LA RÉPONSE AVEC LE CODE
214:     res.status(200).json({
215:         accessToken,
216:         refreshToken,
217:         role: userRole,
218:         user: { 
219:             id: user.id, 
220:             email: user.email,
221:             nom_utilisateur: user.nom_utilisateur, // Ajout utile
222:             photo_profil: user.photo_profil,       // Ajout utile
223:             code_parrainage: finalCodeParrainage,
224:             id_google: user.id_google,
225:             id_facebook: user.id_facebook,
226:             commune: user.commune_choisie || user.commune   // <--- C'EST CA QUI MANQUAIT !
227:         }
228:     });
229: };
230: // --- NOUVELLE FONCTION POUR V├ëRIFIER L'OTP ---
231: exports.verifyOtp = async (req, res) => {
232:     const { email, otp } = req.body;
233:     try {
234:         const [rows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
235:         const user = rows[0];
236: 
237:         if (!user) return res.status(404).json({ message: "Utilisateur non trouv├⌐." });
238:         if (user.otp_code !== otp) return res.status(400).json({ message: "Code OTP incorrect." });
239:         if (new Date() > new Date(user.otp_expiration)) return res.status(400).json({ message: "Code OTP expir├⌐." });
240: 
241:         // Si tout est bon, on v├⌐rifie l'utilisateur
242:         await pool.execute(
243:             'UPDATE clients SET est_verifie = TRUE, otp_code = NULL, otp_expiration = NULL WHERE id = ?',
244:             [user.id]
245:         );
246: 
247:         // CORRECTION : Supprimer la deuxi├¿me r├⌐ponse inutile
248:         res.status(200).json({ message: "Compte v├⌐rifi├⌐ avec succ├¿s ! Vous pouvez maintenant vous connecter." });
249: 
250:     } catch (error) {
251:         console.error("Erreur verifyOtp:", error);
252:         res.status(500).json({ message: 'Erreur serveur' });
253:     }
254: };
255: 
256: 
257: // --- NOUVELLE FONCTION : LOGIN ADMIN ---
258: exports.loginAdmin = async (req, res) => {
259:     const { email, password } = req.body;
260:     if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });
261: 
262:     try {
263:         const [rows] = await pool.execute('SELECT * FROM administrateurs WHERE email = ?', [email]);
264:         const user = rows[0];
265: 
266:         if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
267: 
268:         const isMatch = await bcrypt.compare(password, user.mot_de_passe);
269:         if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
270: 
271:         // (user.role est d├⌐j├á 'superadmin' ou 'admin' dans la BDD)
272:         await generateAndStoreTokens(res, user, 'administrateurs');
273: 
274:     } catch (error) {
275:         console.error("--- ERREUR DANS loginAdmin ---", error);
276:         res.status(500).json({ message: 'Erreur serveur' });
277:     }
278: };
279: 
280: // --- NOUVELLE FONCTION : LOGIN CLIENT ---
281: exports.loginClient = async (req, res) => {
282:     const { email, password } = req.body;
283:     if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis.' });
284: 
285:     try {
286:         const [rows] = await pool.execute('SELECT * FROM clients WHERE email = ?', [email]);
287:         const user = rows[0];
288: 
289:         if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
290: 
291:         // V├⌐rification cruciale pour les clients
292:         if (!user.est_verifie) {
293:             return res.status(403).json({ message: 'Votre compte n\'est pas v├⌐rifi├⌐.' });
294:         }
295: 
296:         const isMatch = await bcrypt.compare(password, user.mot_de_passe);
297:         if (!isMatch) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
298: 
299:         // (user.role est 'client' par d├⌐faut dans la BDD)
300:         await generateAndStoreTokens(res, user, 'clients');
301: 
302:     } catch (error) {
303:         console.error("--- ERREUR DANS loginClient ---", error);
304:         res.status(500).json({ message: 'Erreur serveur' });
305:     }
306: };
307: 
308: // --- HELPER: GESTION DU BONUS DE CONNEXION QUOTIDIENNE ---
309: const handleDailyLogin = async (userId) => {
310:     const today = new Date().toISOString().split('T')[0];
311:     const yesterdayDate = new Date();
312:     yesterdayDate.setDate(yesterdayDate.getDate() - 1);
313:     const yesterday = yesterdayDate.toISOString().split('T')[0];
314: 
315:     const connection = await pool.getConnection();
316:     try {
317:         await connection.beginTransaction();
318: 
319:         // 1. Vérifier si déjà connecté aujourd'hui
320:         const [todayActivity] = await connection.execute(
321:             'SELECT id FROM daily_activity WHERE user_id = ? AND date = ?',
322:             [userId, today]
323:         );
324:         
325:         if (todayActivity.length > 0) {
326:             await connection.rollback();
327:             return; // Déjà traité pour aujourd'hui
328:         }
329: 
330:         // 2. Vérifier le streak d'hier
331:         const [yesterdayActivity] = await connection.execute(
332:             'SELECT login_streak FROM daily_activity WHERE user_id = ? AND date = ?',
333:             [userId, yesterday]
334:         );
335: 
336:         let currentStreak = 1;
337:         if (yesterdayActivity.length > 0) {
338:             const lastStreak = yesterdayActivity[0].login_streak;
339:             // Si le streak était 7 hier, on repart à 1 aujourd'hui. Sinon on incrémente.
340:             // Note: Si on veut que le cycle soit 1..7, 1..7.
341:             // Si hier = 7, (7 % 7) + 1 = 1.
342:             // Si hier = 1, (1 % 7) + 1 = 2.
343:             currentStreak = (lastStreak % 7) + 1;
344:         }
345: 
346:         // 3. Insérer l'activité du jour
347:         await connection.execute(
348:             'INSERT INTO daily_activity (user_id, date, login_streak) VALUES (?, ?, ?)',
349:             [userId, today, currentStreak]
350:         );
351: 
352:         // 4. Donner les points si streak atteint 7
353:         if (currentStreak === 7) {
354:             await connection.execute(
355:                 'UPDATE utilisateurs SET points = points + 10 WHERE id = ?',
356:                 [userId]
357:             );
358:             // Historique
359:             await connection.execute(
360:                 'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
361:                 [userId, 10, 'gagne']
362:             );
363:         }
364: 
365:         await connection.commit();
366:     } catch (error) {
367:         await connection.rollback();
368:         console.error('Erreur handleDailyLogin:', error);
369:     } finally {
370:         connection.release();
371:     }
372: };
373: 
374: // --- NOUVELLE FONCTION : LOGIN UTILISATEUR (avec Email ou Contact) ---
375: exports.loginUtilisateur = async (req, res) => {
376:     // AJOUT : on r├⌐cup├¿re push_notification
377:     const { identifier, password, push_notification } = req.body;
378: 
379:     if (!identifier || !password) return res.status(400).json({ message: 'Identifiant et mot de passe requis.' });
380: 
381:     try {
382:         const [rows] = await pool.execute(
383:             'SELECT * FROM utilisateurs WHERE email = ? OR contact = ?',
384:             [identifier, identifier]
385:         );
386:         const user = rows[0];
387: 
388:         if (!user) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
389: 
390:         // G├⌐rer les comptes Facebook sans mot de passe
391:         if (!user.mot_de_passe && user.id_facebook) {
392:             return res.status(401).json({ message: 'Ce compte est li├⌐ ├á Facebook. Veuillez vous connecter avec Facebook.' });
393:         }
394:         if (!user.mot_de_passe) {
395:             return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
396:         }
397: 
398:         if (!user.est_actif) {
399:             return res.status(403).json({ message: 'Votre compte a ├⌐t├⌐ d├⌐sactiv├⌐. Veuillez contacter le support.' });
400:         }
401: 
402:         const isMatch = await bcrypt.compare(password, user.mot_de_passe);
403:         if (!isMatch) return res.status(401).json({ message: 'Identifiant ou mot de passe incorrect.' });
404: 
405:         // =================================================================
406:         // <-- NOUVEAU : ENREGISTREMENT DU TOKEN PUSH
407:         // =================================================================
408:         if (push_notification) {
409:             // On met ├á jour le token push de l'utilisateur
410:             await pool.execute(
411:                 'UPDATE utilisateurs SET push_notification = ? WHERE id = ?',
412:                 [push_notification, user.id]
413:             );
414:         }
415:         // =================================================================
416: 
417:         // =================================================================
418: 
419:         // GESTION DU BONUS DE CONNEXION
420:         await handleDailyLogin(user.id);
421: 
422:         await generateAndStoreTokens(res, user, 'utilisateurs', 'utilisateur');
423: 
424:     } catch (error) {
425:         console.error("--- ERREUR DANS loginUtilisateur ---", error);
426:         res.status(500).json({ message: 'Erreur serveur' });
427:     }
428: };
429: exports.registerUtilisateur = async (req, res) => {
430:     console.log('📨 Données reçues registerUtilisateur:', req.body);
431: 
432:     const {
433:         nom_utilisateur,
434:         email,
435:         mot_de_passe,
436:         ville,
437:         commune,
438:         date_naissance,
439:         contact,
440:         genre,
441:         code_parrainage
442:     } = req.body;
443: 
444:     console.log('🔍 Code parrainage extrait:', code_parrainage);
445: 
446:     // VALIDATION
447:     if (!nom_utilisateur || !email || !mot_de_passe || !commune || !date_naissance) {
448:         return res.status(400).json({
449:             message: 'Nom, email, mot de passe, commune et date de naissance sont obligatoires.'
450:         });
451:     }
452: 
453:     const connection = await pool.getConnection();
454: 
455:     try {
456:         await connection.beginTransaction(); // DÉBUT DE LA TRANSACTION
457: 
458:         // ==================================================================================
459:         // 1. Vérifier si l'email, le nom d'utilisateur OU LE CONTACT existe déjà (CORRIGÉ)
460:         // ==================================================================================
461:         const [existingUsers] = await connection.execute(
462:             'SELECT id FROM utilisateurs WHERE email = ? OR nom_utilisateur = ? OR contact = ?',
463:             [email, nom_utilisateur, contact]
464:         );
465: 
466:         if (existingUsers.length > 0) {
467:             await connection.rollback();
468:             // Message d'erreur mis à jour pour informer l'utilisateur
469:             return res.status(409).json({ message: 'Email, nom d\'utilisateur ou numéro de téléphone déjà utilisé.' });
470:         }
471: 
472:         // 2. LOGIQUE DE PARRAINAGE
473:         let parrainId = null;
474: 
475:         if (code_parrainage && code_parrainage.trim() !== '') {
476:             const [parrains] = await connection.execute(
477:                 'SELECT id FROM utilisateurs WHERE code_parrainage = ?',
478:                 [code_parrainage]
479:             );
480: 
481:             if (parrains.length > 0) {
482:                 parrainId = parrains[0].id;
483: 
484:                 // A. Donner 30 points au parrain
485:                 await connection.execute(
486:                     'UPDATE utilisateurs SET points = COALESCE(points, 0) + 30 WHERE id = ?',
487:                     [parrainId]
488:                 );
489: 
490:                 // B. Créer l'historique de gain pour le parrain
491:                 await connection.execute(
492:                     'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
493:                     [parrainId, 30, 'bonus_parrainage_inscription']
494:                 );
495:             }
496:         }
497: 
498:         // 3. Hashage et Formatage
499:         const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
500:         
"""

import re
import os

# Clean line numbers
cleaned = re.sub(r'^\d+: ', '', content, flags=re.MULTILINE)

# Remove leading newline if present
cleaned = cleaned.lstrip('\n')

with open(r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js', 'a', encoding='utf-8') as f:
    f.write(cleaned)

print("Part 2 appended.")
