#!/usr/bin/env python3
import paramiko
import json

HOST = "31.97.68.170"
USERNAME = "root"
PASSWORD = "KKStechnologies2022@#"

def test_cinetpay_auth():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        print(f"🔌 Connexion à {HOST}...")
        client.connect(HOST, 22, USERNAME, PASSWORD)
        print("✅ Connecté!\n")
        
        # Script Node.js pour tester l'auth CinetPay
        test_script = """
const axios = require('axios');
const FormData = require('form-data');

async function testAuth() {
    const formData = new FormData();
    
    // Identifiants exacts du .env
    const apikey = '521006956621e4e7a6a3d16.70681548';
    const password = 'KKStechnologies2022@';
    
    formData.append('apikey', apikey.trim());
    formData.append('password', password.trim());
    
    console.log('📤 Test authentification CinetPay Transfer API...');
    console.log('API Key (premiers 15 car):', apikey.substring(0, 15) + '...');
    console.log('Password (premiers 7 car):', password.substring(0, 7) + '...');
    console.log('Endpoint: https://client.cinetpay.com/v1/auth/login');
    console.log('');
    
    try {
        const response = await axios.post(
            'https://client.cinetpay.com/v1/auth/login',
            formData,
            { 
                headers: formData.getHeaders(),
                timeout: 10000
            }
        );
        
        console.log('✅ ✅ ✅ SUCCÈS! Authentification réussie!');
        console.log('Code:', response.data.code);
        console.log('Message:', response.data.message);
        if (response.data.data?.token) {
            console.log('Token reçu (20 premiers car):', response.data.data.token.substring(0, 20) + '...');
        }
        console.log('');
        console.log('CONCLUSION: Les identifiants sont VALIDES!');
        
    } catch (error) {
        console.log('❌ ❌ ❌ ERREUR! Authentification échouée!');
        console.log('');
        if (error.response) {
            console.log('Status HTTP:', error.response.status);
            console.log('Code erreur:', error.response.data.code);
            console.log('Message:', error.response.data.message);
            console.log('Description:', error.response.data.description);
            console.log('');
            console.log('Réponse complète:', JSON.stringify(error.response.data, null, 2));
            console.log('');
            
            if (error.response.data.code === '701') {
                console.log('DIAGNOSTIC: Erreur 701 = INVALID_CREDENTIALS');
                console.log('Causes possibles:');
                console.log('  1. API_KEY incorrecte');
                console.log('  2. Mot de passe API incorrect ou non défini dans CinetPay');
                console.log('  3. Compte temporairement bloqué');
                console.log('  4. Espaces invisibles dans les identifiants');
            }
        } else if (error.request) {
            console.log('Erreur réseau - Pas de réponse du serveur');
            console.log('Détails:', error.message);
        } else {
            console.log('Erreur:', error.message);
        }
    }
}

testAuth().catch(err => console.error('Erreur fatale:', err));
"""
        
        # Créer le fichier de test dans le dossier du projet
        print("📝 Création du script de test...")
        stdin, stdout, stderr = client.exec_command(
            f"cat > /var/www/Pubcash/test_cinetpay_direct.js << 'EOL'\n{test_script}\nEOL"
        )
        stdout.channel.recv_exit_status()
        
        # Exécuter le test depuis le dossier projet (avec node_modules)
        print("🚀 Exécution du test d'authentification...\n")
        print("=" * 70)
        stdin, stdout, stderr = client.exec_command(
            "cd /var/www/Pubcash && node test_cinetpay_direct.js"
        )
        
        # Attendre la fin et afficher le résultat
        exit_status = stdout.channel.recv_exit_status()
        output = stdout.read().decode()
        error = stderr.read().decode()
        
        if output:
            print(output)
        if error:
            print("STDERR:", error)
        
        print("=" * 70)
        print(f"\n✅ Test terminé! (Exit code: {exit_status})")
        
        # Cleanup
        print("\n🧹 Nettoyage...")
        client.exec_command("rm /var/www/Pubcash/test_cinetpay_direct.js")
        
    except Exception as e:
        print(f"❌ Erreur Python: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    test_cinetpay_auth()
