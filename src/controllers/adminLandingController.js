const pool = require('../config/db');

// Récupérer les informations de la page d'accueil
exports.getInfoAccueil = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM info_accueil LIMIT 1');
    
    if (rows.length === 0) {
      // Retourner un objet vide au lieu d'une erreur 404
      return res.status(200).json({});
    }
    
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Erreur getInfoAccueil:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Créer ou mettre à jour les informations de la page d'accueil
exports.createOrUpdateInfoAccueil = async (req, res) => {
  try {
    const { title, subtitle } = req.body;
    
    // Récupérer les chemins des fichiers uploadés depuis la réponse du middleware d'upload
    const logoPath = req.uploadResults?.logoPath || null;
    const imagePath = req.uploadResults?.imagePath || null;
    const videoPath = req.uploadResults?.videoPath || null;
    const videoThumb = req.uploadResults?.videoThumb || null;

    console.log('Données reçues pour info_accueil:', {
      title, subtitle, logoPath, imagePath, videoPath, videoThumb
    });

    // Vérifier si une entrée existe déjà
    const [existingRows] = await pool.execute('SELECT id FROM info_accueil LIMIT 1');
    
    if (existingRows.length > 0) {
      // Mise à jour
      const updateFields = [];
      const updateValues = [];
      
      if (title !== undefined) {
        updateFields.push('title = ?');
        updateValues.push(title);
      }
      if (subtitle !== undefined) {
        updateFields.push('subtitle = ?');
        updateValues.push(subtitle);
      }
      if (logoPath !== undefined) {
        updateFields.push('logo_path = ?');
        updateValues.push(logoPath);
      }
      if (imagePath !== undefined) {
        updateFields.push('hero_image_path = ?');
        updateValues.push(imagePath);
      }
      if (videoPath !== undefined) {
        updateFields.push('hero_video_path = ?');
        updateValues.push(videoPath);
      }
      if (videoThumb !== undefined) {
        updateFields.push('video_thumb = ?');
        updateValues.push(videoThumb);
      }
      
      updateValues.push(existingRows[0].id);
      
      await pool.execute(
        `UPDATE info_accueil SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    } else {
      // Insertion
      await pool.execute(
        'INSERT INTO info_accueil (title, subtitle, logo_path, hero_image_path, hero_video_path, video_thumb) VALUES (?, ?, ?, ?, ?, ?)',
        [title || '', subtitle || '', logoPath, imagePath, videoPath, videoThumb]
      );
    }
    
    // Récupérer les données mises à jour
    const [updatedRows] = await pool.execute('SELECT * FROM info_accueil LIMIT 1');
    
    res.status(200).json(updatedRows[0]);
  } catch (error) {
    console.error('Erreur createOrUpdateInfoAccueil:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};