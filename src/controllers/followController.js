// src/controllers/followController.js
const pool = require('../config/db');

// Suivre un promoteur
exports.followPromoter = async (req, res) => {
    const userId = req.user.id;
    const { clientId } = req.params;

    try {
        // Vérifier si le client existe
        const [client] = await pool.execute('SELECT id FROM clients WHERE id = ?', [clientId]);
        if (client.length === 0) {
            return res.status(404).json({ message: 'Promoteur non trouvé' });
        }

        // Vérifier si déjà suivi
        const [existing] = await pool.execute(
            'SELECT id FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
            [userId, clientId]
        );

        if (existing.length > 0) {
            return res.status(200).json({ message: 'Vous suivez déjà ce promoteur', isFollowing: true });
        }

        // Créer le suivi
        await pool.execute(
            'INSERT INTO suivis_promoteurs (id_utilisateur, id_client) VALUES (?, ?)',
            [userId, clientId]
        );

        // NETTOYAGE: Supprimer les messages non lus (spam) reçus pendant la période de non-suivi
        try {
            await pool.execute(
                `DELETE FROM messages 
                 WHERE id_expediteur = ? AND type_expediteur = 'client' 
                 AND id_destinataire = ? AND type_destinataire = 'utilisateur' 
                 AND lu = FALSE`,
                [clientId, userId]
            );
        } catch (cleanupError) {
            console.error("Erreur nettoyage messages:", cleanupError);
        }

        res.status(201).json({ message: 'Vous suivez maintenant ce promoteur', isFollowing: true });

    } catch (error) {
        console.error('Erreur followPromoter:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Se désabonner d'un promoteur
exports.unfollowPromoter = async (req, res) => {
    const userId = req.user.id;
    const { clientId } = req.params;

    try {
        await pool.execute(
            'DELETE FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
            [userId, clientId]
        );

        res.status(200).json({ message: 'Vous ne suivez plus ce promoteur', isFollowing: false });

    } catch (error) {
        console.error('Erreur unfollowPromoter:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Vérifier si l'utilisateur suit un promoteur
exports.isFollowing = async (req, res) => {
    const userId = req.user.id;
    const { clientId } = req.params;

    try {
        const [rows] = await pool.execute(
            'SELECT id FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
            [userId, clientId]
        );

        res.status(200).json({ isFollowing: rows.length > 0 });

    } catch (error) {
        console.error('Erreur isFollowing:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

exports.getFollowing = async (req, res) => {
    const userId = req.user.id;

    try {
        // CORRECTION ICI : c.profile_image_url AS photo_profil
        const [following] = await pool.execute(
            `SELECT c.id, c.nom_utilisateur, c.profile_image_url AS photo_profil, s.date_suivi
             FROM suivis_promoteurs s
             JOIN clients c ON s.id_client = c.id
             WHERE s.id_utilisateur = ?
             ORDER BY s.date_suivi DESC`,
            [userId]
        );

        res.status(200).json(following);

    } catch (error) {
        console.error('Erreur getFollowing:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Récupérer la liste des followers (POUR LE WEB PROMOTEUR)
exports.getFollowers = async (req, res) => {
    const clientId = req.user.id;

    try {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        // CORRECTION ICI AUSSI : profile_image_url
        const [followers] = await pool.execute(
            `SELECT 
                u.id, 
                u.nom_utilisateur, 
                u.photo_profil, 
                s.date_suivi
             FROM suivis_promoteurs s
             JOIN utilisateurs u ON s.id_utilisateur = u.id
             WHERE s.id_client = ?
             ORDER BY s.date_suivi DESC`,
            [clientId]
        );

        // Note: Pour les utilisateurs, la table s'appelle bien 'photo_profil' ou 'profile_image_url' ?
        // Vérifie ta table utilisateurs. Si c'est 'profile_image_url' aussi, change la requête ci-dessus.

        // Formatage URL
        const formattedFollowers = followers.map(item => ({
            ...item,
            photo_profil: item.photo_profil && !item.photo_profil.startsWith('http')
                ? `${baseUrl}/uploads/profile/${item.photo_profil}`
                : item.photo_profil
        }));

        res.status(200).json(formattedFollowers);

    } catch (error) {
        console.error('Erreur getFollowers:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
// Compter les followers d'un promoteur
exports.getFollowersCount = async (req, res) => {
    const { clientId } = req.params;

    try {
        const [rows] = await pool.execute(
            'SELECT COUNT(*) as count FROM suivis_promoteurs WHERE id_client = ?',
            [clientId]
        );

        res.status(200).json({ count: rows[0].count });

    } catch (error) {
        console.error('Erreur getFollowersCount:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

module.exports = exports;
