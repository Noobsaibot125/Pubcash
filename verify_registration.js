const axios = require('axios');

const API_URL = 'http://localhost:5000/api';

const testRegistration = async () => {
    try {
        // Test 1: Register Particulier
        console.log('Testing Particulier Registration...');
        const particulierData = {
            type_compte: 'particulier',
            nom: 'Test',
            prenom: 'User',
            nom_utilisateur: 'testuser_' + Date.now(),
            email: 'testuser_' + Date.now() + '@example.com',
            telephone: '0102030405',
            mot_de_passe: 'password123',
            commune: 'Cocody',
            genre: 'Homme'
        };

        try {
            const res1 = await axios.post(`${API_URL}/auth/client/register`, particulierData);
            console.log('✅ Particulier Registration Success:', res1.data.message);
        } catch (e) {
            console.error('❌ Particulier Registration Failed:', e.response ? e.response.data : e.message);
        }

        // Test 2: Register Entreprise
        console.log('\nTesting Entreprise Registration...');
        const entrepriseData = {
            type_compte: 'entreprise',
            nom_entreprise: 'Test Corp ' + Date.now(),
            rccm: 'RCCM-12345-' + Date.now(),
            email: 'testcorp_' + Date.now() + '@example.com',
            telephone: '0504030201',
            mot_de_passe: 'password123',
            commune: 'Plateau'
        };

        try {
            const res2 = await axios.post(`${API_URL}/auth/client/register`, entrepriseData);
            console.log('✅ Entreprise Registration Success:', res2.data.message);
        } catch (e) {
            console.error('❌ Entreprise Registration Failed:', e.response ? e.response.data : e.message);
        }

    } catch (error) {
        console.error('Test Script Error:', error);
    }
};

testRegistration();
