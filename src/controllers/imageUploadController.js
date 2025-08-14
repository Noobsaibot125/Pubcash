// pubcash-api/src/controllers/imageUploadController.js
const multer = require('multer');
const path = require('path');

// Configuration générique pour le stockage
const storage = (folder) => multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'uploads', folder)),
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        cb(null, `${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const uploadProfile = multer({ storage: storage('profile') }).single('profileImage');
const uploadBackground = multer({ storage: storage('background') }).single('backgroundImage');

// Middleware pour mettre à jour l'URL de l'image dans la BDD
const updateImageUrlInDb = (field, folder) => (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' });

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${folder}/${req.file.filename}`;
    const clientId = req.user.id;
    const pool = require('../config/db');

    pool.execute(`UPDATE clients SET ${field} = ? WHERE id = ?`, [imageUrl, clientId])
        .then(() => res.status(200).json({ message: 'Image mise à jour avec succès.', url: imageUrl }))
        .catch(err => {
            console.error(`Erreur DB lors de l'update de l'image ${field}:`, err);
            res.status(500).json({ message: 'Erreur serveur.' });
        });
};

// On exporte les middlewares complets
exports.uploadProfileImage = [uploadProfile, updateImageUrlInDb('profile_image_url', 'profile')];
exports.uploadBackgroundImage = [uploadBackground, updateImageUrlInDb('background_image_url', 'background')];