// hash.js

const bcrypt = require('bcryptjs');

// Le mot de passe que vous voulez utiliser
const password = 'motdepassesecurise'; 

// Cette fonction va le hacher et l'afficher
bcrypt.hash(password, 10, (err, hash) => {
  if (err) throw err;
  console.log('--- COPIEZ CE HASH CI-DESSOUS ---');
  console.log(hash);
  console.log('------------------------------------');
});