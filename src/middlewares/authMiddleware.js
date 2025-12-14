const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Accès non autorisé, token manquant.' });
    }
    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user;

    // 1. ADMINS / SUPERADMINS
    if (decoded.role === 'admin' || decoded.role === 'superadmin') {
      const [rows] = await pool.execute(
        'SELECT id, nom_utilisateur, email, role FROM administrateurs WHERE id = ?',
        [decoded.id]
      );
      user = rows[0];
    } 
    // 2. CLIENTS (PROMOTEURS)
    else if (decoded.role === 'client') {
      // AJOUT : On récupère 'est_bloque'
      const [rows] = await pool.execute(
        'SELECT id, nom_utilisateur, email, role, commune, est_bloque FROM clients WHERE id = ?',
        [decoded.id]
      );
      user = rows[0];
      if (user) {
        user.commune_choisie = user.commune;
      }
    } 
    // 3. UTILISATEURS MOBILES
    else if (decoded.role === 'utilisateur') {
      // AJOUT : On récupère 'est_bloque' et 'est_actif'
      const [rows] = await pool.execute(
        'SELECT id, nom_utilisateur, email, commune_choisie, date_naissance, est_bloque, est_actif FROM utilisateurs WHERE id = ?',
        [decoded.id]
      );
      user = rows[0];
      if (user) {
        user.role = 'utilisateur';
      }
    }

    // --- VÉRIFICATIONS DE SÉCURITÉ ---

    if (!user) {
      return res.status(401).json({ message: 'Utilisateur non trouvé ou supprimé.' });
    }

    // A. VÉRIFICATION DU BLOCAGE (Déconnexion forcée)
    // On vérifie si 1 (int) ou true (boolean)
    if (user.est_bloque == 1) {
        return res.status(403).json({ 
            message: "Votre compte a été bloqué par l'administrateur.", 
            error_code: "ACCOUNT_BLOCKED" // Code utile pour le frontend/mobile pour rediriger vers login
        });
    }

    // B. VÉRIFICATION COMPTE DÉSACTIVÉ (Pour les utilisateurs uniquement)
    if (decoded.role === 'utilisateur' && user.est_actif == 0) {
        return res.status(403).json({ 
            message: "Votre compte a été désactivé.", 
            error_code: "ACCOUNT_DISABLED" 
        });
    }

    // Tout est bon, on passe
    req.user = user;
    next();

  } catch (err) {
    console.error('authMiddleware error:', err.message);
    try {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token expiré.' });
      }
      return res.status(401).json({ message: 'Token invalide.' });
    } catch (resError) {
      console.error('Error sending 401 response:', resError);
    }
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    // Si l'utilisateur n'a pas de rôle défini ou s'il n'est pas dans la liste autorisée
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Accès refusé. Vous n'avez pas les droits nécessaires.`
      });
    }
    next();
  };
};

const admin = authorize('admin', 'administrateur', 'superadmin');

module.exports = {
  protect,
  authorize,
  admin
};