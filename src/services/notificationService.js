const admin = require('firebase-admin');
const pool = require('../config/db');
const notificationModel = require('../models/notificationModel');

// Initialiser Firebase Admin SDK
let firebaseInitialized = false;

const initializeFirebase = () => {
    if (firebaseInitialized) return;

    try {
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
                // Logo PubCash
                image: 'https://pub-cash.com/uploads/landing/pub_cash.png'
            },
            data: {
                ...donnees,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    // 👇 MODIFICATION 1 : Mettre v3 comme dans l'appli Flutter
                    channelId: 'pubcash_notifications_v3',

                    // 👇 MODIFICATION 2 : Ajouter la couleur Orange
                    color: '#FF8C42',
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

        // Convertir les données en strings (Requis par FCM)
        Object.keys(message.data).forEach(key => {
            if (typeof message.data[key] !== 'string') {
                message.data[key] = JSON.stringify(message.data[key]);
            }
        });

        await admin.messaging().send(message);
        console.log(`✅ Notification push envoyée.`);
        return true;
    } catch (error) {
        console.error('❌ Erreur envoi notification push:', error.message);
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
            console.log(`ℹ️ Pas de token FCM pour l'utilisateur ${utilisateurId} (Colonne push_notification vide)`);
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
        console.log(`✅ Batch terminé : ${utilisateurIds.length} utilisateurs traités.`);
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
    console.log(`✅ Token FCM sauvegardé (DB: push_notification) pour user ${utilisateurId}`);
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
 * Notifier pour une nouvelle promotion (Ciblage)
 */
exports.notifierNouvellePromotion = async (promotionId, titrePromo, ciblageCommune, trancheAge) => {
    try {
        console.log(`📢 Préparation notif: Promo ${promotionId}, Commune: ${ciblageCommune}, Age: ${trancheAge}`);

        // On sélectionne push_notification
        let sql = `
            SELECT id, push_notification 
            FROM utilisateurs 
            WHERE est_actif = TRUE 
            AND push_notification IS NOT NULL
            AND push_notification != ''
        `;

        const params = [];

        // 1. FILTRE COMMUNE (CORRIGÉ AVEC LOWER)
        if (ciblageCommune && ciblageCommune !== 'toutes' && ciblageCommune !== 'toutes_communes') {
            // On force la comparaison en minuscule des deux côtés pour éviter les erreurs "Abobo" vs "abobo"
            sql += ` AND LOWER(commune_choisie) = LOWER(?)`;
            params.push(ciblageCommune);
        }

        // 2. FILTRE ÂGE
        if (trancheAge && trancheAge !== 'tous') {
            if (trancheAge === '12-17') {
                sql += ` AND TIMESTAMPDIFF(YEAR, date_naissance, CURDATE()) BETWEEN 12 AND 17`;
            } else if (trancheAge === '18+') {
                sql += ` AND TIMESTAMPDIFF(YEAR, date_naissance, CURDATE()) >= 18`;
            }
        }

        const [users] = await pool.execute(sql, params);

        if (users.length === 0) {
            console.log(`ℹ️ Aucun utilisateur trouvé pour ${ciblageCommune} (ou pas de token).`);
            return;
        }

        const userIds = users.map(u => u.id);
        console.log(`🎯 Cibles trouvées : ${userIds.length} utilisateurs à ${ciblageCommune}.`);

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
 * Récupérer des utilisateurs aléatoires
 */
exports.getRandomUsers = async (count) => {
    try {
        // CORRECTION: LIMIT ? pose problème avec certains binding MySQL/Node.
        // On sécurise en forçant un entier et en l'injectant directement.
        const safeCount = parseInt(count) || 10;

        const [rows] = await pool.execute(
            `SELECT id FROM utilisateurs WHERE est_actif = TRUE ORDER BY RAND() LIMIT ${safeCount}`
        );
        return rows.map(row => row.id);
    } catch (error) {
        console.error('❌ Erreur getRandomUsers:', error);
        return [];
    }
};