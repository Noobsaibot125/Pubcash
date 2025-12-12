const pool = require('../config/db');

// Créer un nouveau feedback
exports.createFeedback = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur'; // standardise le type
    const { full_name, email, phone, message } = req.body;

    if (!message) {
        return res.status(400).json({ message: 'Le message est requis' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Créer le ticket de feedback
        const [result] = await connection.execute(
            `INSERT INTO feedback (user_id, user_type, full_name, email, phone, message) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, userType, full_name, email, phone, message]
        );

        const feedbackId = result.insertId;

        // 2. Ajouter le message initial dans la table des messages (pour l'historique de conversation)
        // Note: on map 'utilisateur' -> 'user' pour l'enum de la DB si nécessaire, ou on garde 'utilisateur' si l'enum le permet
        // Mon script a créé ENUM('user', 'admin', 'client'). Donc je vais utiliser 'user' pour 'utilisateur'.

        const dbSenderType = userType === 'utilisateur' ? 'user' : userType;

        await connection.execute(
            `INSERT INTO feedback_messages (feedback_id, sender_type, sender_id, message) 
             VALUES (?, ?, ?, ?)`,
            [feedbackId, dbSenderType, userId, message]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Feedback envoyé avec succès',
            feedbackId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Erreur createFeedback:', error);
        res.status(500).json({ message: 'Erreur serveur lors de la création du feedback' });
    } finally {
        connection.release();
    }
};

// Récupérer la liste des feedbacks de l'utilisateur
exports.getMyFeedbacks = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';

    try {
        const [rows] = await pool.execute(
            `SELECT * FROM feedback 
             WHERE user_id = ? AND user_type = ? 
             ORDER BY created_at DESC`,
            [userId, userType]
        );

        res.status(200).json(rows);

    } catch (error) {
        console.error('Erreur getMyFeedbacks:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// --- AJOUT ADMIN ---
// Récupérer TOUS les feedbacks (pour l'admin)
exports.getAllFeedbacks = async (req, res) => {
    // Note: Ajouter middleware admin pour protéger
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM feedback ORDER BY created_at DESC`
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Erreur getAllFeedbacks:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Admin répond au feedback
exports.adminReplyToFeedback = async (req, res) => {
    const adminId = req.user.id; // L'admin doit être loggé
    const feedbackId = req.params.feedbackId;
    const { message } = req.body;

    if (!message) return res.status(400).json({ message: 'Message vide' });

    try {
        // Vérifier que le feedback existe
        const [feedback] = await pool.execute('SELECT id FROM feedback WHERE id = ?', [feedbackId]);
        if (feedback.length === 0) return res.status(404).json({ message: "Feedback introuvable" });

        // On insert avec sender_type = 'admin'
        await pool.execute(
            `INSERT INTO feedback_messages (feedback_id, sender_type, sender_id, message) 
             VALUES (?, 'admin', ?, ?)`,
            [feedbackId, adminId, message]
        );

        // Optionnel: Mettre à jour le statut du ticket si besoin
        // await pool.execute("UPDATE feedback SET status = 'replied' WHERE id = ?", [feedbackId]);

        res.status(201).json({ message: 'Réponse envoyée par admin' });

    } catch (error) {
        console.error('Erreur adminReplyToFeedback:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
// -------------------

// Récupérer les messages d'un feedback spécifique
exports.getFeedbackMessages = async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role; // 'admin', 'client', 'utilisateur'
    const feedbackId = req.params.feedbackId;

    try {
        const [feedback] = await pool.execute(
            'SELECT user_id, user_type FROM feedback WHERE id = ?',
            [feedbackId]
        );

        if (feedback.length === 0) {
            return res.status(404).json({ message: 'Feedback introuvable' });
        }

        // Autorisation : Soit c'est mon feedback, soit je suis admin
        let authorized = false;
        if (userRole === 'admin' || userRole === 'administrateur') {
            authorized = true;
        } else {
            if (feedback[0].user_id === userId) authorized = true;
        }

        if (!authorized) {
            return res.status(403).json({ message: 'Accès non autorisé' });
        }

        const [messages] = await pool.execute(
            `SELECT * FROM feedback_messages 
             WHERE feedback_id = ? 
             ORDER BY created_at ASC`,
            [feedbackId]
        );

        res.status(200).json(messages);

    } catch (error) {
        console.error('Erreur getFeedbackMessages:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Ajouter une réponse (message) à un feedback (Pour utilisateur normal)
exports.replyToFeedback = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';
    const feedbackId = req.params.feedbackId;
    const { message } = req.body;

    if (!message) return res.status(400).json({ message: 'Message vide' });

    try {
        // Vérif ownership
        const [feedback] = await pool.execute(
            'SELECT user_id FROM feedback WHERE id = ?',
            [feedbackId]
        );
        if (feedback.length === 0 || feedback[0].user_id !== userId) {
            return res.status(403).json({ message: 'Accès non autorisé' });
        }

        const dbSenderType = userType === 'utilisateur' ? 'user' : userType;

        await pool.execute(
            `INSERT INTO feedback_messages (feedback_id, sender_type, sender_id, message) 
             VALUES (?, ?, ?, ?)`,
            [feedbackId, dbSenderType, userId, message]
        );

        res.status(201).json({ message: 'Réponse envoyée' });

    } catch (error) {
        console.error('Erreur replyToFeedback:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
