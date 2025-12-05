// src/controllers/subscriptionController.js
const pool = require('../config/db');

// Plans d'abonnement disponibles
const SUBSCRIPTION_PLANS = {
    super_promoteur: {
        name: 'Super Promoteur',
        price: 100, // FCFA (test)
        duration_months: 3,
        features: ['Messagerie avec abonnés']
    },
    promoteur_ultra: {
        name: 'Promoteur Ultra',
        price: 150, // FCFA (test)
        duration_months: 6,
        features: ['Messagerie avec abonnés', 'Réductions promotions', 'Bonus créations gratuites']
    }
};

// Récupérer le statut d'abonnement du client connecté
exports.getSubscriptionStatus = async (req, res) => {
    const clientId = req.user.id;

    try {
        const [rows] = await pool.execute(
            `SELECT * FROM abonnements_promoteurs 
       WHERE id_client = ? AND statut = 'actif' AND date_fin > NOW()
       ORDER BY date_fin DESC LIMIT 1`,
            [clientId]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                hasSubscription: false,
                type: 'free',
                plan: null
            });
        }

        const subscription = rows[0];
        return res.status(200).json({
            hasSubscription: true,
            type: subscription.type_abonnement,
            plan: SUBSCRIPTION_PLANS[subscription.type_abonnement],
            dateDebut: subscription.date_debut,
            dateFin: subscription.date_fin
        });

    } catch (error) {
        console.error('Erreur getSubscriptionStatus:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Récupérer les plans disponibles
exports.getPlans = async (req, res) => {
    res.status(200).json(SUBSCRIPTION_PLANS);
};

// Souscrire à un abonnement
exports.subscribe = async (req, res) => {
    const clientId = req.user.id;
    const { planType } = req.body;

    if (!SUBSCRIPTION_PLANS[planType]) {
        return res.status(400).json({ message: 'Plan invalide' });
    }

    const plan = SUBSCRIPTION_PLANS[planType];
    const transactionId = `SUB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
        // Vérifier si un abonnement actif existe déjà
        const [existing] = await pool.execute(
            `SELECT id FROM abonnements_promoteurs 
       WHERE id_client = ? AND statut = 'actif' AND date_fin > NOW()`,
            [clientId]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: 'Vous avez déjà un abonnement actif' });
        }

        // Calculer les dates
        const dateDebut = new Date();
        const dateFin = new Date();
        dateFin.setMonth(dateFin.getMonth() + plan.duration_months);

        // Pour les tests, on active directement sans paiement CinetPay
        // TODO: Intégrer CinetPay comme pour les retraits
        await pool.execute(
            `INSERT INTO abonnements_promoteurs 
       (id_client, type_abonnement, prix, date_debut, date_fin, statut, transaction_id)
       VALUES (?, ?, ?, ?, ?, 'actif', ?)`,
            [clientId, planType, plan.price, dateDebut, dateFin, transactionId]
        );

        res.status(201).json({
            message: 'Abonnement activé avec succès!',
            type: planType,
            dateDebut,
            dateFin
        });

    } catch (error) {
        console.error('Erreur subscribe:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

// Compter les messages non lus pour un promoteur (pour afficher le badge)
exports.getUnreadMessagesCount = async (req, res) => {
    const clientId = req.user.id;

    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM messages 
       WHERE id_destinataire = ? AND type_destinataire = 'client' AND lu = FALSE`,
            [clientId]
        );

        res.status(200).json({ unreadCount: rows[0].count });

    } catch (error) {
        console.error('Erreur getUnreadMessagesCount:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
};

module.exports = exports;
