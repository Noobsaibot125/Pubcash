
content = """701:         await pool.execute(
702:             'UPDATE utilisateurs SET commune_choisie = ?, date_naissance = ?, contact = ?, genre = ? WHERE id = ?',
703:             [commune_choisie, date_naissance, contact, genre, userId]
704:         );
705: 
706:         // Recharger l'utilisateur
707:         const [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id = ?', [userId]);
708:         const user = rows[0];
709: 
710:         // Générer un nouveau token (optionnel)
711:         const payload = {
712:             id: user.id,
713:             email: user.email,
714:             role: user.role || 'utilisateur',
715:             commune_choisie: user.commune_choisie
716:         };
717:         const newToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
718: 
719:         res.status(200).json({
720:             message: 'Profil mis à jour.',
721:             token: newToken,
722:             user: {
723:                 id: user.id,
724:                 nom_utilisateur: user.nom_utilisateur,
725:                 email: user.email,
726:                 commune_choisie: user.commune_choisie,
727:                 date_naissance: user.date_naissance,
728:                 contact: user.contact,
729:                 genre: user.genre
730:             }
731:         });
732: 
733:     } catch (error) {
734:         console.error("Erreur completeFacebookProfile:", error);
735:         if (error.name === 'JsonWebTokenError') return res.status(401).json({ message: 'Token invalide.' });
736:         res.status(500).json({ message: 'Erreur serveur.' });
737:     }
738: };
739: // POST /auth/google
740: exports.googleAuth = async (req, res) => {
741:     // AJOUT : on récupère code_parrainage
742:     const { accessToken, push_notification, code_parrainage } = req.body;
743: 
744:     if (!accessToken) {
745:         return res.status(400).json({ message: 'Access token Google requis.' });
746:     }
747: 
748:     try {
749:         console.log('Tentative connexion Google...');
750:         const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
751:             headers: { Authorization: `Bearer ${accessToken}` },
752:         });
753: 
754:         const profile = googleRes.data;
755:         const id_google = profile.sub;
756:         const email = profile.email;
757:         const nom = profile.family_name || '';
758:         const prenom = profile.given_name || '';
759:         const photo_profil = profile.picture || null;
760:         const nom_utilisateur = profile.name || [prenom, nom].filter(Boolean).join(' ') || `google_user_${id_google}`;
761: 
762:         if (!email) return res.status(400).json({ message: "Impossible de récupérer l'email." });
763: 
764:         let [rows] = await pool.execute('SELECT * FROM utilisateurs WHERE id_google = ? OR email = ?', [id_google, email]);
765:         let user = rows[0];
766: 
767:         if (!user) {
768:             // === LOGIQUE PARRAINAGE (NOUVEAU UTILISATEUR) ===
769:             let parrainId = null;
770:             if (code_parrainage && code_parrainage.trim() !== '') {
771:                 const [parrains] = await pool.execute('SELECT id FROM utilisateurs WHERE code_parrainage = ?', [code_parrainage]);
772:                 if (parrains.length > 0) {
773:                     parrainId = parrains[0].id;
774:                     // Créditer le parrain
775:                     await pool.execute('UPDATE utilisateurs SET points = COALESCE(points, 0) + 30 WHERE id = ?', [parrainId]);
776:                     await pool.execute('INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())', [parrainId, 30, 'bonus_parrainage_inscription']);
777:                 }
778:             }
779:             // ===============================================
780: 
781:             // Création avec parrain_id
782:             const now = new Date();
783:             const [inserted] = await pool.execute(
784:                 `INSERT INTO utilisateurs 
785:                 (nom_utilisateur, email, mot_de_passe, commune_choisie, est_actif, id_google, date_inscription, photo_profil, nom, prenom, parrain_id) 
786:                 VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
787:                 [nom_utilisateur, email, true, id_google, now, photo_profil, nom, prenom, parrainId]
788:             );
789:             const insertedId = inserted.insertId;
790:             [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [insertedId]);
791:             user = rows[0];
792:         } else {
793:             // Mise à jour existante...
794:             const updates = [];
795:             const updateParams = [];
796:             if (photo_profil && photo_profil !== user.photo_profil) { updates.push('photo_profil = ?'), updateParams.push(photo_profil); }
797:             if (nom && nom !== user.nom) { updates.push('nom = ?'), updateParams.push(nom); }
798:             if (prenom && prenom !== user.prenom) { updates.push('prenom = ?'), updateParams.push(prenom); }
799:             if (!user.id_google) { updates.push('id_google = ?'), updateParams.push(id_google); }
800: 
"""

import re
import os

# Clean line numbers
cleaned = re.sub(r'^\d+: ', '', content, flags=re.MULTILINE)

# Remove leading newline if present
cleaned = cleaned.lstrip('\n')

with open(r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js', 'a', encoding='utf-8') as f:
    f.write(cleaned)

print("Part 4 appended.")
