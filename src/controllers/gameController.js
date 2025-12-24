const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const notificationService = require('../services/notificationService');
// --- UTILITAIRES ---

// Pondération pour la roue
const spinWheelLogic = () => {
    const rand = Math.random() * 100; // 0 à 100
    if (rand < 60) return { type: 'perdu', points: 0, label: 'Perdu' }; // 60%
    if (rand < 80) return { type: 'gagne', points: 1, label: '1 Point' }; // 20%
    if (rand < 95) return { type: 'gagne', points: 2, label: '2 Points' }; // 15%
    return { type: 'gagne', points: 5, label: '5 Points' }; // 5%
};

// --- CONTROLLERS ---

exports.getPoints = async (req, res) => {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0]; // Date du jour

    try {
        // On récupère les points ET si la roue a été tournée aujourd'hui
        // On utilise LEFT JOIN pour vérifier l'activité du jour même si elle n'existe pas encore
        const query = `
            SELECT u.points, 
                   COALESCE(da.daily_wheel_spun, 0) as wheel_spun
            FROM utilisateurs u
            LEFT JOIN daily_activity da ON u.id = da.user_id AND da.date = ?
            WHERE u.id = ?
        `;

        const [rows] = await pool.execute(query, [today, userId]);

        if (rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé' });

        // On renvoie les points ET le booléen (converti en true/false)
        res.status(200).json({
            points: rows[0].points,
            wheel_spun: !!rows[0].wheel_spun
        });

    } catch (error) {
        console.error('Erreur getPoints:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

exports.spinWheel = async (req, res) => {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [activity] = await connection.execute(
            'SELECT daily_wheel_spun FROM daily_activity WHERE user_id = ? AND date = ?',
            [userId, today]
        );

        if (activity.length > 0 && activity[0].daily_wheel_spun) {
            await connection.rollback();
            return res.status(403).json({ message: 'Vous avez déjà tourné la roue aujourd\'hui.' });
        }

        const result = spinWheelLogic();

        await connection.execute(`
      INSERT INTO daily_activity (user_id, date, daily_wheel_spun) 
      VALUES (?, ?, TRUE)
      ON DUPLICATE KEY UPDATE daily_wheel_spun = TRUE
    `, [userId, today]);

        if (result.points > 0) {
            await connection.execute('UPDATE utilisateurs SET points = points + ? WHERE id = ?', [result.points, userId]);
            await connection.execute(
                'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
                [userId, result.points, 'gagne']
            );

            // --- AJOUT NOTIFICATION ROUE ---
            await notificationService.envoyerNotification(
                userId,
                'jeu_gagne',
                'Roue de la Fortune 🎡',
                `Félicitations ! Vous avez gagné ${result.points} points.`,
                { points: result.points, game_type: 'roue' }
            ).catch(err => console.error('Erreur notification roue:', err));
            // -------------------------------

        } else {
            await connection.execute(
                'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
                [userId, 0, 'perdu']
            );
        }

        await connection.commit();
        res.status(200).json({
            points_gagnes: result.points,
            message: result.label
        });

    } catch (error) {
        await connection.rollback();
        console.error('Erreur spinWheel:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    } finally {
        connection.release();
    }
};

// Stockage temporaire des sessions de puzzle (en mémoire pour simplifier, ou Redis idéalement)
// Format: { userId: { gameId, startTime } }
const puzzleSessions = {};

exports.startPuzzle = async (req, res) => {
    const { gameId } = req.body;
    const userId = req.user.id;

    // Vérifier si le jeu existe
    const [games] = await pool.execute('SELECT * FROM games WHERE id = ? AND type = "puzzle"', [gameId]);
    if (games.length === 0) return res.status(404).json({ message: 'Puzzle non trouvé' });

    puzzleSessions[userId] = {
        gameId,
        startTime: Date.now(),
        durationLimit: games[0].duree_limite // en secondes
    };

    res.status(200).json({ message: 'Puzzle démarré', startTime: puzzleSessions[userId].startTime });
};

exports.submitPuzzle = async (req, res) => {
    const { gameId } = req.body;
    const userId = req.user.id;
    const session = puzzleSessions[userId];

    if (!session || session.gameId !== gameId) {
        return res.status(400).json({ message: 'Aucune session de jeu active pour ce puzzle.' });
    }

    const endTime = Date.now();
    const duration = (endTime - session.startTime) / 1000;

    if (duration > session.durationLimit + 2) {
        delete puzzleSessions[userId];
        return res.status(200).json({ success: false, message: 'Temps écoulé !' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // J'ai ajouté `titre` dans le SELECT pour la notification
        const [gameRows] = await connection.execute('SELECT titre, points_recompense FROM games WHERE id = ?', [gameId]);
        const game = gameRows[0];
        const points = game.points_recompense;

        await connection.execute('UPDATE utilisateurs SET points = points + ? WHERE id = ?', [points, userId]);
        await connection.execute(
            'INSERT INTO game_history (user_id, game_id, points_gagnes, resultat) VALUES (?, ?, ?, ?)',
            [userId, gameId, points, 'gagne']
        );

        // --- AJOUT NOTIFICATION PUZZLE ---
        notificationService.envoyerNotification(
            userId,
            'jeu_gagne',
            `${game.titre || 'Puzzle'}, Vous avez reçu ${points} pts`,
            `Félicitations pour votre victoire !`,
            { points, game_id: gameId, game_type: 'puzzle' }
        ).catch(err => console.error('Erreur notification puzzle (background):', err));

        // ---------------------------------

        await connection.commit();
        delete puzzleSessions[userId];

        // La réponse partira beaucoup plus vite maintenant
        res.status(200).json({ success: true, points, message: 'Félicitations !' });

    } catch (error) {
        await connection.rollback();
        console.error('Erreur submitPuzzle:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    } finally {
        connection.release();
    }
};
exports.submitQuiz = async (req, res) => {
    const { gameId, reponse } = req.body;
    const userId = req.user.id;

    try {
        // J'ai ajouté `titre` dans le SELECT pour la notification
        const [games] = await pool.execute('SELECT titre, bonne_reponse, points_recompense FROM games WHERE id = ? AND type = "quiz"', [gameId]);
        if (games.length === 0) return res.status(404).json({ message: 'Quiz non trouvé' });

        const game = games[0];

        if (game.bonne_reponse === reponse) {
            await pool.execute('UPDATE utilisateurs SET points = points + ? WHERE id = ?', [game.points_recompense, userId]);
            await pool.execute(
                'INSERT INTO game_history (user_id, game_id, points_gagnes, resultat) VALUES (?, ?, ?, ?)',
                [userId, gameId, game.points_recompense, 'gagne']
            );

            // --- AJOUT NOTIFICATION QUIZ ---
            await notificationService.envoyerNotification(
                userId,
                'jeu_gagne',
                `${game.titre || 'Quiz'}, Vous avez reçu ${game.points_recompense} pts`,
                `Félicitations pour votre victoire !`,
                { points: game.points_recompense, game_id: gameId, game_type: 'quiz' }
            ).catch(err => console.error('Erreur notification quiz:', err));
            // -------------------------------

            return res.status(200).json({ success: true, points: game.points_recompense, message: 'Bonne réponse !' });
        } else {
            await pool.execute(
                'INSERT INTO game_history (user_id, game_id, points_gagnes, resultat) VALUES (?, ?, ?, ?)',
                [userId, gameId, 0, 'perdu']
            );
            return res.status(200).json({ success: false, message: 'Mauvaise réponse.' });
        }

    } catch (error) {
        console.error('Erreur submitQuiz:', error);
        return res.status(500).json({ message: 'Erreur serveur', error: error.message });
    }
};
// Admin: Créer un jeu  
exports.createGame = async (req, res) => {
    const {
        type,
        titre,
        image_url,
        question,
        reponses,
        bonne_reponse,
        duree_limite,
        points_recompense,
        ciblage_commune,
        promotion_id,
        statut
    } = req.body;

    try {
        const finalCiblage = ciblage_commune || 'toutes';
        const finalStatut = statut || 'actif';
        const finalPromotionId = promotion_id || null;

        // Pour les puzzles, ces champs sont NULL
        const finalQuestion = type === 'puzzle' ? null : (question || null);
        const finalReponses = type === 'puzzle' ? null : (reponses || null);
        const finalBonneReponse = type === 'puzzle' ? null : (bonne_reponse || null);

        // Pour les quiz sans image  
        const finalImageUrl = image_url || null;
        const finalDuree = duree_limite || null;

        await pool.execute(`
            INSERT INTO games (
                type, titre, image_url, question, reponses, bonne_reponse, 
                duree_limite, points_recompense, ciblage_commune, promotion_id, statut
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            type,
            titre,
            finalImageUrl,
            finalQuestion,
            finalReponses,
            finalBonneReponse,
            finalDuree,
            points_recompense,
            finalCiblage,
            finalPromotionId,
            finalStatut
        ]);

        res.status(201).json({ message: 'Jeu créé avec succès' });
    } catch (error) {
        console.error('Erreur createGame:', error);
        res.status(500).json({ message: 'Erreur serveur', error: error.message });
    }
};

exports.getGames = async (req, res) => {
    const userId = req.user.id;
    const userCommune = req.user.commune_choisie;
    const { type } = req.query; // 'puzzle' ou 'quiz'

    try {
        // 1. Récupérer tous les jeux actifs (filtrés par type et commune)
        let query = 'SELECT * FROM games WHERE statut = "actif"';
        const params = [];

        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }

        // Filtrage par commune (si utilisateur)
        if (req.user.role === 'utilisateur') {
            // Si l'utilisateur n'a pas de commune (cas social login incomplet), on ne montre que les jeux "toutes"
            if (!userCommune) {
                query += ' AND ciblage_commune = "toutes"';
            } else {
                query += ' AND (ciblage_commune = "toutes" OR ciblage_commune = ?)';
                params.push(userCommune);
            }
        }

        const [games] = await pool.execute(query, params);

        // 2. Si c'est un utilisateur, vérifier quels jeux ont été gagnés AUJOURD'HUI
        let wonGameIds = [];
        if (req.user.role === 'utilisateur') {
            const today = new Date().toISOString().split('T')[0];

            // On regarde dans l'historique les victoires de ce jour
            const [wonGames] = await pool.execute(
                `SELECT DISTINCT game_id 
                 FROM game_history 
                 WHERE user_id = ? 
                 AND resultat = "gagne" 
                 AND DATE(created_at) = ?`,
                [userId, today]
            );
            wonGameIds = wonGames.map(row => row.game_id);
        }

        // 3. Construction de la réponse avec l'indicateur 'deja_joue'
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const gamesWithStatus = games.map(game => ({
            ...game,
            image_url: game.image_url && !game.image_url.startsWith('http')
                ? `${baseUrl}/uploads/puzzles/${game.image_url}`
                : game.image_url,
            // Ajout du flag pour le frontend
            deja_joue: wonGameIds.includes(game.id)
        }));

        res.status(200).json(gamesWithStatus);

    } catch (error) {
        console.error('Erreur getGames:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};


exports.deletepuzzle = async (req, res) => {
    const { gameId } = req.params;
    try {
        await pool.execute('DELETE FROM games WHERE id = ?', [gameId]);
        res.status(200).json({ message: 'Jeu supprimé avec succès' });
    } catch (error) {
        console.error('Erreur deletepuzzle:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }

};
exports.getQuizStatsByPromotion = async (req, res) => {
    const { promotionId } = req.params;

    try {
        // 1. Trouver le jeu associé à la promotion
        const [games] = await pool.execute(
            'SELECT id, type, titre FROM games WHERE promotion_id = ?',
            [promotionId]
        );

        if (games.length === 0) {
            return res.status(200).json({ hasGame: false });
        }

        const game = games[0];

        // 2. Calculer les stats depuis l'historique
        // resultat = 'gagne' (Bonne réponse) ou 'perdu' (Mauvaise réponse)
        const [stats] = await pool.execute(`
            SELECT 
                SUM(CASE WHEN resultat = 'gagne' THEN 1 ELSE 0 END) as bonnes_reponses,
                SUM(CASE WHEN resultat = 'perdu' THEN 1 ELSE 0 END) as mauvaises_reponses,
                COUNT(*) as total_joueurs
            FROM game_history 
            WHERE game_id = ?
        `, [game.id]);

        const data = stats[0];

        res.status(200).json({
            hasGame: true,
            gameType: game.type,
            gameTitle: game.titre,
            stats: {
                bonnes: parseInt(data.bonnes_reponses || 0),
                mauvaises: parseInt(data.mauvaises_reponses || 0),
                total: parseInt(data.total_joueurs || 0)
            }
        });

    } catch (error) {
        console.error('Erreur getQuizStatsByPromotion:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};