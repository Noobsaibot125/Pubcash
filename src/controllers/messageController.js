// src/controllers/messageController.js
const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const notificationService = require('../services/notificationService');
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

    const connection = await pool.getConnection(); // On utilise une connexion pour tout faire proprement

    try {
        // 1. Vérifications (Abonnement / Suivi)
        if (senderType === 'client') {
            const [subscription] = await connection.execute(
                `SELECT id FROM abonnements_promoteurs WHERE id_client = ? AND statut = 'actif' AND date_fin > NOW()`,
                [senderId]
            );
            if (subscription.length === 0) {
                connection.release();
                return res.status(403).json({ message: 'Abonnement premium requis.' });
            }
        }

        if (senderType === 'utilisateur' && destinataireType === 'client') {
            const [follow] = await connection.execute(
                'SELECT id FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
                [senderId, destinataireId]
            );
            if (follow.length === 0) {
                connection.release();
                return res.status(403).json({ message: 'Vous devez suivre ce promoteur.' });
            }
        }

        // 2. Préparer les données du message
        let typeContenu = 'texte';
        let urlMedia = null;
        let nomFichier = null;
        let tailleFichier = null;

        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) typeContenu = 'image';
            else if (['.mp4', '.mov', '.avi'].includes(ext)) typeContenu = 'video';
            else typeContenu = 'fichier';

            urlMedia = `/uploads/messages/${req.file.filename}`;
            nomFichier = req.file.originalname;
            tailleFichier = req.file.size;
        }

        // 3. Insérer le message
        const [result] = await connection.execute(
            `INSERT INTO messages 
       (id_expediteur, type_expediteur, id_destinataire, type_destinataire, contenu, type_contenu, url_media, nom_fichier, taille_fichier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [senderId, senderType, destinataireId, destinataireType, contenu || '', typeContenu, urlMedia, nomFichier, tailleFichier]
        );
        // --- AJOUT POUR SOCKET.IO ---
        try {
            // Récupérer l'instance IO depuis l'objet app (express)
            const io = req.app.get('io');

            // Préparer le message pour le socket
            // (J'ai ajouté la date pour que ce soit complet)
            const [msgRow] = await connection.execute('SELECT date_envoi FROM messages WHERE id = ?', [result.insertId]);

            const socketMessage = {
                id: result.insertId,
                id_expediteur: senderId,
                type_expediteur: senderType,
                id_destinataire: parseInt(destinataireId),
                type_destinataire: destinataireType,
                contenu: contenu || '',
                type_contenu: typeContenu,
                url_media: urlMedia,
                date_envoi: msgRow[0].date_envoi,
                lu: 0
            };

            // Envoyer à la room du destinataire
            const roomDestinataire = `${destinataireType}_${destinataireId}`;
            io.to(roomDestinataire).emit('receive_message', socketMessage);
            console.log(`Socket message envoyé à : ${roomDestinataire}`);

        } catch (socketError) {
            console.error("Erreur d'envoi Socket.io:", socketError);
            // On ne bloque pas la réponse HTTP si le socket échoue
        }
        // 4. Notification Push
        if (destinataireType === 'utilisateur') {
            // Vérifier si l'utilisateur suit ce promoteur (si expéditeur = client)
            let shouldNotify = true;
            if (senderType === 'client') {
                const [follow] = await connection.execute(
                    'SELECT id FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
                    [destinataireId, senderId]
                );
                if (follow.length === 0) {
                    shouldNotify = false;
                    console.log(`[DEBUG] Notification bloquée: l'utilisateur ${destinataireId} ne suit pas le promoteur ${senderId}`);
                }
            }

            if (shouldNotify) {
                // On récupère les infos FRAÎCHES de l'expéditeur depuis la BDD
                let senderName = "Un promoteur";
                let senderPhoto = "";

                if (senderType === 'client') {
                    const [clientRows] = await connection.execute(
                        'SELECT nom_utilisateur, nom, profile_image_url FROM clients WHERE id = ?',
                        [senderId]
                    );
                    if (clientRows.length > 0) {
                        senderName = clientRows[0].nom_utilisateur || clientRows[0].nom;
                        senderPhoto = clientRows[0].profile_image_url || "";
                    }
                } else {
                    const [userRows] = await connection.execute(
                        'SELECT nom_utilisateur, nom, photo_profil FROM utilisateurs WHERE id = ?',
                        [senderId]
                    );
                    if (userRows.length > 0) {
                        senderName = userRows[0].nom_utilisateur || userRows[0].nom;
                        senderPhoto = userRows[0].photo_profil || "";
                    }
                }

                console.log(`[DEBUG NOTIF] Envoi de: ${senderName}, Photo: ${senderPhoto}`);

                // Envoi asynchrone
                notificationService.envoyerNotification(
                    destinataireId,
                    'nouveau_message',
                    'Nouveau message',
                    `${senderName} vous a envoyé un message.`,
                    {
                        type: 'nouveau_message',
                        sender_id: senderId,
                        sender_type: senderType,
                        sender_name: senderName,
                        sender_photo: senderPhoto,
                        message_id: result.insertId
                    }
                ).catch(err => console.error("Erreur Push Notif:", err));
            }
        }

        connection.release();

        res.status(201).json({
            message: 'Message envoyé',
            messageId: result.insertId,
            typeContenu,
            urlMedia
        });

    } catch (error) {
        if (connection) connection.release();
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
                // === CORRECTION IMPORTANTE ICI ===
                // La table clients utilise 'profile_image_url'
                const [client] = await pool.execute(
                    'SELECT id, nom_utilisateur, profile_image_url AS photo_profil FROM clients WHERE id = ?',
                    [contactId]
                );
                contactInfo = client[0];
            } else {
                // La table utilisateurs utilise bien 'photo_profil'
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

    // On force la conversion en entier pour éviter les bugs SQL
    const contactId = parseInt(req.params.contactId, 10);
    const contactType = req.params.contactType;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    // Sécurité basique
    if (isNaN(contactId)) {
        return res.status(400).json({ message: "ID contact invalide" });
    }

    try {
        let followDate = null;

        // Si l'utilisateur mobile parle à un client, vérifier le statut de suivi et la date
        if (userType === 'utilisateur' && contactType === 'client') {
            const [followStatus] = await pool.execute(
                'SELECT date_suivi FROM suivis_promoteurs WHERE id_utilisateur = ? AND id_client = ?',
                [userId, contactId]
            );

            if (followStatus.length === 0) {
                // Pas de suivi = pas de messages affichés pour l'utilisateur
                return res.status(200).json([]);
            }

            followDate = followStatus[0].date_suivi;
        }

        let query = `
            SELECT * FROM messages 
            WHERE (
                (id_expediteur = ? AND type_expediteur = ? AND id_destinataire = ? AND type_destinataire = ?)
                OR 
                (id_expediteur = ? AND type_expediteur = ? AND id_destinataire = ? AND type_destinataire = ?)
            )
        `;

        const params = [
            userId, userType, contactId, contactType,  // Cas 1 : J'envoie
            contactId, contactType, userId, userType   // Cas 2 : Je reçois
        ];

        // Filtrer par date de suivi si applicable (uniquement les messages après l'abonnement)
        if (followDate) {
            query += ` AND date_envoi >= ?`;
            params.push(followDate);
        }

        query += ` ORDER BY date_envoi DESC LIMIT ${limit} OFFSET ${offset}`;

        // ASTUCE : J'ai sorti LIMIT et OFFSET du tableau des paramètres '?' et je les ai mis directement dans la string
        // (c'est safe car on a fait parseInt juste avant). Cela résout souvent les problèmes de drivers MySQL récalcitrants.

        const [messages] = await pool.execute(query, params);

        // Marquer les messages reçus comme lus (uniquement ceux qui sont filtrés) ...
        // ... (Update lu code reste similaire mais on filtre par date si besoin ici aussi?)
        // En réalité markAsRead peut rester global, mais getMessages ne renvoie que le autorisé.

        // Marquer les messages reçus comme lus (en tâche de fond, sans await bloquant)
        pool.execute(
            `UPDATE messages SET lu = TRUE 
             WHERE id_expediteur = ? AND type_expediteur = ? 
             AND id_destinataire = ? AND type_destinataire = ? AND lu = FALSE ${followDate ? 'AND date_envoi >= ?' : ''}`,
            followDate ? [contactId, contactType, userId, userType, followDate] : [contactId, contactType, userId, userType]
        ).catch(err => console.error("Erreur update lu:", err));

        res.status(200).json(messages.reverse());

    } catch (error) {
        console.error('Erreur getMessages:', error);
        res.status(500).json({ message: 'Erreur serveur', detail: error.message });
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
