-- Migration: Système de Messagerie et Abonnements
-- Date: 2025-12-05
-- Description: Tables pour abonnements promoteurs, suivis et messages

-- 1. Table des abonnements promoteurs
CREATE TABLE IF NOT EXISTS abonnements_promoteurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_client INT NOT NULL,
  type_abonnement ENUM('free', 'super_promoteur', 'promoteur_ultra') DEFAULT 'free',
  prix INT DEFAULT 0,
  date_debut DATETIME,
  date_fin DATETIME,
  statut ENUM('actif', 'expire', 'annule') DEFAULT 'actif',
  transaction_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_client) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_client_statut (id_client, statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Table des suivis (utilisateurs qui suivent des promoteurs)
CREATE TABLE IF NOT EXISTS suivis_promoteurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_utilisateur INT NOT NULL,
  id_client INT NOT NULL,
  date_suivi TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  FOREIGN KEY (id_client) REFERENCES clients(id) ON DELETE CASCADE,
  UNIQUE KEY unique_follow (id_utilisateur, id_client),
  INDEX idx_client_followers (id_client),
  INDEX idx_user_following (id_utilisateur)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Table des messages
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_expediteur INT NOT NULL,
  type_expediteur ENUM('utilisateur', 'client') NOT NULL,
  id_destinataire INT NOT NULL,
  type_destinataire ENUM('utilisateur', 'client') NOT NULL,
  contenu TEXT,
  type_contenu ENUM('texte', 'image', 'video', 'fichier') DEFAULT 'texte',
  url_media VARCHAR(500),
  nom_fichier VARCHAR(255),
  taille_fichier INT,
  lu BOOLEAN DEFAULT FALSE,
  date_envoi TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation (id_expediteur, type_expediteur, id_destinataire, type_destinataire),
  INDEX idx_destinataire_lu (id_destinataire, type_destinataire, lu),
  INDEX idx_date (date_envoi DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Vue pour faciliter les requêtes de conversations
-- (Optionnelle mais utile)
