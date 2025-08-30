require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");

// --- Imports de l'application ---
const mainRouter = require('./src/routes');
const clientController = require('./src/controllers/clientController');
const pool = require('./src/config/db');

// --- Initialisation d'Express et du serveur HTTP ---
const app = express();
const server = http.createServer(app);

// --- Configuration de Socket.IO ---
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Rend 'io' accessible dans toute l'application via req.app.get('io')
app.set('io', io);

// --- Création des dossiers 'uploads' ---
const uploadsDir = path.join(__dirname, 'uploads');
const requiredDirs = ['videos', 'thumbnails', 'profile', 'background', 'landing'];

requiredDirs.forEach(dir => {
  const fullPath = path.join(uploadsDir, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// --- MIDDLEWARES ---
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SERVIR LES FICHIERS STATIQUES ---
app.use('/uploads', (req, res, next) => {
  if (req.path.endsWith('.mp4')) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
  } else if (req.path.endsWith('.webm')) {
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Accept-Ranges', 'bytes');
  }
  next();
});
app.use('/uploads', express.static(uploadsDir));

// --- WEBHOOK PUBLIC CinetPay ---
app.post('/webhook/cinetpay', clientController.cinetpayNotify);

// --- ROUTES PRINCIPALES DE L'API ---
app.use('/api', mainRouter);

// ======================================================
// --- GESTION DES CONNEXIONS WEBSOCKET ---
// ======================================================

// Variable en mémoire pour stocker les utilisateurs connectés
let onlineUsers = {};

// Fonction pour récupérer les utilisateurs en ligne depuis la base de données
async function getOnlineUsers() {
  try {
    const [rows] = await pool.execute(
      `SELECT id, nom_utilisateur, email, photo_profil, derniere_connexion, est_en_ligne
       FROM utilisateurs
       WHERE est_en_ligne = 1
       ORDER BY derniere_connexion DESC`
    );

    // Normaliser est_en_ligne en boolean pour le front
    return rows.map(r => ({
      id: r.id,
      nom_utilisateur: r.nom_utilisateur,
      email: r.email,
      photo_profil: r.photo_profil,
      derniere_connexion: r.derniere_connexion,
      est_en_ligne: !!r.est_en_ligne
    }));
  } catch (error) {
    console.error("Erreur lors de la récupération des utilisateurs en ligne:", error);
    return [];
  }
}

io.on('connection', (socket) => {
  console.log('Nouvelle connexion WebSocket:', socket.id);

  // --- Logique pour les notifications ciblées (ex: retraits) ---
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`Client ${socket.id} a rejoint la room user-${userId}`);
  });

  socket.on('leave-user-room', (userId) => {
    socket.leave(`user-${userId}`);
    console.log(`Client ${socket.id} a quitté la room user-${userId}`);
  });
  
  // --- Logique pour le suivi des utilisateurs en ligne ---
  socket.on('user_online', async (userId) => {
    // Vérifier si userId est valide
    if (!userId) return;

    console.log(`Événement 'user_online' reçu pour l'utilisateur ${userId}`);
    onlineUsers[userId] = socket.id;
    
    // Mettre à jour la base de données pour marquer l'utilisateur comme "en ligne"
    try {
      await pool.execute(
        'UPDATE utilisateurs SET est_en_ligne = ?, derniere_connexion = NOW() WHERE id = ?',
        [true, userId]
      );
      
      // Envoyer la nouvelle liste d'utilisateurs connectés à tous les clients (admins)
      const users = await getOnlineUsers();
      io.emit('update_online_users', users);
      
    } catch (dbError) {
      console.error("Erreur BDD lors de la mise à jour du statut 'en ligne':", dbError);
    }
  });

   // --- Logique de déconnexion CORRIGÉE ---
   socket.on('disconnect', async (reason) => {
    console.log('Client déconnecté:', socket.id, 'Raison:', reason);

    // Trouver quel utilisateur s'est déconnecté
    const userId = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);
    
    if (userId) {
      console.log(`Utilisateur ${userId} déconnecté`);
      delete onlineUsers[userId];
      
      // Mettre à jour la base de données pour marquer l'utilisateur comme "hors ligne"
      try {
        await pool.execute(
          'UPDATE utilisateurs SET est_en_ligne = ? WHERE id = ?', 
          [false, userId]
        );
        
        // Envoyer la liste mise à jour aux admins
        const users = await getOnlineUsers();
        io.emit('update_online_users', users);
        
        console.log(`Utilisateur ${userId} est maintenant hors ligne.`);
      } catch (dbError) {
        console.error("Erreur BDD lors de la mise à jour du statut 'hors ligne':", dbError);
      }
    }
  });
});

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.API_PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur démarré et écoute sur le port ${PORT}`);
});