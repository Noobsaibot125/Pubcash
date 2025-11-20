// Dans votre fichier de routes (routes/callbacks.js ou similar)
const express = require('express');
const router = express.Router();

// Webhook CinetPay pour les retraits
router.post('/cinetpay/withdrawal', async (req, res) => {
  try {
    console.log('🔔 Webhook CinetPay reçu:', req.body);
    
    const { client_transaction_id, status, message } = req.body;
    
    // Mettre à jour le statut dans la base de données
    if (client_transaction_id) {
      let statut = 'en_cours';
      
      if (status === 'SUCCESS') statut = 'traite';
      else if (status === 'FAILED') statut = 'rejete';
      
      await pool.execute(
        'UPDATE demandes_retrait SET statut = ?, date_traitement = NOW() WHERE transaction_id = ?',
        [statut, client_transaction_id]
      );
      
      console.log(`✅ Statut mis à jour: ${client_transaction_id} -> ${statut}`);
    }
    
    res.status(200).json({ message: 'Webhook processed' });
  } catch (error) {
    console.error('❌ Erreur webhook CinetPay:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;