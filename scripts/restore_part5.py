
content = """801:             if (updates.length > 0) {
802:                 updateParams.push(user.id);
803:                 await pool.execute(`UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = ?`, updateParams);
804:                 [rows] = await pool.execute('SELECT *, "utilisateur" as role FROM utilisateurs WHERE id = ?', [user.id]);
805:                 user = rows[0];
806:             }
807:         }
808: 
809:         // Enregistrement Token Push
810:         if (push_notification) {
811:             await pool.execute('UPDATE utilisateurs SET push_notification = ? WHERE id = ?', [push_notification, user.id]);
812:             user.push_notification = push_notification;
813:         }
814: 
815:         const payload = { id: user.id, email: user.email, role: 'utilisateur' };
816:         const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });
817:         const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '365d' });
818: 
819:         await pool.execute(`UPDATE utilisateurs SET refresh_token = ?, est_en_ligne = 1, derniere_connexion = NOW() WHERE id = ?`, [newRefreshToken, user.id]);
820: 
821:         await handleDailyLogin(user.id);
822: 
823:         res.status(200).json({
824:             accessToken: newAccessToken,
825:             refreshToken: newRefreshToken,
826:             user: {
827:                 id: user.id,
828:                 nom_utilisateur: user.nom_utilisateur,
829:                 email: user.email,
830:                 photo_profil: user.photo_profil,
831:                 role: 'utilisateur',
832:                 push_notification: user.push_notification,
833:                 id_google: user.id_google,
834:                 commune: user.commune_choisie
835:             },
836:             profileCompleted: Boolean(user.commune_choisie && user.date_naissance && user.contact)
837:         });
838: 
839:     } catch (error) {
840:         console.error("--- ERREUR DANS googleAuth ---", error);
841:         res.status(500).json({ message: 'Erreur serveur.', error: error.message });
842:     }
843: };
844: exports.refreshToken = async (req, res) => {
845:     const { token } = req.body;
846:     if (!token) {
847:         return res.status(401).json({ message: 'Refresh Token requis.' });
848:     }
849: 
850:     try {
851:         // 1. V├⌐rifier si le refresh token est valide
852:         const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
853: 
854:         // 2. Trouver l'utilisateur et v├⌐rifier que le token correspond ├á celui en BDD
855:         const role = decoded.role;
856:         let userTable;
857:         if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
858:         else if (role === 'client') userTable = 'clients';
859:         else if (role === 'utilisateur') userTable = 'utilisateurs';
860:         else return res.status(403).json({ message: 'R├┤le invalide dans le token.' });
861: 
862:         const [rows] = await pool.execute(`SELECT refresh_token FROM ${userTable} WHERE id = ?`, [decoded.id]);
863:         const user = rows[0];
864: 
865:         if (!user || user.refresh_token !== token) {
866:             return res.status(403).json({ message: 'Refresh Token invalide ou r├⌐voqu├⌐.' });
867:         }
868: 
869:         // 3. G├⌐n├⌐rer un nouvel accessToken
870:         const payload = { id: decoded.id, email: decoded.email, role: decoded.role };
871:         const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });
872: 
873:         res.json({ accessToken: newAccessToken });
874: 
875:     } catch (error) {
876:         // Si le token est expir├⌐ ou invalide, on renvoie une erreur 403
877:         console.error("Erreur refreshToken:", error);
878:         return res.status(403).json({ message: 'Refresh Token invalide ou expir├⌐.' });
879:     }
880: };
881: 
882: exports.logout = async (req, res) => {
883:     // 1. R├⌐cup├⌐rer le token depuis le header Authorization
884:     const authHeader = req.headers.authorization;
885: 
886:     // Si pas de header ou mal form├⌐, on consid├¿re que c'est d├⌐j├á "ok" (204 No Content)
887:     if (!authHeader || !authHeader.startsWith('Bearer ')) {
888:         return res.sendStatus(204);
889:     }
890: 
891:     const token = authHeader.split(' ')[1]; // On enl├¿ve "Bearer " pour garder juste le token
892: 
893:     try {
894:         // 2. V├⌐rifier le token (On utilise JWT_SECRET car c'est l'Access Token qui est dans le header)
895:         const decoded = jwt.verify(token, process.env.JWT_SECRET);
896: 
897:         const userId = decoded.id;
898:         const role = decoded.role;
899:         let userTable;
900: 
901:         if (role === 'superadmin' || role === 'admin') userTable = 'administrateurs';
902:         else if (role === 'client') userTable = 'clients';
903:         else if (role === 'utilisateur') userTable = 'utilisateurs';
904:         else return res.sendStatus(204);
905: 
906:         // 3. Effacer le refresh token en base de donn├⌐es (cela d├⌐connecte effectivement la session)
907:         await pool.execute(`UPDATE ${userTable} SET refresh_token = NULL WHERE id = ?`, [userId]);
908: 
909:         // 4. Gestion sp├⌐cifique utilisateurs (Statut en ligne + Push Notification)
910:         if (userTable === 'utilisateurs') {
911:             console.log(`[LOGOUT] D├⌐connexion utilisateur ID: ${userId} via Header Authorization`);
912: 
913:             // =================================================================
914:             // SUPPRESSION DU TOKEN DE NOTIFICATION ET STATUT HORS LIGNE
915:             // =================================================================
916:             await pool.execute(
917:                 'UPDATE utilisateurs SET est_en_ligne = 0, push_notification = NULL WHERE id = ?',
918:                 [userId]
919:             );
920: 
921:             // Notification Socket.io
922:             const io = req.app.get('io');
923:             if (io) {
924:                 try {
925:                     const [rows] = await pool.execute(
926:                         `SELECT id, nom_utilisateur, email, photo_profil, derniere_connexion, est_en_ligne
927:                        FROM utilisateurs WHERE est_en_ligne = 1 ORDER BY derniere_connexion DESC`
928:                     );
929:                     const normalized = rows.map(r => ({
930:                         id: r.id,
931:                         nom_utilisateur: r.nom_utilisateur,
932:                         email: r.email,
933:                         photo_profil: r.photo_profil,
934:                         derniere_connexion: r.derniere_connexion,
935:                         est_en_ligne: !!r.est_en_ligne
936:                     }));
937:                     io.emit('update_online_users', normalized);
938:                 } catch (e) {
939:                     console.error('Logout: erreur socket update:', e);
940:                 }
941:             }
942:         }
943: 
944:         res.status(200).json({ message: 'D├⌐connexion r├⌐ussie.' });
945: 
946:     } catch (error) {
947:         console.error("Erreur lors de la d├⌐connexion:", error.message);
948:         // M├¬me si le token est expir├⌐, on renvoie un succ├¿s car l'utilisateur veut partir
949:         res.sendStatus(204);
950:     }
951: };
952: // --- FONCTION POUR MOT DE PASSE OUBLI├ë ---
953: exports.forgotPassword = async (req, res) => {
954:     const { email } = req.body;
955: 
956:     if (!email) {
957:         return res.status(400).json({ message: 'Email requis.' });
958:     }
959: 
960:     try {
961:         // V├⌐rifier dans les trois tables si l'email existe ET a un mot de passe
962:         let user = null;
963:         let userType = null;
964: 
965:         // V├⌐rifier dans administrateurs
966:         const [adminRows] = await pool.execute(
967:             'SELECT id, email, nom_utilisateur, mot_de_passe FROM administrateurs WHERE email = ? AND mot_de_passe IS NOT NULL',
968:             [email]
969:         );
970:         if (adminRows.length > 0) {
971:             user = adminRows[0];
972:             userType = 'administrateur';
973:         }
974: 
975:         // V├⌐rifier dans clients
976:         if (!user) {
977:             const [clientRows] = await pool.execute(
978:                 'SELECT id, email, nom_utilisateur, mot_de_passe FROM clients WHERE email = ? AND mot_de_passe IS NOT NULL',
979:                 [email]
980:             );
981:             if (clientRows.length > 0) {
982:                 user = clientRows[0];
983:                 userType = 'client';
984:             }
985:         }
986: 
987:         // V├⌐rifier dans utilisateurs
988:         if (!user) {
989:             const [userRows] = await pool.execute(
990:                 'SELECT id, email, nom_utilisateur, mot_de_passe FROM utilisateurs WHERE email = ? AND mot_de_passe IS NOT NULL',
991:                 [email]
992:             );
993:             if (userRows.length > 0) {
994:                 user = userRows[0];
995:                 userType = 'utilisateur';
996:             }
997:         }
998: 
999:         // Si aucun utilisateur trouv├⌐ avec mot de passe
1000:         if (!user) {
"""

import re
import os

# Clean line numbers
cleaned = re.sub(r'^\d+: ', '', content, flags=re.MULTILINE)

# Remove leading newline if present
cleaned = cleaned.lstrip('\n')

with open(r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js', 'a', encoding='utf-8') as f:
    f.write(cleaned)

print("Part 5 appended.")
