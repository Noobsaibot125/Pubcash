const notificationModel = require('../models/notificationModel');
const notificationService = require('../services/notificationService');

/**
 * Récupérer les notifications de l'utilisateur connecté
 */
exports.getNotifications = async (req, res) => {
    try {
        const utilisateurId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const notifications = await notificationModel.getUserNotifications(
            utilisateurId,
            limit,
            offset
        );

        const unreadCount = await notificationModel.getUnreadCount(utilisateurId);

        res.json({
            success: true,
            notifications,
            unreadCount,
            page,
            limit,
            hasMore: notifications.length === limit,
        });
    } catch (error) {
        console.error('Erreur récupération notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des notifications',
        });
    }
};

/**
 * Marquer une notification comme lue
 */
exports.marquerCommeLue = async (req, res) => {
    try {
        const { id } = req.params;
        const utilisateurId = req.user.id;

        await notificationModel.markAsRead(id, utilisateurId);

        res.json({
            success: true,
            message: 'Notification marquée comme lue',
        });
    } catch (error) {
        console.error('Erreur marquage notification:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du marquage de la notification',
        });
    }
};

/**
 * Marquer toutes les notifications comme lues
 */
exports.marquerToutesCommeLues = async (req, res) => {
    try {
        const utilisateurId = req.user.id;

        await notificationModel.markAllAsRead(utilisateurId);

        res.json({
            success: true,
            message: 'Toutes les notifications ont été marquées comme lues',
        });
    } catch (error) {
        console.error('Erreur marquage toutes notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du marquage des notifications',
        });
    }
};

/**
 * Obtenir le nombre de notifications non lues
 */
exports.getNombreNonLues = async (req, res) => {
    try {
        const utilisateurId = req.user.id;
        const count = await notificationModel.getUnreadCount(utilisateurId);

        res.json({
            success: true,
            count,
        });
    } catch (error) {
        console.error('Erreur comptage notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du comptage des notifications',
        });
    }
};

/**
 * Supprimer une notification
 */
exports.supprimerNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const utilisateurId = req.user.id;

        await notificationModel.deleteNotification(id, utilisateurId);

        res.json({
            success: true,
            message: 'Notification supprimée',
        });
    } catch (error) {
        console.error('Erreur suppression notification:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression de la notification',
        });
    }
};

/**
 * Sauvegarder le token FCM de l'utilisateur
 */
exports.sauvegarderToken = async (req, res) => {
    // 1. On logue que la requête est arrivée
    console.log("📡 [BACKEND] Reçu requête POST /notifications/token");
    console.log("👤 [BACKEND] Utilisateur ID:", req.user ? req.user.id : 'Non identifié');
    console.log("📦 [BACKEND] Body:", req.body);

    try {
        const utilisateurId = req.user.id;
        const { token } = req.body;

        if (!token) {
            console.log("⚠️ [BACKEND] Token manquant dans le body !");
            return res.status(400).json({ success: false, message: 'Le token FCM est requis' });
        }

        // Appel au service
        await notificationService.sauvegarderTokenFCM(utilisateurId, token);
        
        console.log(`✅ [BACKEND] Token sauvegardé avec succès pour User ${utilisateurId}`);

        res.json({ success: true, message: 'Token FCM sauvegardé' });
    } catch (error) {
        console.error('❌ [BACKEND] Erreur sauvegarde token:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};
/**
 * Endpoint de test pour envoyer une notification manuellement (DEV ONLY)
 */
exports.testNotification = async (req, res) => {
    try {
        const utilisateurId = req.user.id;
        const { type, titre, contenu, donnees } = req.body;

        await notificationService.envoyerNotification(
            utilisateurId,
            type || 'video_regardee',
            titre || 'Notification de test',
            contenu || 'Ceci est une notification de test',
            donnees || {}
        );

        res.json({
            success: true,
            message: 'Notification de test envoyée',
        });
    } catch (error) {
        console.error('Erreur test notification:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'envoi de la notification de test',
        });
    }
};

/**
 * Supprimer TOUTES les notifications de l'utilisateur
 */
exports.supprimerToutesNotifications = async (req, res) => {
    try {
        const utilisateurId = req.user.id;

        // Appel au modèle (que nous allons créer juste après)
        await notificationModel.deleteAllNotifications(utilisateurId);

        res.json({
            success: true,
            message: 'Toutes les notifications ont été supprimées',
        });
    } catch (error) {
        console.error('Erreur suppression totale notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression totale',
        });
    }
};