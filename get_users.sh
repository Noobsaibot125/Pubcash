#!/bin/bash
mysql -u root pubcash_db << 'EOF'
SELECT id, nom_utilisateur, email, telephone, points, remuneration_utilisateur, commune_choisie, date_naissance 
FROM utilisateurs 
WHERE id IN (3, 4);
EOF
