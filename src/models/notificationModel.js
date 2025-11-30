const pool = require('../config/db');

/**
 * Modèle pour la gestion des notifications
 */

/**
 * Créer une nouvelle notification
 */
exports.createNotification = async (utilisateurId, type, titre, contenu, donnees = null) => {
    const [result] = await pool.execute(
        `INSERT INTO notifications (utilisateur_id, type, titre, contenu, donnees) 
     VALUES (?, ?, ?, ?, ?)`,
        [utilisateurId, type, titre, contenu, donnees ? JSON.stringify(donnees) : null]
    );
    return result.insertId;
};

/**
 * Récupérer les notifications d'un utilisateur avec pagination
 */
exports.getUserNotifications = async (utilisateurId, limit = 20, offset = 0) => {
    // Forcer la conversion en entiers pour éviter l'erreur MySQL
    const limitInt = parseInt(limit, 10);
    const offsetInt = parseInt(offset, 10);

    const [rows] = await pool.execute(
        `SELECT id, type, titre, contenu, donnees, lu, date_creation
     FROM notifications
     WHERE utilisateur_id = ?
     ORDER BY date_creation DESC
     LIMIT ? OFFSET ?`,
        [utilisateurId, limitInt, offsetInt]
    );

    // Parser les données JSON
    return rows.map(row => ({
        ...row,
        donnees: row.donnees ? JSON.parse(row.donnees) : null
    }));
};

/**
 * Marquer une notification comme lue
 */
exports.markAsRead = async (notificationId, utilisateurId) => {
    await pool.execute(
        `UPDATE notifications 
     SET lu = TRUE 
     WHERE id = ? AND utilisateur_id = ?`,
        [notificationId, utilisateurId]
    );
};

/**
 * Marquer toutes les notifications comme lues
 */
exports.markAllAsRead = async (utilisateurId) => {
    await pool.execute(
        `UPDATE notifications 
     SET lu = TRUE 
     WHERE utilisateur_id = ? AND lu = FALSE`,
        [utilisateurId]
    );
};

/**
 * Obtenir le nombre de notifications non lues
 */
exports.getUnreadCount = async (utilisateurId) => {
    const [rows] = await pool.execute(
        `SELECT COUNT(*) as count 
     FROM notifications 
     WHERE utilisateur_id = ? AND lu = FALSE`,
        [utilisateurId]
    );
    return rows[0].count;
};

/**
 * Supprimer une notification
 */
exports.deleteNotification = async (notificationId, utilisateurId) => {
    await pool.execute(
        `DELETE FROM notifications 
     WHERE id = ? AND utilisateur_id = ?`,
        [notificationId, utilisateurId]
    );
};

/**
 * Supprimer les anciennes notifications (plus de 30 jours)
 */
exports.deleteOldNotifications = async () => {
    await pool.execute(
        `DELETE FROM notifications 
     WHERE date_creation < DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
};
