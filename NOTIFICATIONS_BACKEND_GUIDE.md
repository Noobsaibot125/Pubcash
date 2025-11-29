# Instructions pour Ajouter les Notifications - Backend

## 1. Import du service (FAIT ✅)
En haut de `promotionController.js`, après la ligne 7-8:
```javascript
const notificationService = require('../services/notificationService');
```

## 2. Notification "Vidéo Regardée" 
**Fichier**: `promotionController.js`
**Fonction**: `viewPromotion`
**Ligne**: Après la ligne 374 (après `INSERT INTO user_gains`)

Ajouter:
```javascript
// Envoyer notification de gain
await notificationService.envoyerNotification(
  userId,
  'video_regardee',
  'Vidéo visionnée !',
  `Vous avez gagné ${montant} FCFA`,
  { montant, promotion_id: promotionId }
).catch(err => console.error('Erreur notification:', err));
```

## 3. Notification "Nouvelle Vidéo"
**Fichier**: `promotionController.js`  
**Fonction**: `createPromotion` (à trouver, probablement vers les lignes 800-900)
**Emplacement**: Après la création de la promotion

Ajouter:
```javascript
// Récupérer les utilisateurs des communes ciblées
const targetCommunes = [/* communes de la promotion */];
const userIds = await notificationService.getUtilisateursByCommunes(targetCommunes);

// Envoyer notification à tous
await notificationService.envoyerNotificationMultiple(
  userIds,
  'nouvelle_video',
  `${nomPromoteur} A publié une nouvelle vidéo 📺`,
  'Nouvelle vidéo disponible',
  { promotion_id: nouvellePromoId, promoteur: nomPromoteur }
).catch(err => console.error('Erreur notification multiple:', err));
```

## 4. Notification "Retrait Initié"
**Fichier**: `promotionController.js`
**Fonction**: `withdrawEarnings`
**Ligne**: Après la ligne 702 (après INSERT INTO demandes_retrait)

Ajouter:
```javascript
// Notification retrait initié
await notificationService.envoyerNotification(
  userId,
  'retrait_initie',
  'Demande de retrait',
  `En cours de traitement... ${withdrawalAmount} Fcfa`,
  { montant: withdrawalAmount, transaction_id: transactionId }
).catch(err => console.error('Erreur notification:', err));
```

## 5. Notification "Retrait Complété"
**Fichier**: `promotionController.js`
**Fonction**: `withdrawEarnings`
**Ligne**: Après la ligne 776 (après UPDATE demandes_retrait SET statut = 'traite')

Ajouter:
```javascript
// Notification retrait validé
await notificationService.envoyerNotification(
  userId,
  'retrait_complete',
  'Demande de retrait',
  `Validé ✓ ${withdrawalAmount} Fcfa`,
  { montant: withdrawalAmount, transaction_id: transactionId, statut: 'succes' }
).catch(err => console.error('Erreur notification:', err));
```

## 6. Notification "Jeu Gagné"
**Fichier**: `gameController.js`
**Emplacement**: Après attribution des points de jeu

Ajouter:
```javascript
const notificationService = require('../services/notificationService');

// Dans la fonction où on attribue les points du jeu
await notificationService.envoyerNotification(
  userId,
  'jeu_gagne'

,
  `${nomJeu}, Vous avez reçu ${points} pts`,
  `Félicitations pour votre victoire !`,
  { points, game_id: gameId, game_type: typeJeu }
).catch(err => console.error('Erreur notification:', err));
```

---

## Notes Importantes

1. **Toutes les notifications utilisent `.catch()`** pour éviter qu'une erreur de notification ne bloque la transaction principale
2. **Firebase Admin** doit être configuré dans `.env` avec:
   - `FCM_PROJECT_ID`
   - `FCM_PRIVATE_KEY`
   - `FCM_CLIENT_EMAIL`
3. **Installer la dépendance**: `npm install firebase-admin`
4. **Exécuter le script SQL**: Créer la table `notifications` d'abord
