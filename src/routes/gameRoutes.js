const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');
const { protect } = require('../middlewares/authMiddleware');

// --- ROUTES UTILISATEUR ---

// Obtenir les points de l'utilisateur
router.get('/points', protect, gameController.getPoints);

// Tourner la roue journalière
router.post('/wheel', protect, gameController.spinWheel);

// Démarrer un puzzle (retourne le timestamp de début)
router.post('/puzzle/start', protect, gameController.startPuzzle);

// Soumettre un puzzle (vérifie le temps et attribue les points)
router.post('/puzzle/submit', protect, gameController.submitPuzzle);

// Soumettre un quiz (après vidéo)
router.post('/quiz/submit', protect, gameController.submitQuiz);

// Lister les jeux disponibles (puzzles, quiz)
router.get('/list', protect, gameController.getGames);

// --- ROUTES ADMIN ---
// (Idéalement, ajouter un middleware 'admin' ici)
router.post('/create', protect, gameController.createGame);
router.delete('/:gameId', protect, gameController.deletepuzzle);

module.exports = router;
