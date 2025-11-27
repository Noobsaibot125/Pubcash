const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

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
    try {
        const [rows] = await pool.execute('SELECT points FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        res.status(200).json({ points: rows[0].points });
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

        // 1. Vérifier si déjà joué aujourd'hui
        const [activity] = await connection.execute(
            'SELECT daily_wheel_spun FROM daily_activity WHERE user_id = ? AND date = ?',
            [userId, today]
        );

        if (activity.length > 0 && activity[0].daily_wheel_spun) {
            await connection.rollback();
            return res.status(403).json({ message: 'Vous avez déjà tourné la roue aujourd\'hui.' });
        }

        // 2. Tirage
        const result = spinWheelLogic();

        // 3. Enregistrer l'activité (INSERT ou UPDATE si déjà ligne pour login/video)
        await connection.execute(`
      INSERT INTO daily_activity (user_id, date, daily_wheel_spun) 
      VALUES (?, ?, TRUE)
      ON DUPLICATE KEY UPDATE daily_wheel_spun = TRUE
    `, [userId, today]);

        // 4. Créditer les points si gagné
        if (result.points > 0) {
            await connection.execute('UPDATE utilisateurs SET points = points + ? WHERE id = ?', [result.points, userId]);
            // Historique (Optionnel, on peut le mettre dans game_history avec un game_id null ou spécial pour la roue)
            await connection.execute(
                'INSERT INTO game_history (user_id, points_gagnes, resultat, created_at) VALUES (?, ?, ?, NOW())',
                [userId, result.points, 'gagne']
            );
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
    const duration = (endTime - session.startTime) / 1000; // en secondes

    // Marge de tolérance de 2 secondes pour la latence réseau
    if (duration > session.durationLimit + 2) {
        delete puzzleSessions[userId];
        return res.status(200).json({ success: false, message: 'Temps écoulé !' });
    }

    // Si on arrive ici, c'est gagné (car le client ne doit appeler submit que s'il a fini)
    // On pourrait ajouter une vérification de "mouvements" si on voulait être plus strict, 
    // mais ici on fait confiance au client pour la résolution, on check juste le temps serveur.

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [game] = await connection.execute('SELECT points_recompense FROM games WHERE id = ?', [gameId]);
        const points = game[0].points_recompense;

        await connection.execute('UPDATE utilisateurs SET points = points + ? WHERE id = ?', [points, userId]);
        await connection.execute(
            'INSERT INTO game_history (user_id, game_id, points_gagnes, resultat) VALUES (?, ?, ?, ?)',
            [userId, gameId, points, 'gagne']
        );

       await connection.commit();
        delete puzzleSessions[userId];
        // MODIFICATION : renvoyer 'points' dans la réponse
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
        const [games] = await pool.execute('SELECT bonne_reponse, points_recompense FROM games WHERE id = ? AND type = "quiz"', [gameId]);
        if (games.length === 0) return res.status(404).json({ message: 'Quiz non trouvé' });

        const game = games[0];

        if (game.bonne_reponse === reponse) {
            await pool.execute('UPDATE utilisateurs SET points = points + ? WHERE id = ?', [game.points_recompense, userId]);
            await pool.execute(
                'INSERT INTO game_history (user_id, game_id, points_gagnes, resultat) VALUES (?, ?, ?, ?)',
                [userId, gameId, game.points_recompense, 'gagne']
            );
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
        // J'ai ajouté la réponse d'erreur ici pour que le front ne reste pas bloqué
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
             query += ' AND (ciblage_commune = "toutes" OR ciblage_commune = ?)';
             params.push(userCommune);
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