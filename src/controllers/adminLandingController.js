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
    // sécuriser la lecture des champs textuels
    const title = req.body?.title ?? '';
    const subtitle = req.body?.subtitle ?? '';

    // récupérer chemins (toUploadResults ou directement req.files)
    const logoPath = req.uploadResults?.logoPath ?? (req.files?.logo?.[0] ? `/uploads/landing/${req.files.logo[0].filename}` : null);
    const imagePath = req.uploadResults?.imagePath ?? (req.files?.image?.[0] ? `/uploads/landing/${req.files.image[0].filename}` : null);
    const videoPath = req.uploadResults?.videoPath ?? (req.files?.video?.[0] ? `/uploads/landing/${req.files.video[0].filename}` : null);

    console.log('Données reçues pour info_accueil:', { title, subtitle, logoPath, imagePath, videoPath });
    console.log('req.body:', req.body);
    console.log('req.files:', req.files);

    // Vérifier si entrée existe
    const [existingRows] = await pool.execute('SELECT id FROM info_accueil LIMIT 1');

    if (existingRows.length > 0) {
      const updateFields = [];
      const updateValues = [];

      if (title !== undefined) { updateFields.push('title = ?'); updateValues.push(title); }
      if (subtitle !== undefined) { updateFields.push('subtitle = ?'); updateValues.push(subtitle); }
      if (logoPath !== undefined && logoPath !== null) { updateFields.push('logo_path = ?'); updateValues.push(logoPath); }
      if (imagePath !== undefined && imagePath !== null) { updateFields.push('hero_image_path = ?'); updateValues.push(imagePath); }
      if (videoPath !== undefined && videoPath !== null) { updateFields.push('hero_video_path = ?'); updateValues.push(videoPath); }

      if (updateFields.length === 0) {
        return res.status(200).json({ message: 'Aucun champ à mettre à jour' });
      }

      updateValues.push(existingRows[0].id);
      await pool.execute(`UPDATE info_accueil SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    } else {
      await pool.execute(
        'INSERT INTO info_accueil (title, subtitle, logo_path, hero_image_path, hero_video_path, video_thumb) VALUES (?, ?, ?, ?, ?, ?)',
        [title || '', subtitle || '', logoPath, imagePath, videoPath, null]
      );
    }

    const [updatedRows] = await pool.execute('SELECT * FROM info_accueil LIMIT 1');
    res.status(200).json(updatedRows[0]);
  } catch (error) {
    console.error('Erreur createOrUpdateInfoAccueil:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};