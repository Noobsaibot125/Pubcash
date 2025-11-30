// src/services/cleanupService.js
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const deleteFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Fichier supprimé : ${filePath}`);
    } catch (err) {
      console.error(`❌ Erreur suppression fichier ${filePath}:`, err);
    }
  }
};

const initCleanupJob = () => {
  // S'exécute tous les jours à minuit (00:00)
  cron.schedule('0 0 * * *', async () => {
    console.log('🧹 [CRON] Vérification des vidéos expirées (> 7 jours)...');

    const connection = await pool.getConnection();

    try {
      // 1. On cherche les vidéos qui ont encore une URL mais qui sont vieilles de +7 jours
      const [oldPromotions] = await connection.execute(
        `SELECT id, url_video 
         FROM promotions 
         WHERE date_creation < NOW() - INTERVAL 7 DAY 
         AND url_video IS NOT NULL`
      );

      if (oldPromotions.length === 0) {
        console.log('✅ Aucune vidéo à nettoyer.');
        return;
      }

      console.log(`found ${oldPromotions.length} vidéos à archiver.`);
      const uploadDir = path.join(__dirname, '../../uploads/videos');

      for (const promo of oldPromotions) {
        // A. Supprimer le fichier vidéo physique (.mp4)
        if (promo.url_video) {
          const videoPath = path.join(uploadDir, promo.url_video);
          deleteFile(videoPath);
        }

        // B. Mettre à jour la BDD : On vide l'URL vidéo mais ON GARDE LE RESTE (Miniature, Titre...)
        // On change aussi le statut si tu veux (optionnel)
        await connection.execute(
          `UPDATE promotions SET url_video = NULL, statut = 'archive' WHERE id = ?`,
          [promo.id]
        );
      }

      console.log('✨ Nettoyage terminé : Les miniatures sont conservées, les vidéos sont supprimées.');

    } catch (error) {
      console.error('❌ Erreur Cron Job:', error);
    } finally {
      connection.release();
    }
  });
};

module.exports = initCleanupJob;