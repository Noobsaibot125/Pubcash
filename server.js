// ======================================================
// --- server.js - Version corrigée pour la production ---
// ======================================================

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
const publicRoutes = require('./src/routes/publicRoutes');
// --- AJOUT : Import du service de nettoyage ---
const initCleanupJob = require('./src/services/cleanupService'); 
// --- Initialisation d'Express et du serveur HTTP ---
const app = express();
const server = http.createServer(app);

// ======================================================
// --- NOUVELLE CONFIGURATION CORS FLEXIBLE ---
// ======================================================

// 1. Définir la liste des origines autorisées (whitelist)
const allowedOrigins = [
  'http://localhost:3000',           // Développement local
   'http://31.97.68.170',             // VOTRE IP CORRECTE (sans le 7 en trop)
   'http://31.97.68.170:80',          // Frontend sur port 80 (Apache)
   'http://31.97.68.170:3000',        // Frontend sur port 3000 (dev)
   'http://31.97.68.170:5000',        // Backend
   'https://31.97.68.170',            // HTTPS si applicable
   'http://31.97.68.170',             // Gardez l'ancienne IP si vous l'utilisez encore
  'https://pub-cash.com',
   'https://www.pub-cash.com',
   'http://pub-cash.com',
   'http://www.pub-cash.com'
 ];

// 2. Créer les options de configuration CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Autoriser les requêtes sans origine (ex: Postman, apps mobiles) ou celles dans la whitelist
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Rejeter les requêtes qui ne sont pas dans la whitelist
      callback(new Error('Cette origine n\'est pas autorisée par la politique CORS.'));
    }
  }
};

// ======================================================

// --- Configuration de Socket.IO avec la nouvelle politique CORS ---
const io = new Server(server, {
  cors: corsOptions
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
// Appliquer la politique CORS à toutes les routes HTTP
app.use(cors(corsOptions)); 

// IMPORTANT: Désactiver CORS pour les webhooks CinetPay (ils n'envoient pas d'origin)
app.use('/api/callbacks/cinetpay/withdrawal', express.json());
app.use('/webhook/cinetpay', express.json());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SERVIR LES FICHIERS STATIQUES ---
app.use('/uploads', (req, res, next) => {
  if (req.path.endsWith('.mp4')) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', 'bytes');
  } else if (req.path.endsWith('.webm')) {
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', 'bytes');
  }
  next();
});
app.use('/uploads', express.static(uploadsDir));

// ======================================================
// --- WEBHOOKS CINETPAY (CORRIGÉS) ---
// ======================================================

// Webhook pour les paiements clients (existant)
app.post('/webhook/cinetpay', clientController.cinetpayNotify);

// ======================================================
// --- NOUVEAU : WEBHOOK POUR LES RETRAITS UTILISATEURS ---
// ======================================================

// Route pour les retraits utilisateurs
app.post('/api/callbacks/cinetpay/withdrawal', async (req, res) => {
  try {
    console.log('🔔 Webhook CinetPay Retrait reçu:', JSON.stringify(req.body, null, 2));
    
    const { client_transaction_id, status, message } = req.body;
    
    if (client_transaction_id) {
      let statut = 'en_cours';
      
      if (status === 'SUCCESS') {
        statut = 'traite';
        console.log(`✅ Retrait ${client_transaction_id} réussi`);
      } else if (status === 'FAILED') {
        statut = 'rejete';
        console.log(`❌ Retrait ${client_transaction_id} échoué: ${message}`);
        
        // Restaurer le solde utilisateur en cas d'échec
        try {
          const [demandeRows] = await pool.execute(
            'SELECT id_utilisateur, montant FROM demandes_retrait WHERE transaction_id = ?',
            [client_transaction_id]
          );
          
          if (demandeRows.length > 0) {
            const { id_utilisateur, montant } = demandeRows[0];
            await pool.execute(
              'UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur, 0) + ? WHERE id = ?',
              [montant, id_utilisateur]
            );
            console.log(`💰 Solde restauré pour l'utilisateur ${id_utilisateur}: +${montant} XOF`);
          }
        } catch (soldeError) {
          console.error('❌ Erreur lors de la restauration du solde:', soldeError);
        }
      }
      
      // Mettre à jour le statut dans la base de données
      await pool.execute(
        'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
        [statut, client_transaction_id]
      );
      
      console.log(`📝 Statut mis à jour: ${client_transaction_id} -> ${statut}`);
      
      // Notifier l'utilisateur via Socket.IO si connecté
      try {
        const [demandeRows] = await pool.execute(
          'SELECT id_utilisateur FROM demandes_retrait WHERE transaction_id = ?',
          [client_transaction_id]
        );
        
        if (demandeRows.length > 0) {
          const userId = demandeRows[0].id_utilisateur;
          io.to(`user-${userId}`).emit('withdrawal-updated', {
            requestId: client_transaction_id,
            status: statut,
            message: message || 'Statut mis à jour'
          });
          console.log(`📢 Notification envoyée à l'utilisateur ${userId}`);
        }
      } catch (notifError) {
        console.error('❌ Erreur lors de la notification:', notifError);
      }
    }
    
    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('❌ Erreur webhook CinetPay Retrait:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================================================
// --- ROUTES PRINCIPALES DE L'API ---
// ======================================================

app.use('/api', mainRouter);
app.use('/api', publicRoutes);

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

// ======================================================
// --- ROUTE DE SANTÉ POUR VÉRIFICATION ---
// ======================================================

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Serveur Pub-Cash en ligne',
    timestamp: new Date().toISOString()
  });
});

// ======================================================
// --- LANCEMENT DU CRON JOB ---
// ======================================================
initCleanupJob(); // <--- C'est cette ligne qui active le nettoyage automatique

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || process.env.API_PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur démarré et écoute sur le port ${PORT}`);
  console.log(`🌐 Webhook retraits disponible sur: https://pub-cash.com/api/callbacks/cinetpay/withdrawal`);
  console.log(`🔧 Route santé disponible sur: http://localhost:${PORT}/health`);
});