-- Migration : Création de la table notifications
-- Date : 2025-11-29
-- Description : Table pour stocker l'historique des notifications utilisateurs

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id INT NOT NULL,
  type ENUM('video_regardee', 'nouvelle_video', 'jeu_gagne', 'retrait_initie', 'retrait_complete') NOT NULL,
  titre VARCHAR(255) NOT NULL,
  contenu TEXT NOT NULL,
  donnees JSON,
  lu BOOLEAN DEFAULT FALSE,
  date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  INDEX idx_utilisateur_date (utilisateur_id, date_creation DESC),
  INDEX idx_non_lues (utilisateur_id, lu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Commentaires
ALTER TABLE notifications COMMENT = 'Historique des notifications push et in-app pour les utilisateurs';
