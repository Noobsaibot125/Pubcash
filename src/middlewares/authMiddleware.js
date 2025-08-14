// pubcash-api/src/middlewares/authMiddleware.js

const jwt = require('jsonwebtoken');

// 1. On définit la fonction avec le nom standard "authMiddleware"
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'Token manquant' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ message: 'Format d\'autorisation invalide' });
    }

    const token = parts[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Token invalide' });
      }
      req.user = decoded; // { id, email, role }
      next();
    });
  } catch (err) {
    console.error('authMiddleware error', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// 2. On exporte la fonction que nous venons de définir
module.exports = authMiddleware;