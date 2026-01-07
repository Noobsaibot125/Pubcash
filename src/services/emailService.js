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

/**
 * Envoyer un email pour informer le client que son rechargement a échoué
 */
exports.sendRechargeFailedEmail = async (client, transactionId, amount) => {
    if (!client || !client.email) {
        console.error("Envoi d'email annulé: données client manquantes.");
        return;
    }

    try {
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #dc3545, #c82333); padding: 30px; text-align: center; }
                .header img { max-width: 120px; margin-bottom: 15px; }
                .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
                .content { padding: 30px; }
                .content h2 { color: #dc3545; margin-top: 0; }
                .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .details p { margin: 10px 0; color: #555; }
                .details strong { color: #333; }
                .cta { text-align: center; margin: 30px 0; }
                .cta a { display: inline-block; background: #28a745; color: #fff; padding: 15px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #777; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>❌ Échec du Rechargement</h1>
                </div>
                <div class="content">
                    <h2>Bonjour ${client.prenom || client.nom || 'Client'},</h2>
                    <p>Nous vous informons que votre tentative de rechargement de compte PubCash n'a malheureusement pas abouti.</p>
                    
                    <div class="details">
                        <p><strong>ID Transaction :</strong> ${transactionId}</p>
                        <p><strong>Montant tenté :</strong> ${parseFloat(amount).toLocaleString('fr-FR')} FCFA</p>
                        <p><strong>Date :</strong> ${new Date().toLocaleDateString('fr-FR', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })}</p>
                    </div>

                    <p><strong>Raisons possibles :</strong></p>
                    <ul>
                        <li>Solde insuffisant sur votre compte mobile money</li>
                        <li>Numéro de téléphone invalide</li>
                        <li>Délai d'expiration dépassé</li>
                        <li>Annulation manuelle de la transaction</li>
                    </ul>

                    <div class="cta">
                        <a href="https://pub-cash.com/client/moncompte">Réessayer le rechargement</a>
                    </div>

                    <p>Si vous pensez que cette erreur n'est pas normale, n'hésitez pas à contacter notre support.</p>
                </div>
                <div class="footer">
                    <p>© 2026 PubCash - Tous droits réservés</p>
                    <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
            from: `"L'équipe PubCash" <${process.env.EMAIL_USER}>`,
            to: client.email,
            subject: `❌ Échec de votre rechargement PubCash`,
            html: htmlContent,
        });

        console.log(`Email d'échec de rechargement envoyé avec succès à ${client.email}`);

    } catch (error) {
        console.error("Erreur lors de l'envoi de l'email d'échec de rechargement:", error);
    }
};

/**
 * Envoyer un email pour confirmer un rechargement réussi
 */
exports.sendRechargeSuccessEmail = async (client, transactionId, amount, newBalance) => {
    if (!client || !client.email) {
        console.error("Envoi d'email annulé: données client manquantes.");
        return;
    }

    try {
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #28a745, #20c997); padding: 30px; text-align: center; }
                .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
                .content { padding: 30px; }
                .content h2 { color: #28a745; margin-top: 0; }
                .details { background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
                .details p { margin: 10px 0; color: #155724; }
                .balance-box { text-align: center; background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0; }
                .balance-box .amount { font-size: 36px; font-weight: bold; color: #28a745; }
                .cta { text-align: center; margin: 30px 0; }
                .cta a { display: inline-block; background: #FF5722; color: #fff; padding: 15px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #777; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>✅ Rechargement Réussi !</h1>
                </div>
                <div class="content">
                    <h2>Félicitations ${client.prenom || client.nom || 'Client'} !</h2>
                    <p>Votre compte PubCash a été rechargé avec succès.</p>
                    
                    <div class="details">
                        <p><strong>ID Transaction :</strong> ${transactionId}</p>
                        <p><strong>Montant rechargé :</strong> +${parseFloat(amount).toLocaleString('fr-FR')} FCFA</p>
                        <p><strong>Date :</strong> ${new Date().toLocaleDateString('fr-FR', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })}</p>
                    </div>

                    <div class="balance-box">
                        <p style="margin: 0; color: #666;">Votre nouveau solde PubCash</p>
                        <p class="amount">${parseFloat(newBalance).toLocaleString('fr-FR')} FCFA</p>
                    </div>

                    <div class="cta">
                        <a href="https://pub-cash.com/client/promotions">Créer une promotion</a>
                    </div>
                </div>
                <div class="footer">
                    <p>© 2026 PubCash - Tous droits réservés</p>
                    <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
            from: `"L'équipe PubCash" <${process.env.EMAIL_USER}>`,
            to: client.email,
            subject: `✅ Rechargement PubCash de ${parseFloat(amount).toLocaleString('fr-FR')} FCFA confirmé`,
            html: htmlContent,
        });

        console.log(`Email de confirmation de rechargement envoyé avec succès à ${client.email}`);

    } catch (error) {
        console.error("Erreur lors de l'envoi de l'email de confirmation:", error);
    }
};

/**
 * Envoyer un email pour confirmer un rechargement admin (portefeuille distribution)
 */
exports.sendAdminRechargeSuccessEmail = async (admin, transactionId, amount, newBalance) => {
    if (!admin || !admin.email) {
        console.error("Envoi d'email annulé: données admin manquantes.");
        return;
    }

    try {
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #5e72e4, #825ee4); padding: 30px; text-align: center; }
                .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
                .content { padding: 30px; }
                .content h2 { color: #5e72e4; margin-top: 0; }
                .details { background: #e8e8ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #5e72e4; }
                .details p { margin: 10px 0; color: #333; }
                .balance-box { text-align: center; background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0; }
                .balance-box .amount { font-size: 36px; font-weight: bold; color: #5e72e4; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #777; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>💼 Portefeuille Distribution Rechargé</h1>
                </div>
                <div class="content">
                    <h2>Bonjour ${admin.nom_utilisateur || 'Administrateur'},</h2>
                    <p>Votre portefeuille de distribution a été rechargé avec succès.</p>
                    
                    <div class="details">
                        <p><strong>ID Transaction :</strong> ${transactionId}</p>
                        <p><strong>Montant rechargé :</strong> +${parseFloat(amount).toLocaleString('fr-FR')} FCFA</p>
                        <p><strong>Date :</strong> ${new Date().toLocaleDateString('fr-FR', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })}</p>
                    </div>

                    <div class="balance-box">
                        <p style="margin: 0; color: #666;">Nouveau solde Distribution</p>
                        <p class="amount">${parseFloat(newBalance).toLocaleString('fr-FR')} FCFA</p>
                    </div>

                    <p>Ce montant est maintenant disponible pour créditer les comptes clients et récompenser les utilisateurs.</p>
                </div>
                <div class="footer">
                    <p>© 2026 PubCash Administration - Tous droits réservés</p>
                    <p>Cet email a été envoyé automatiquement.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
            from: `"PubCash Admin" <${process.env.EMAIL_USER}>`,
            to: admin.email,
            subject: `💼 Portefeuille Distribution rechargé de ${parseFloat(amount).toLocaleString('fr-FR')} FCFA`,
            html: htmlContent,
        });

        console.log(`Email de confirmation recharge admin envoyé à ${admin.email}`);

    } catch (error) {
        console.error("Erreur lors de l'envoi de l'email admin:", error);
    }
};