const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// CORRECTION : On renomme la fonction de 'authMiddleware' à 'protect'
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Accès non autorisé, token manquant.' });
    }
    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    let user;
    
    // La logique interne pour trouver l'utilisateur est correcte
    if (decoded.role === 'admin' || decoded.role === 'superadmin') {
      const [rows] = await pool.execute(
        'SELECT id, nom_utilisateur, email, role FROM administrateurs WHERE id = ?',
        [decoded.id]
      );
      user = rows[0];
    } else if (decoded.role === 'client') {
      const [rows] = await pool.execute(
        'SELECT id, nom_utilisateur, email, role, commune FROM clients WHERE id = ?',
        [decoded.id]
      );
      user = rows[0];
      if (user) {
        user.commune_choisie = user.commune;
      }
    } else if (decoded.role === 'utilisateur') {
      const [rows] = await pool.execute(
        'SELECT id, nom_utilisateur, email, commune_choisie, date_naissance FROM utilisateurs WHERE id = ?',
        [decoded.id]
      );
      user = rows[0];
      if (user) {
        user.role = 'utilisateur';
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Utilisateur associé au token non trouvé.' });
    }

    req.user = user;
    next();
    
  } catch (err) {
    console.error('authMiddleware error:', err);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expiré.' });
    }
    return res.status(401).json({ message: 'Token invalide.' });
  }
};

// La fonction 'authorize' est correcte
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Accès refusé. Le rôle '${req.user.role}' n'est pas autorisé à accéder à cette ressource.` 
      });
    }
    next();
  };
};

// L'export est maintenant correct car 'protect' est bien défini juste au-dessus
module.exports = {
  protect,
  authorize
};