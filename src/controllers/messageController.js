// src/controllers/messageController.js
const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Configuration multer pour upload de fichiers
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/messages');
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
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Type de fichier non autorisé'));
    }
});

exports.uploadMiddleware = upload.single('media');

// Envoyer un message
exports.sendMessage = async (req, res) => {
    const senderId = req.user.id;
    const senderType = req.user.role === 'client' ? 'client' : 'utilisateur';
    const { destinataireId, destinataireType, contenu } = req.body;

    if (!destinataireId || !destinataireType) {
        return res.status(400).json({ message: 'Destinataire requis' });
    }

    // Vérifier que le contenu ou un fichier est fourni
    if (!contenu && !req.file) {
        return res.status(400).json({ message: 'Contenu ou fichier requis' });
    }

    try {
        // Si c'est un client qui envoie, vérifier son abonnement
        if (senderType === 'client') {
            const [subscription] = await pool.execute(
                `SELECT id FROM abonnements_promoteurs 
         WHERE id_client = ? AND statut = 'actif' AND date_fin > NOW()`,
                [senderId]
            );
            if (subscription.length === 0) {
                return res.status(403).json({ message: 'Abonnement premium requis pour envoyer des messages' });
            }
        }

        // Si c'est un utilisateur qui envoie, vérifier qu'il suit le promoteur
        if (senderType === 'utilisateur' && destinataireType === 'client') {
            const [follow] = await pool.execute(
                'SELECT id FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
                [senderId, destinataireId]
            );
            if (follow.length === 0) {
                return res.status(403).json({ message: 'Vous devez suivre ce promoteur pour lui envoyer un message' });
            }
        }

        // Préparer les données du message
        let typeContenu = 'texte';
        let urlMedia = null;
        let nomFichier = null;
        let tailleFichier = null;

        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
                typeContenu = 'image';
            } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
                typeContenu = 'video';
            } else {
                typeContenu = 'fichier';
            }
            urlMedia = `/uploads/messages/${req.file.filename}`;
            nomFichier = req.file.originalname;
            tailleFichier = req.file.size;
        }

        // Insérer le message
        const [result] = await pool.execute(
            `INSERT INTO messages 
       (id_expediteur, type_expediteur, id_destinataire, type_destinataire, contenu, type_contenu, url_media, nom_fichier, taille_fichier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [senderId, senderType, destinataireId, destinataireType, contenu || '', typeContenu, urlMedia, nomFichier, tailleFichier]
        );

        // TODO: Envoyer notification push au destinataire

        res.status(201).json({
            message: 'Message envoyé',
            messageId: result.insertId,
            typeContenu,
            urlMedia
        });

    } catch (error) {
        console.error('Erreur sendMessage:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Récupérer les conversations (liste des contacts)
exports.getConversations = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';

    try {
        // Requête complexe pour obtenir les derniers messages de chaque conversation
        const [conversations] = await pool.execute(
            `SELECT 
        m.*,
        CASE 
          WHEN m.type_expediteur = ? AND m.id_expediteur = ? THEN m.id_destinataire
          ELSE m.id_expediteur
        END as contact_id,
        CASE 
          WHEN m.type_expediteur = ? AND m.id_expediteur = ? THEN m.type_destinataire
          ELSE m.type_expediteur
        END as contact_type
       FROM messages m
       WHERE (m.id_expediteur = ? AND m.type_expediteur = ?)
          OR (m.id_destinataire = ? AND m.type_destinataire = ?)
       ORDER BY m.date_envoi DESC`,
            [userType, userId, userType, userId, userId, userType, userId, userType]
        );

        // Grouper par contact et garder le dernier message
        const conversationsMap = new Map();
        for (const msg of conversations) {
            const key = `${msg.contact_type}_${msg.contact_id}`;
            if (!conversationsMap.has(key)) {
                conversationsMap.set(key, msg);
            }
        }

        // Enrichir avec les infos du contact
        const enrichedConversations = [];
        for (const [key, msg] of conversationsMap) {
            const [contactType, contactId] = key.split('_');
            let contactInfo = null;

            if (contactType === 'client') {
                const [client] = await pool.execute(
                    'SELECT id, nom_utilisateur, photo_profil FROM clients WHERE id = ?',
                    [contactId]
                );
                contactInfo = client[0];
            } else {
                const [user] = await pool.execute(
                    'SELECT id, nom_utilisateur, photo_profil FROM utilisateurs WHERE id = ?',
                    [contactId]
                );
                contactInfo = user[0];
            }

            // Compter messages non lus
            const [unread] = await pool.execute(
                `SELECT COUNT(*) as count FROM messages 
         WHERE id_expediteur = ? AND type_expediteur = ? 
         AND id_destinataire = ? AND type_destinataire = ? AND lu = FALSE`,
                [contactId, contactType, userId, userType]
            );

            enrichedConversations.push({
                contactId: parseInt(contactId),
                contactType,
                contactName: contactInfo?.nom_utilisateur || 'Inconnu',
                contactPhoto: contactInfo?.photo_profil,
                lastMessage: msg.contenu,
                lastMessageType: msg.type_contenu,
                lastMessageDate: msg.date_envoi,
                unreadCount: unread[0].count
            });
        }

        res.status(200).json(enrichedConversations);

    } catch (error) {
        console.error('Erreur getConversations:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Récupérer les messages d'une conversation
exports.getMessages = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';
    const { contactId, contactType } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    try {
        const [messages] = await pool.execute(
            `SELECT * FROM messages 
       WHERE ((id_expediteur = ? AND type_expediteur = ? AND id_destinataire = ? AND type_destinataire = ?)
          OR (id_expediteur = ? AND type_expediteur = ? AND id_destinataire = ? AND type_destinataire = ?))
       ORDER BY date_envoi DESC
       LIMIT ? OFFSET ?`,
            [userId, userType, contactId, contactType, contactId, contactType, userId, userType, limit, offset]
        );

        // Marquer les messages reçus comme lus
        await pool.execute(
            `UPDATE messages SET lu = TRUE 
       WHERE id_expediteur = ? AND type_expediteur = ? 
       AND id_destinataire = ? AND type_destinataire = ? AND lu = FALSE`,
            [contactId, contactType, userId, userType]
        );

        res.status(200).json(messages.reverse()); // Inverser pour ordre chronologique

    } catch (error) {
        console.error('Erreur getMessages:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Compter les messages non lus
exports.getUnreadCount = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';

    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM messages 
       WHERE id_destinataire = ? AND type_destinataire = ? AND lu = FALSE`,
            [userId, userType]
        );

        res.status(200).json({ unreadCount: rows[0].count });

    } catch (error) {
        console.error('Erreur getUnreadCount:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Marquer tous les messages d'une conversation comme lus
exports.markAsRead = async (req, res) => {
    const userId = req.user.id;
    const userType = req.user.role === 'client' ? 'client' : 'utilisateur';
    const { contactId, contactType } = req.params;

    try {
        await pool.execute(
            `UPDATE messages SET lu = TRUE 
       WHERE id_expediteur = ? AND type_expediteur = ? 
       AND id_destinataire = ? AND type_destinataire = ?`,
            [contactId, contactType, userId, userType]
        );

        res.status(200).json({ message: 'Messages marqués comme lus' });

    } catch (error) {
        console.error('Erreur markAsRead:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

module.exports = exports;
