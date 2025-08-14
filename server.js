// pubcash-api/server.js

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const mainRouter = require('./src/routes');

const app = express();
const PORT = process.env.API_PORT || 5000;

// Création des dossiers 'uploads' si ils n'existent pas
const uploadsDir = path.join(__dirname, 'uploads');
const videosDir = path.join(uploadsDir, 'videos');
const thumbsDir = path.join(uploadsDir, 'thumbnails');
const profileDir = path.join(uploadsDir, 'profile');       // <-- NOUVELLE LIGNE
const backgroundDir = path.join(uploadsDir, 'background');
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });       // <-- NOUVELLE LIGNE
if (!fs.existsSync(backgroundDir)) fs.mkdirSync(backgroundDir, { recursive: true }); // <-- NOUVELLE LIGNE
// --- MIDDLEWARES ---
app.use('/uploads/videos', (req, res, next) => {
  if (req.path.endsWith('.mp4')) {
    res.header('Content-Type', 'video/mp4');
    res.header('Accept-Ranges', 'bytes');
  }
  next();
});
// Configuration de CORS pour autoriser les requêtes depuis votre application React
app.use(cors({ origin: 'http://localhost:3000' }));
app.use((req, res, next) => {
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
// Middleware pour parser le JSON dans les corps de requête
app.use(express.json());
app.use('/uploads/thumbnails', express.static(path.join(__dirname, 'uploads', 'thumbnails')));
app.use('/uploads/videos', express.static(path.join(__dirname, 'uploads', 'videos')));
// --- SERVIR LES FICHIERS STATIQUES ---
// Cette ligne rend le contenu du dossier 'uploads' accessible publiquement.
// Par exemple, une image dans `/uploads/thumbnails/image.jpg` sera accessible via `http://localhost:5000/uploads/thumbnails/image.jpg`.
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



// --- ROUTES DE L'API ---
app.use('/api', mainRouter);

// --- DÉMARRAGE DU SERVEUR ---
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});