// ======================================================
// --- server.js - Version corrigÃ©e pour la production ---
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
const geoMiddleware = require('./src/middlewares/geoMiddleware');
const maintenanceMiddleware = require('./src/middlewares/maintenanceMiddleware');
const settingsRoutes = require('./src/routes/settingsRoutes');
// --- Initialisation d'Express et du serveur HTTP ---
const app = express();
const server = http.createServer(app);

// Activer 'trust proxy' pour que Express récupère la vraie IP derrière Nginx/Apache/Cloudflare
// Cela permet à req.ip et x-forwarded-for d'être corrects
app.set('trust proxy', 1);

// ======================================================
// --- NOUVELLE CONFIGURATION CORS FLEXIBLE ---
// ======================================================

// 1. DÃ©finir la liste des origines autorisÃ©es (whitelist)
const allowedOrigins = [
  'http://localhost:3000',           // DÃ©veloppement local
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

// 2. CrÃ©er les options de configuration CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Autoriser les requÃªtes sans origine (ex: Postman, apps mobiles) ou celles dans la whitelist
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Rejeter les requÃªtes qui ne sont pas dans la whitelist
      callback(new Error('Cette origine n\'est pas autorisÃ©e par la politique CORS.'));
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

// --- CrÃ©ation des dossiers 'uploads' ---
const uploadsDir = path.join(__dirname, 'uploads');
const requiredDirs = ['videos', 'thumbnails', 'profile', 'background', 'landing', 'messages'];

requiredDirs.forEach(dir => {
  const fullPath = path.join(uploadsDir, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// --- MIDDLEWARES ---
// Appliquer la politique CORS Ã  toutes les routes HTTP
app.use(cors(corsOptions));

// IMPORTANT: DÃ©sactiver CORS pour les webhooks CinetPay (ils n'envoient pas d'origin)
app.use('/api/callbacks/cinetpay/withdrawal', express.json());
app.use('/webhook/cinetpay', express.json());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
// --- WEBHOOKS CINETPAY (CORRIGÃ‰S) ---
// ======================================================

// Webhook pour les paiements clients (existant)
app.post('/webhook/cinetpay', clientController.cinetpayNotify);

// ======================================================
// --- NOUVEAU : WEBHOOK POUR LES RETRAITS UTILISATEURS ---
// ======================================================

// Route pour les retraits utilisateurs
app.post('/api/callbacks/cinetpay/withdrawal', async (req, res) => {
  try {
    console.log('ðŸ”” Webhook CinetPay Retrait reÃ§u:', JSON.stringify(req.body, null, 2));

    // On utilise treatment_status (VAL, ERR, NEW, CAN)
    const { client_transaction_id, treatment_status, message } = req.body;

    if (client_transaction_id) {
      let statut = 'en_cours'; // Par dÃ©faut si non gÃ©rÃ©

      // Mappage des statuts CinetPay Transfert
      if (treatment_status === 'VAL') {
        statut = 'traite'; // âœ… SuccÃ¨s dÃ©finitif
      } else if (treatment_status === 'ERR' || treatment_status === 'CAN') {
        statut = 'rejete'; // âŒ Ã‰chec ou AnnulÃ©

        // Restauration du solde utilisateur en cas d'Ã©chec
        try {
          const [demandeRows] = await pool.execute(
            'SELECT id_utilisateur, montant FROM demandes_retrait WHERE transaction_id = ? AND statut = "en_cours"',
            [client_transaction_id]
          );

          if (demandeRows.length > 0) {
            const { id_utilisateur, montant } = demandeRows[0];
            await pool.execute(
              'UPDATE utilisateurs SET remuneration_utilisateur = COALESCE(remuneration_utilisateur, 0) + ? WHERE id = ?',
              [montant, id_utilisateur]
            );
            console.log(`ðŸ’° Solde restaurÃ© pour l'utilisateur ${id_utilisateur}: +${montant} XOF`);
          }
        } catch (soldeError) {
          console.error('âŒ Erreur lors de la restauration du solde:', soldeError);
        }
      }

      // Mise Ã  jour du statut dans la base de donnÃ©es
      await pool.execute(
        'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
        [statut, client_transaction_id]
      );

      console.log(`ðŸ“ Statut mis Ã  jour: ${client_transaction_id} -> ${statut}`);

      // Notifier l'utilisateur via Socket.IO si connectÃ©
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
            message: message || 'Statut mis Ã  jour'
          });
          console.log(`ðŸ“¢ Notification envoyÃ©e Ã  l'utilisateur ${userId}`);
        }
      } catch (notifError) {
        console.error('âŒ Erreur lors de la notification:', notifError);
      }
    }

    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('âŒ Erreur webhook CinetPay Retrait:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ======================================================
// --- ROUTES PRINCIPALES DE L'API ---
// ======================================================

// ======================================================
// --- RESTRICTION GÃ‰OGRAPHIQUE (CÃ”TE D'IVOIRE) ---
// ======================================================
app.use(geoMiddleware);

// --- ROUTES SETTINGS (Doit être avant le middleware de maintenance pour pouvoir le désactiver) ---
app.use('/api/settings', settingsRoutes);

// --- MIDDLEWARE MAINTENANCE ---
app.use(maintenanceMiddleware);

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

  // --- 1. GESTION DU CHAT (NOUVEAU) ---
  // Permet à un utilisateur (client ou utilisateur) de s'enregistrer pour recevoir des messages
  socket.on('register_chat', (data) => {
      // data doit contenir { userId: 1, userType: 'client' } ou 'utilisateur'
      if (!data || !data.userId || !data.userType) return;
      
      const roomName = `${data.userType}_${data.userId}`;
      socket.join(roomName);
      console.log(`💬 Chat: Client ${socket.id} a rejoint la room ${roomName}`);
  });
  
  // --- 2. GESTION DES NOTIFICATIONS CIBLÉES (RETRAITS) ---
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`Client ${socket.id} a rejoint la room user-${userId}`);
  });

  socket.on('leave-user-room', (userId) => {
    socket.leave(`user-${userId}`);
    console.log(`Client ${socket.id} a quitté la room user-${userId}`);
  });

  // --- 3. SUIVI UTILISATEURS EN LIGNE (EXISTANT) ---
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

  // --- 4. DÉCONNEXION ---
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
// --- ROUTE DE SANTÃ‰ POUR VÃ‰RIFICATION ---
// ======================================================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Serveur Pub-Cash en ligne',
    timestamp: new Date().toISOString()
  });
});

// Route de debug pour vérifier l'IP vue par le serveur
app.get('/api/check-geo', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ipClean = ip ? (ip.includes(',') ? ip.split(',')[0].trim() : ip) : null;
  const geoip = require('geoip-lite');
  const geo = geoip.lookup(ipClean);

  res.json({
    your_ip_raw: ip,
    your_ip_clean: ipClean,
    detected_country: geo ? geo.country : 'Unknown',
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'cf-connecting-ip': req.headers['cf-connecting-ip'] // Si Cloudflare
    }
  });
});

// ======================================================
// --- LANCEMENT DU CRON JOB ---
// ======================================================
initCleanupJob(); // <--- C'est cette ligne qui active le nettoyage automatique

// --- DÃ‰MARRAGE DU SERVEUR ---
const PORT = process.env.PORT || process.env.API_PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur dÃ©marrÃ© et Ã©coute sur le port ${PORT}`);
  console.log(`ðŸŒ Webhook retraits disponible sur: https://pub-cash.com/api/callbacks/cinetpay/withdrawal`);
  console.log(`ðŸ”§ Route santÃ© disponible sur: http://localhost:${PORT}/health`);
});
