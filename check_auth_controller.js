try {
    const authController = require('./src/controllers/authController');
    console.log('authController loaded successfully');
} catch (e) {
    console.error('Error loading authController:', e);
}
