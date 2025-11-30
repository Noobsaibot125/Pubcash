const pool = require('../config/db');

/**
 * Modèle pour la gestion des notifications
 */

/**
 * Créer une nouvelle notification
 */
exports.createNotification = async (utilisateurId, type, titre, contenu, donnees = null) => {
    // On s'assure d'utiliser id_utilisateur ou utilisateur_id selon ta BDD. 
    // Par sécurité, vérifie le nom de ta colonne dans phpMyAdmin.
    // Ici j'utilise 'id_utilisateur' qui est le standard de ton projet.
    
    // Si ta colonne s'appelle 'utilisateur_id', change juste le nom dans la requête ci-dessous.
    const [result] = await pool.execute(
        `INSERT INTO notifications (id_utilisateur, type, titre, contenu, donnees, date_creation, lu) 
         VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
        [utilisateurId, type, titre, contenu, donnees ? JSON.stringify(donnees) : null]
    );
    return result.insertId;
};

/**
 * Récupérer les notifications d'un utilisateur avec pagination
 */
exports.getUserNotifications = async (utilisateurId, limit = 20, offset = 0) => {
    const limitInt = parseInt(limit, 10);
    const offsetInt = parseInt(offset, 10);

    // ATTENTION : J'ai changé 'utilisateur_id' en 'id_utilisateur' pour correspondre au reste de ton projet.
    // Si ta base utilise vraiment 'utilisateur_id', remets-le.
    const [rows] = await pool.execute(
        `SELECT id, type, titre, contenu, donnees, lu, date_creation
         FROM notifications
         WHERE id_utilisateur = ?
         ORDER BY date_creation DESC
         LIMIT ${limitInt} OFFSET ${offsetInt}`, // Injection directe des entiers pour éviter les bugs de driver MySQL avec LIMIT
        [utilisateurId]
    );

    // --- CORRECTION CRUCIALE DU PARSING JSON ---
    // Cette partie empêche le crash si 'donnees' est déjà un objet
    return rows.map(row => {
        let parsedDonnees = null;
        if (row.donnees) {
            if (typeof row.donnees === 'object') {
                // C'est déjà un objet (le driver l'a parsé), on ne touche pas
                parsedDonnees = row.donnees;
            } else if (typeof row.donnees === 'string') {
                // C'est une string, on parse
                try {
                    parsedDonnees = JSON.parse(row.donnees);
                } catch (e) {
                    console.error("Erreur parsing JSON notification:", e);
                }
            }
        }

        return {
            ...row,
            donnees: parsedDonnees
        };
    });
};

/**
 * Marquer une notification comme lue
 */
exports.markAsRead = async (notificationId, utilisateurId) => {
    await pool.execute(
        `UPDATE notifications 
         SET lu = 1 
         WHERE id = ? AND id_utilisateur = ?`,
        [notificationId, utilisateurId]
    );
};

/**
 * Marquer toutes les notifications comme lues
 */
exports.markAllAsRead = async (utilisateurId) => {
    await pool.execute(
        `UPDATE notifications 
         SET lu = 1 
         WHERE id_utilisateur = ? AND lu = 0`,
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
         WHERE id_utilisateur = ? AND lu = 0`,
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
         WHERE id = ? AND id_utilisateur = ?`,
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