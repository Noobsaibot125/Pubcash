
content = """501:         let formattedDate = date_naissance;
502:         if (date_naissance.includes('/')) {
503:             const parts = date_naissance.split('/');
504:             formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
505:         }
506:         const myCode = generateReferralCode(nom_utilisateur);
507: 
508:         // 4. Insertion de l'utilisateur
509:         const [result] = await connection.execute(
510:             `INSERT INTO utilisateurs 
511:             (nom_utilisateur, email, mot_de_passe, ville, commune_choisie, est_actif,
512:             date_naissance, contact, genre, parrain_id, code_parrainage, date_inscription, created_at, updated_at) 
513:             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`, 
514:             [
515:                 nom_utilisateur,
516:                 email,
517:                 hashedPassword,
518:                 ville || '',
519:                 commune,
520:                 true,
521:                 formattedDate,
522:                 contact || null,
523:                 genre || null,
524:                 parrainId,    
525:                 myCode        
526:             ]
527:         );
528: 
529:         await connection.commit(); // VALIDATION DE LA TRANSACTION
530: 
531:         console.log('✅ Utilisateur créé avec ID:', result.insertId);
532:         res.status(201).json({
533:             message: 'Utilisateur inscrit avec succès !',
534:             userId: result.insertId
535:         });
536: 
537:     } catch (error) {
538:         await connection.rollback(); // ANNULATION SI ERREUR
539:         console.error('❌ Erreur registerUtilisateur:', error);
540:         
541:         if (error.code === 'ER_TRUNCATED_WRONG_VALUE') {
542:             return res.status(400).json({ message: 'Format de date invalide.' });
543:         }
544:         res.status(500).json({ message: 'Erreur serveur lors de la création du compte' });
545:     } finally {
546:         connection.release(); // LIBÉRER LA CONNEXION
547:     }
548: };
549: // POST /auth/facebook
550: exports.facebookAuth = async (req, res) => {
551:     // AJOUT : on récupère code_parrainage
552:     const { accessToken, push_notification, code_parrainage } = req.body;
553: 
554:     if (!accessToken) {
555:         return res.status(400).json({ message: 'Access token requis.' });
556:     }
557: 
558:     try {
559:         console.log('Tentative de connexion Facebook...');
560:         const fbRes = await axios.get(`https://graph.facebook.com/v12.0/me`, {
561:             params: {
562:                 fields: 'id,first_name,last_name,email,picture.type(large)',
563:                 access_token: accessToken
564:             }
565:         });
566: 
567:         const profile = fbRes.data;
568:         const id_facebook = profile.id;
569:         const nom = profile.last_name || '';
570:         const prenom = profile.first_name || '';
571:         const nom_utilisateur = [prenom, nom].filter(Boolean).join(' ') || `fb_user_${id_facebook}`;
572:         const email = profile.email || null;
573: 
574:         let photo_profil = null;
575:         if (profile.picture && profile.picture.data && profile.picture.data.url) {
576:             photo_profil = profile.picture.data.url;
577:         } else {
578:             photo_profil = `https://graph.facebook.com/${id_facebook}/picture?type=large`;
579:         }
580: 
581:         const query = email
582:             ? 'SELECT * FROM utilisateurs WHERE id_facebook = ? OR email = ?'
583:             : 'SELECT * FROM utilisateurs WHERE id_facebook = ?';
584:         const params = email ? [id_facebook, email] : [id_facebook];
585: 
586:         let [rows] = await pool.execute(query, params);
587:         let user = rows[0];
588: 
589:         if (!user) {
590:             // === LOGIQUE PARRAINAGE (NOUVEAU UTILISATEUR) ===
591:             let parrainId = null;
592:             if (code_parrainage && code_parrainage.trim() !== '') {
593:                 const [parrains] = await pool.execute('SELECT id FROM utilisateurs WHERE code_parrainage = ?', [code_parrainage]);
594:                 if (parrains.length > 0) {
595:                     parrainId = parrains[0].id;
596:                     // Créditer le parrain
597:                     await pool.execute('UPDATE utilisateurs SET points = COALESCE(points, 0) + 30 WHERE id = ?', [parrainId]);
598:                     await pool.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())', [parrainId, 30, 'bonus_parrainage_inscription']);
599:                 }
600:             }
601:             // ===============================================
602: 
603:             // Création avec parrain_id
604:             const now = new Date();
605:             const [inserted] = await pool.execute(
606:                 `INSERT INTO utilisateurs 
607:               (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_facebook, date_inscription, contact, photo_profil, nom, prenom, parrain_id) 
608:               VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
609:                 [nom_utilisateur, email, true, id_facebook, now, photo_profil, nom, prenom, parrainId]
610:             );
611:             const insertedId = inserted.insertId;
612:             [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [insertedId]);
613:             user = rows[0];
614:         } else {
615:             // Mise à jour existante...
616:             const updates = [];
617:             const updateParams = [];
618:             if (photo_profil && photo_profil !== user.photo_profil) { updates.push('photo_profil = ?'); updateParams.push(photo_profil); }
619:             if (nom && nom !== user.nom) { updates.push('nom = ?'); updateParams.push(nom); }
620:             if (prenom && prenom !== user.prenom) { updates.push('prenom = ?'); updateParams.push(prenom); }
621:             if (!user.id_facebook) { updates.push('id_facebook = ?'); updateParams.push(id_facebook); }
622: 
623:             if (updates.length > 0) {
624:                 updateParams.push(user.id);
625:                 await pool.execute(`UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = ?`, updateParams);
626:                 [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [user.id]);
627:                 user = rows[0];
628:             }
629:         }
630: 
631:         // Enregistrement Token Push
632:         if (push_notification) {
633:             await pool.execute('UPDATE utilisateurs SET push_notification = ? WHERE id = ?', [push_notification, user.id]);
634:             user.push_notification = push_notification;
635:         }
636: 
637:         // Génération Tokens
638:         const payload = { id: user.id, email: user.email, role: 'utilisateur' };
639:         const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });
640:         const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '365d' });
641: 
642:         await pool.execute(`UPDATE utilisateurs SET refresh_token = ?, est_en_ligne = 1, derniere_connexion = NOW() WHERE id = ?`, [newRefreshToken, user.id]);
643: 
644:         await handleDailyLogin(user.id);
645: 
646:         res.status(200).json({
647:             accessToken: newAccessToken,
648:             refreshToken: newRefreshToken,
649:             user: {
650:                 id: user.id,
651:                 nom_utilisateur: user.nom_utilisateur,
652:                 email: user.email,
653:                 photo_profil: user.photo_profil,
654:                 role: 'utilisateur',
655:                 push_notification: user.push_notification,
656:                 id_facebook: user.id_facebook, 
657:                 commune: user.commune_choisie
658:             },
659:             profileCompleted: Boolean(user.commune_choisie && user.date_naissance)
660:         });
661: 
662:     } catch (error) {
663:         console.error("--- ERREUR DANS facebookAuth ---", error);
664:         res.status(500).json({ message: 'Erreur serveur.', error: error.message });
665:     }
666: };
667: 
668: // PATCH /auth/utilisateur/complete-profile
669: exports.completeFacebookProfile = async (req, res) => {
670:     const authHeader = req.headers.authorization || '';
671:     const token = authHeader.split(' ')[1];
672:     if (!token) return res.status(401).json({ message: 'Token manquant.' });
673: 
674:     try {
675:         const decoded = jwt.verify(token, process.env.JWT_SECRET);
676:         const userId = decoded.id;
677: 
678:         const { commune_choisie, date_naissance, contact, genre } = req.body;
679: 
680:         // 1. Validation des champs
681:         if (!commune_choisie || !date_naissance || !contact || !genre) {
682:             return res.status(400).json({ message: 'Commune, date de naissance, contact et genre sont requis.' });
683:         }
684: 
685:         // =================================================================
686:         // 2. NOUVEAU : VÉRIFICATION DU DOUBLON DE NUMÉRO (CONTACT)
687:         // =================================================================
688:         // On cherche si un AUTRE utilisateur (id != userId) possède déjà ce numéro
689:         const [existingUser] = await pool.execute(
690:             'SELECT id FROM utilisateurs WHERE contact = ? AND id != ?',
691:             [contact, userId]
692:         );
693: 
694:         if (existingUser.length > 0) {
695:             // C'est ici qu'on bloque l'inscription comme dans registerUtilisateur
696:             return res.status(409).json({ message: 'Ce numéro de téléphone est déjà utilisé par un autre compte.' });
697:         }
698:         // =================================================================
699: 
700:         // 3. Mise à jour de la BDD (Si le numéro est libre)
"""

import re
import os

# Clean line numbers
cleaned = re.sub(r'^\d+: ', '', content, flags=re.MULTILINE)

# Remove leading newline if present
cleaned = cleaned.lstrip('\n')

with open(r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js', 'a', encoding='utf-8') as f:
    f.write(cleaned)

print("Part 3 appended.")
