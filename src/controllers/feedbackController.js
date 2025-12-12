const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Configuration multer pour upload de fichiers feedback
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/feedback');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) ||
            file.mimetype.includes('image') ||
            file.mimetype.includes('pdf') ||
            file.mimetype.includes('document') ||
            file.mimetype.includes('sheet');
        if (mimetype || extname) {
            return cb(null, true);
        }
        cb(new Error('Type de fichier non autorisé'));
    }
});

exports.uploadMiddleware = upload.single('file');

// Créer un nouveau feedback (avec fichier optionnel)
exports.createFeedback = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';
    const { full_name, email, phone, message } = req.body;

    if (!message) {
        return res.status(400).json({ message: 'Le message est requis' });
    }

    // Gestion du fichier uploadé
    let fileUrl = null;
    let fileName = null;
    let fileType = null;

    if (req.file) {
        fileUrl = `/uploads/feedback/${req.file.filename}`;
        fileName = req.file.originalname;
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) fileType = 'image';
        else if (['.pdf'].includes(ext)) fileType = 'pdf';
        else fileType = 'document';
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
        const dbSenderType = userType === 'utilisateur' ? 'user' : userType;

        // 2. Ajouter le message initial avec fichier si présent
        await connection.execute(
            `INSERT INTO feedback_messages (feedback_id, sender_type, sender_id, message, file_url, file_name, file_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [feedbackId, dbSenderType, userId, message, fileUrl, fileName, fileType]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Feedback envoyé avec succès',
            feedbackId,
            fileUrl
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

// Récupérer TOUS les feedbacks (pour l'admin)
exports.getAllFeedbacks = async (req, res) => {
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

// Admin répond au feedback (avec fichier optionnel)
exports.adminReplyToFeedback = async (req, res) => {
    const adminId = req.user.id;
    const feedbackId = req.params.feedbackId;
    const { message } = req.body;

    if (!message && !req.file) return res.status(400).json({ message: 'Message ou fichier requis' });

    // Gestion fichier
    let fileUrl = null;
    let fileName = null;
    let fileType = null;

    if (req.file) {
        fileUrl = `/uploads/feedback/${req.file.filename}`;
        fileName = req.file.originalname;
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) fileType = 'image';
        else if (['.pdf'].includes(ext)) fileType = 'pdf';
        else fileType = 'document';
    }

    try {
        const [feedback] = await pool.execute('SELECT id FROM feedback WHERE id = ?', [feedbackId]);
        if (feedback.length === 0) return res.status(404).json({ message: "Feedback introuvable" });

        await pool.execute(
            `INSERT INTO feedback_messages (feedback_id, sender_type, sender_id, message, file_url, file_name, file_type) 
             VALUES (?, 'admin', ?, ?, ?, ?, ?)`,
            [feedbackId, adminId, message || '', fileUrl, fileName, fileType]
        );

        res.status(201).json({ message: 'Réponse envoyée par admin', fileUrl });

    } catch (error) {
        console.error('Erreur adminReplyToFeedback:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Récupérer les messages d'un feedback spécifique
exports.getFeedbackMessages = async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const feedbackId = req.params.feedbackId;

    try {
        const [feedback] = await pool.execute(
            'SELECT user_id, user_type FROM feedback WHERE id = ?',
            [feedbackId]
        );

        if (feedback.length === 0) {
            return res.status(404).json({ message: 'Feedback introuvable' });
        }

        let authorized = false;
        if (userRole === 'admin' || userRole === 'administrateur' || userRole === 'superadmin') {
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

// Ajouter une réponse à un feedback (utilisateur/client avec fichier optionnel)
exports.replyToFeedback = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';
    const feedbackId = req.params.feedbackId;
    const { message } = req.body;

    if (!message && !req.file) return res.status(400).json({ message: 'Message ou fichier requis' });

    // Gestion fichier
    let fileUrl = null;
    let fileName = null;
    let fileType = null;

    if (req.file) {
        fileUrl = `/uploads/feedback/${req.file.filename}`;
        fileName = req.file.originalname;
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) fileType = 'image';
        else if (['.pdf'].includes(ext)) fileType = 'pdf';
        else fileType = 'document';
    }

    try {
        const [feedback] = await pool.execute(
            'SELECT user_id FROM feedback WHERE id = ?',
            [feedbackId]
        );
        if (feedback.length === 0 || feedback[0].user_id !== userId) {
            return res.status(403).json({ message: 'Accès non autorisé' });
        }

        const dbSenderType = userType === 'utilisateur' ? 'user' : userType;

        await pool.execute(
            `INSERT INTO feedback_messages (feedback_id, sender_type, sender_id, message, file_url, file_name, file_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [feedbackId, dbSenderType, userId, message || '', fileUrl, fileName, fileType]
        );

        res.status(201).json({ message: 'Réponse envoyée', fileUrl });

    } catch (error) {
        console.error('Erreur replyToFeedback:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};
