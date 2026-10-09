// services/emailService.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// ============================================================
// NETTOYAGE DES CREDENTIALS
// ============================================================
const EMAIL_USER = (process.env.EMAIL_USER || '').trim();
const EMAIL_APP_PASSWORD_RAW = process.env.EMAIL_APP_PASSWORD || '';
const EMAIL_APP_PASSWORD = EMAIL_APP_PASSWORD_RAW.replace(/\s/g, '').trim();


// ============================================================
// TRANSPORTEUR
// ============================================================
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_APP_PASSWORD
    },
    // ✅ Logs de debug SMTP (très utiles pour diagnostiquer)
    logger: true,
    debug: true
});

// ============================================================
// ✅ VÉRIFICATION DE LA CONNEXION SMTP AU DÉMARRAGE
// ============================================================
(async () => {
    // Ne vérifier que si les credentials sont présents
    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
        console.log('⚠️ [EMAIL-VERIFY] Credentials manquants → vérification ignorée');
        return;
    }

    if (process.env.NODE_ENV === 'development' && !EMAIL_USER) {
        console.log('⚠️ [EMAIL-VERIFY] Mode dev sans credentials → vérification ignorée');
        return;
    }

    try {
        await transporter.verify();
        console.log('✅ [EMAIL-VERIFY] Connexion SMTP OK ! Gmail accepte les credentials.');
    } catch (error) {
        console.log('');
        console.log('❌ [EMAIL-VERIFY] ÉCHEC de la connexion SMTP');
       
        if (error.response && error.response.includes('535')) {
            console.log('   → Google rejette les identifiants.');
           
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION') {
           
        }
        console.log('');
    }
})();

// ============================================================
// ENVOI D'EMAIL
// ============================================================
export async function sendEmail({ to, subject, html, text }) {
    console.log('');
   

    // Mode dev sans credentials : log uniquement
    if (process.env.NODE_ENV === 'development' && !EMAIL_USER) {
        console.log('📧 [EMAIL-DEV] Mode développement → email NON envoyé');
      
        return { success: true, dev: true };
    }

    try {
        console.log('📧 Envoi en cours...');
        const info = await transporter.sendMail({
            from: `"Miyo Stock" <${EMAIL_USER}>`,
            to,
            subject,
            text,
            html
        });

        console.log('');
       
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.log('');
       
        // Diagnostic automatique
        if (error.response && error.response.includes('535')) {
            console.log('💡 DIAGNOSTIC : Google refuse les identifiants (BadCredentials)');
           
        } else if (error.code === 'EAUTH') {
            console.log('💡 DIAGNOSTIC : Erreur d\'authentification');
           
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            console.log('💡 DIAGNOSTIC : Problème réseau');
            
        }

        console.log('═══════════════════════════════════════════════════');
        console.log('');

        return { success: false, error: error.message };
    }
}

// ============================================================
// ENVOI DU CODE DE RÉINITIALISATION
// ============================================================
export async function sendResetCode(email, code, fullname = '') {
    const subject = 'Miyo Réinitialisation de votre mot de passe';

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
            .container { max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
            .header { background: linear-gradient(135deg, #3D2E1F, #8A7560); padding: 30px; text-align: center; color: white; }
            .header h1 { margin: 0; font-size: 22px; }
            .body { padding: 30px; color: #333; }
            .body p { line-height: 1.6; margin: 12px 0; }
            .code-box { background: #f3f4f6; border: 2px dashed #3D2E1F; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0; }
            .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3D2E1F; font-family: 'Courier New', monospace; }
            .warning { background: #fef3c7; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #92400e; margin-top: 20px; }
            .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; background: #f9fafb; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Miyo</h1>
            </div>
            <div class="body">
                <p>Bonjour${fullname ? ' <strong>' + fullname + '</strong>' : ''},</p>
                <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
                <p>Voici votre code de vérification :</p>

                <div class="code-box">
                    <div class="code">${code}</div>
                </div>

                <p>Ce code est valable pendant <strong>15 minutes</strong>.</p>

                <div class="warning">
                    Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. 
                    Ne partagez jamais ce code avec qui que ce soit.
                </div>
            </div>
            <div class="footer">
                © 2026 Miyo Stock. Tous droits réservés.
            </div>
        </div>
    </body>
    </html>
    `;

    const text = `Miyo Stock - Votre code de réinitialisation est : ${code}\n\nValable 15 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`;

    return sendEmail({ to: email, subject, html, text });
}