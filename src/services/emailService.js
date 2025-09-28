// pubcash-api/src/services/emailService.js

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Configuration du "transporteur" (inchangée)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Fonction createEmailHtml (inchangée)
const createEmailHtml = (templateName, data) => {
    try {
        const templatePath = path.join(__dirname, '..', 'templates', `${templateName}.html`);
        let html = fs.readFileSync(templatePath, 'utf8');
        for (const key in data) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            html = html.replace(regex, data[key] || '');
        }
        return html;
    } catch (error) {
        console.error(`Erreur lors du chargement du template d'email ${templateName}:`, error);
        return '';
    }
};


exports.sendPromotionFinishedEmail = async (client, promotion) => {
    if (!client || !client.email || !promotion) {
        console.error("Envoi d'email annulé: données client ou promotion manquantes.");
        return;
    }

    try {
        // --- AMÉLIORATION : On vérifie que les URLs sont bien définies ---
        const devUrl = process.env.DEVELOPMENT_URL || 'http://localhost:3000'; // Fallback pour le développement
        let baseUrl = process.env.NODE_ENV === 'production' 
            ? process.env.PRODUCTION_URL 
            : devUrl;

        // Si l'URL de production n'est pas définie, on log une erreur claire !
        if (process.env.NODE_ENV === 'production' && !process.env.PRODUCTION_URL) {
            console.error('ERREUR CRITIQUE : La variable d\'environnement PRODUCTION_URL n\'est pas définie ! Les liens dans les emails seront cassés.');
            // On peut utiliser une valeur par défaut pour ne pas faire planter l'envoi
            baseUrl = 'https://pub-cash.com'; 
        }
    
        const templateData = {
            clientName: client.nom || 'Client',
            promotionTitle: promotion.titre,
            promotionDescription: promotion.description || 'Aucune description',
            promotionEndDate: new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
            historyLink: `${baseUrl}/client/historique`,
            thumbnailUrl: promotion.thumbnail_url || '', // S'assurer qu'il y a une valeur
            pubcashLogoUrl: `${baseUrl}/uploads/pubcash-logo.png`
        };
        
        const htmlContent = createEmailHtml('promotionTerminee', templateData);

        if (!htmlContent) {
            throw new Error("Le contenu de l'email est vide après traitement du template.");
        }

        await transporter.sendMail({
            from: `"L'équipe PubCash" <${process.env.EMAIL_USER}>`,
            to: client.email,
            subject: `Votre promotion "${promotion.titre}" est terminée`,
            html: htmlContent,
        });

        console.log(`Email de fin de promotion envoyé avec succès à ${client.email}`);

    } catch (error) {
        console.error("Erreur lors de l'envoi de l'email de fin de promotion:", error);
    }
};