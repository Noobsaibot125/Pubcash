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

    const ecosystem_title = req.body?.ecosystem_title ?? '';
    const ecosystem_description = req.body?.ecosystem_description ?? '';

    const advertisers_title = req.body?.advertisers_title ?? '';
    const advertisers_description = req.body?.advertisers_description ?? '';
    const advertisers_features = req.body?.advertisers_features ?? '[]';

    const users_title = req.body?.users_title ?? '';
    const users_description = req.body?.users_description ?? '';
    const users_features = req.body?.users_features ?? '[]';

    const testimonial_text = req.body?.testimonial_text ?? '';
    const testimonial_author = req.body?.testimonial_author ?? '';

    // récupérer chemins (toUploadResults ou directement req.files)
    const logoPath = req.uploadResults?.logoPath ?? (req.files?.logo?.[0] ? `/uploads/landing/${req.files.logo[0].filename}` : null);
    const imagePath = req.uploadResults?.imagePath ?? (req.files?.image?.[0] ? `/uploads/landing/${req.files.image[0].filename}` : null);
    const videoPath = req.uploadResults?.videoPath ?? (req.files?.video?.[0] ? `/uploads/landing/${req.files.video[0].filename}` : null);
    const advertisersImagePath = req.uploadResults?.advertisersImagePath ?? (req.files?.advertisers_image?.[0] ? `/uploads/landing/${req.files.advertisers_image[0].filename}` : null);
    const usersImagePath = req.uploadResults?.usersImagePath ?? (req.files?.users_image?.[0] ? `/uploads/landing/${req.files.users_image[0].filename}` : null);

    // Nouveaux chemins pour le tutoriel mobile
    const tutorial1Path = req.files?.tutorial_1?.[0] ? `/uploads/landing/${req.files.tutorial_1[0].filename}` : null;
    const tutorial2Path = req.files?.tutorial_2?.[0] ? `/uploads/landing/${req.files.tutorial_2[0].filename}` : null;
    const tutorial3Path = req.files?.tutorial_3?.[0] ? `/uploads/landing/${req.files.tutorial_3[0].filename}` : null;

    console.log('Données reçues pour info_accueil:', { title, subtitle, logoPath, imagePath, videoPath });

    // Vérifier si entrée existe
    const [existingRows] = await pool.execute('SELECT id FROM info_accueil LIMIT 1');

    if (existingRows.length > 0) {
      const updateFields = [];
      const updateValues = [];

      if (title !== undefined) { updateFields.push('title = ?'); updateValues.push(title); }
      if (subtitle !== undefined) { updateFields.push('subtitle = ?'); updateValues.push(subtitle); }

      if (ecosystem_title !== undefined) { updateFields.push('ecosystem_title = ?'); updateValues.push(ecosystem_title); }
      if (ecosystem_description !== undefined) { updateFields.push('ecosystem_description = ?'); updateValues.push(ecosystem_description); }

      if (advertisers_title !== undefined) { updateFields.push('advertisers_title = ?'); updateValues.push(advertisers_title); }
      if (advertisers_description !== undefined) { updateFields.push('advertisers_description = ?'); updateValues.push(advertisers_description); }
      if (advertisers_features !== undefined) { updateFields.push('advertisers_features = ?'); updateValues.push(advertisers_features); }

      if (users_title !== undefined) { updateFields.push('users_title = ?'); updateValues.push(users_title); }
      if (users_description !== undefined) { updateFields.push('users_description = ?'); updateValues.push(users_description); }
      if (users_features !== undefined) { updateFields.push('users_features = ?'); updateValues.push(users_features); }

      if (testimonial_text !== undefined) { updateFields.push('testimonial_text = ?'); updateValues.push(testimonial_text); }
      if (testimonial_author !== undefined) { updateFields.push('testimonial_author = ?'); updateValues.push(testimonial_author); }

      if (logoPath !== undefined && logoPath !== null) { updateFields.push('logo_path = ?'); updateValues.push(logoPath); }
      if (imagePath !== undefined && imagePath !== null) { updateFields.push('hero_image_path = ?'); updateValues.push(imagePath); }
      if (videoPath !== undefined && videoPath !== null) { updateFields.push('hero_video_path = ?'); updateValues.push(videoPath); }
      if (advertisersImagePath !== undefined && advertisersImagePath !== null) { updateFields.push('advertisers_image_path = ?'); updateValues.push(advertisersImagePath); }
      if (usersImagePath !== undefined && usersImagePath !== null) { updateFields.push('users_image_path = ?'); updateValues.push(usersImagePath); }

      if (tutorial1Path) { updateFields.push('tutorial_image_1 = ?'); updateValues.push(tutorial1Path); }
      if (tutorial2Path) { updateFields.push('tutorial_image_2 = ?'); updateValues.push(tutorial2Path); }
      if (tutorial3Path) { updateFields.push('tutorial_image_3 = ?'); updateValues.push(tutorial3Path); }

      if (updateFields.length === 0) {
        return res.status(200).json({ message: 'Aucun champ à mettre à jour' });
      }

      updateValues.push(existingRows[0].id);
      await pool.execute(`UPDATE info_accueil SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    } else {
      await pool.execute(
        `INSERT INTO info_accueil (
          title, subtitle, logo_path, hero_image_path, hero_video_path, video_thumb,
          ecosystem_title, ecosystem_description,
          advertisers_title, advertisers_description, advertisers_features, advertisers_image_path,
          users_title, users_description, users_features, users_image_path,
          testimonial_text, testimonial_author,
          tutorial_image_1, tutorial_image_2, tutorial_image_3
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title || '', subtitle || '', logoPath, imagePath, videoPath, null,
          ecosystem_title, ecosystem_description,
          advertisers_title, advertisers_description, advertisers_features, advertisersImagePath,
          users_title, users_description, users_features, usersImagePath,
          testimonial_text, testimonial_author,
          tutorial1Path, tutorial2Path, tutorial3Path
        ]
      );
    }

    const [updatedRows] = await pool.execute('SELECT * FROM info_accueil LIMIT 1');
    res.status(200).json(updatedRows[0]);
  } catch (error) {
    console.error('Erreur createOrUpdateInfoAccueil:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};