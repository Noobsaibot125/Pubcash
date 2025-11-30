const admin = require('firebase-admin');
const pool = require('../config/db'); // Correction: db au lieu de database
const notificationModel = require('../models/notificationModel');

// Initialiser Firebase Admin SDK
let firebaseInitialized = false;

const initializeFirebase = () => {
    if (firebaseInitialized) return;

    try {
        // Vérifier si les variables d'environnement sont définies
        if (!process.env.FCM_PROJECT_ID || !process.env.FCM_PRIVATE_KEY || !process.env.FCM_CLIENT_EMAIL) {
            console.warn('⚠️ Firebase non configuré : Variables FCM manquantes dans .env');
            return;
        }

        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FCM_PROJECT_ID,
                privateKey: process.env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
                clientEmail: process.env.FCM_CLIENT_EMAIL,
            }),
        });

        firebaseInitialized = true;
        console.log('✅ Firebase Admin initialisé avec succès');
    } catch (error) {
        console.error('❌ Erreur initialisation Firebase:', error.message);
    }
};

// Initialiser au chargement du module
initializeFirebase();

/**
 * Récupérer le token FCM d'un utilisateur
 */
const getUserFCMToken = async (utilisateurId) => {
    const [rows] = await pool.execute(
        'SELECT push_notification FROM utilisateurs WHERE id = ?',
        [utilisateurId]
    );
    return rows[0]?.push_notification || null;
};

/**
 * Envoyer une notification push via FCM
 */
const envoyerNotificationPush = async (token, titre, contenu, donnees = {}) => {
    if (!firebaseInitialized) {
        console.warn('⚠️ Firebase non initialisé, notification push ignorée');
        return false;
    }

    try {
        const message = {
            token: token,
            notification: {
                title: titre,
                body: contenu,
            },
            data: {
                ...donnees,
                // Convertir tous les champs en string (requis par FCM)
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'pubcash_notifications',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        };

        // Convertir les données en strings
        Object.keys(message.data).forEach(key => {
            if (typeof message.data[key] !== 'string') {
                message.data[key] = JSON.stringify(message.data[key]);
            }
        });

        await admin.messaging().send(message);
        console.log(`✅ Notification push envoyée à ${token.substring(0, 20)}...`);
        return true;
    } catch (error) {
        console.error('❌ Erreur envoi notification push:', error.message);
        // Si le token est invalide, le supprimer
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            console.log('🗑️ Token FCM invalide, suppression...');
            // On pourrait supprimer le token ici, mais on laisse pour l'instant
        }
        return false;
    }
};

/**
 * Fonction principale : Envoyer une notification complète (BDD + Push)
 */
exports.envoyerNotification = async (utilisateurId, type, titre, contenu, donnees = {}) => {
    try {
        // 1. Créer la notification en base de données
        const notificationId = await notificationModel.createNotification(
            utilisateurId,
            type,
            titre,
            contenu,
            donnees
        );

        console.log(`📬 Notification créée en BDD (ID: ${notificationId}) pour utilisateur ${utilisateurId}`);

        // 2. Récupérer le token FCM de l'utilisateur
        const token = await getUserFCMToken(utilisateurId);

        // 3. Envoyer la notification push si le token existe
        if (token) {
            await envoyerNotificationPush(token, titre, contenu, {
                ...donnees,
                notification_id: notificationId.toString(),
                type,
            });
        } else {
            console.log(`ℹ️ Pas de token FCM pour l'utilisateur ${utilisateurId}`);
        }

        return notificationId;
    } catch (error) {
        console.error('❌ Erreur envoi notification:', error);
        throw error;
    }
};

/**
 * Envoyer une notification à plusieurs utilisateurs
 */
exports.envoyerNotificationMultiple = async (utilisateurIds, type, titre, contenu, donnees = {}) => {
    const promises = utilisateurIds.map(id =>
        exports.envoyerNotification(id, type, titre, contenu, donnees)
    );

    try {
        await Promise.allSettled(promises);
        console.log(`✅ Notifications envoyées à ${utilisateurIds.length} utilisateurs`);
    } catch (error) {
        console.error('❌ Erreur envoi notifications multiples:', error);
    }
};

/**
 * Sauvegarder le token FCM d'un utilisateur
 */
exports.sauvegarderTokenFCM = async (utilisateurId, token) => {
    await pool.execute(
        'UPDATE utilisateurs SET push_notification = ? WHERE id = ?',
        [token, utilisateurId]
    );
    console.log(`✅ Token FCM sauvegardé pour utilisateur ${utilisateurId}`);
};

/**
 * Récupérer tous les utilisateurs d'une commune
 */
exports.getUtilisateursByCommune = async (commune) => {
    const [rows] = await pool.execute(
        'SELECT id FROM utilisateurs WHERE commune_choisie = ? AND est_actif = TRUE',
        [commune]
    );
    return rows.map(row => row.id);
};
/**
 * --- NOUVELLE FONCTION : Notifier pour une nouvelle promotion ---
 * Cible les utilisateurs selon la commune de la promotion
 */
exports.notifierNouvellePromotion = async (promotionId, titrePromo, ciblageCommune, trancheAge) => {
    try {
        console.log(`📢 Préparation notif: Promo ${promotionId}, Commune: ${ciblageCommune}, Age: ${trancheAge}`);

        // Construction de la requête de ciblage
        let sql = `
            SELECT id, fcm_token 
            FROM utilisateurs 
            WHERE est_actif = TRUE 
            AND push_notification IS NOT NULL
        `;
        
        const params = [];

        // 1. FILTRE COMMUNE
        if (ciblageCommune && ciblageCommune !== 'toutes' && ciblageCommune !== 'toutes_communes') {
            sql += ` AND commune_choisie = ?`;
            params.push(ciblageCommune);
        }

        // 2. FILTRE ÂGE (Calcul dynamique basé sur date_naissance)
        if (trancheAge && trancheAge !== 'tous') {
            if (trancheAge === '12-17') {
                // Entre 12 et 17 ans
                sql += ` AND TIMESTAMPDIFF(YEAR, date_naissance, CURDATE()) BETWEEN 12 AND 17`;
            } else if (trancheAge === '18+') {
                // 18 ans et plus
                sql += ` AND TIMESTAMPDIFF(YEAR, date_naissance, CURDATE()) >= 18`;
            }
        }

        const [users] = await pool.execute(sql, params);
        
        if (users.length === 0) {
            console.log('ℹ️ Aucun utilisateur ne correspond aux critères de ciblage.');
            return;
        }

        const userIds = users.map(u => u.id);
        console.log(`🎯 Cibles trouvées : ${userIds.length} utilisateurs.`);

        // 3. Envoyer la notification
        await exports.envoyerNotificationMultiple(
            userIds,
            'nouvelle_promo',
            'Nouvelle Vidéo Disponible ! 🎥',
            `Une promotion a été créée pour votre commune ! Regardez "${titrePromo}" maintenant.`,
            { 
                promotion_id: promotionId.toString(),
                screen: 'home'
            }
        );

    } catch (error) {
        console.error('❌ Erreur critique notifierNouvellePromotion:', error);
    }
};
/**
 * Récupérer tous les utilisateurs de plusieurs communes
 */
exports.getUtilisateursByCommunes = async (communes) => {
    if (!communes || communes.length === 0) return [];

    const placeholders = communes.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT id FROM utilisateurs 
     WHERE commune_choisie IN (${placeholders}) AND est_actif = TRUE`,
        communes
    );
    return rows.map(row => row.id);
};
