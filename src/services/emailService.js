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
        // --- CORRECTION CLÉ ---
        // On définit la baseUrl ICI, en se basant sur l'environnement.
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? process.env.PRODUCTION_URL 
            : process.env.DEVELOPMENT_URL;

        const templateData = {
            clientName: client.nom || 'Client',
            promotionTitle: promotion.titre,
            promotionDescription: promotion.description || 'Aucune description',
            promotionEndDate: new Date().toLocaleDateString('fr-FR', {
                year: 'numeric', month: 'long', day: 'numeric'
            }),
            historyLink: 'http://localhost:3000/client/historique',
            thumbnailUrl: promotion.thumbnail_url, // L'URL complète du thumbnail est déjà passée par le contrôleur
            
            // Maintenant, cette ligne fonctionne car baseUrl est définie juste au-dessus
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