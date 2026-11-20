// controllers/NotificationController.js
// Enregistrement des téléphones pour les notifications push (application Miyo).
import { pool } from '../config/db.js';
import { envoyer, envoyerResume } from '../Services/notificationsPush.js';

const JETON_VALIDE = /^(Exponent|Expo)PushToken\[[^\]]{10,160}\]$/;

const lireJeton = (req) => String(req.body?.jeton || '').trim();

class NotificationController {
    /** POST /api/notifications/appareils  { jeton, plateforme } */
    static async enregistrer(req, res) {
        try {
            const jeton = lireJeton(req);
            if (!JETON_VALIDE.test(jeton)) {
                return res.status(400).json({ success: false, message: 'Identifiant de téléphone invalide' });
            }
            const plateforme = String(req.body?.plateforme || '').slice(0, 20) || null;
            const type = req.user.type === 'employe' ? 'employe' : 'utilisateur';
            // Un même téléphone peut changer de compte : on le rattache au compte connecté
            await pool.query(
                `INSERT INTO appareils_push (id_utilisateur, type_compte, id_employe, jeton, plateforme, actif)
                 VALUES (?, ?, ?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE id_utilisateur = VALUES(id_utilisateur), type_compte = VALUES(type_compte),
                     id_employe = VALUES(id_employe), plateforme = VALUES(plateforme), actif = 1`,
                [req.user.id_utilisateur, type, req.user.id_employe || null, jeton, plateforme]
            );
            return res.json({ success: true });
        } catch (e) {
            console.error('❌ [Push] enregistrement :', e.message);
            return res.status(500).json({ success: false, message: "Impossible d'activer les notifications" });
        }
    }

    /** DELETE /api/notifications/appareils  { jeton } — à la déconnexion */
    static async retirer(req, res) {
        try {
            const jeton = lireJeton(req);
            if (jeton) {
                await pool.query('DELETE FROM appareils_push WHERE jeton = ? AND id_utilisateur = ?', [jeton, req.user.id_utilisateur]);
            }
            return res.json({ success: true });
        } catch (e) {
            console.error('❌ [Push] retrait :', e.message);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /** POST /api/notifications/test  { jeton? } — vérifie que ce téléphone reçoit bien */
    static async tester(req, res) {
        try {
            const jeton = lireJeton(req);
            const [rows] = jeton
                ? await pool.query('SELECT jeton FROM appareils_push WHERE jeton = ? AND id_utilisateur = ? AND actif = 1', [jeton, req.user.id_utilisateur])
                : await pool.query(
                    `SELECT jeton FROM appareils_push WHERE id_utilisateur = ? AND actif = 1
                       AND type_compte = ? AND (id_employe <=> ?)`,
                    [req.user.id_utilisateur, req.user.type === 'employe' ? 'employe' : 'utilisateur', req.user.id_employe || null]
                );
            if (!rows.length) {
                return res.status(404).json({ success: false, message: "Aucun téléphone enregistré pour ce compte. Ouvrez l'application Miyo sur le téléphone et acceptez les notifications." });
            }
            const { envoyes } = await envoyer(rows.map((r) => r.jeton), {
                titre: 'Miyo',
                texte: 'Les notifications fonctionnent sur ce téléphone.',
                donnees: { type: 'test' },
            });
            return res.json({ success: envoyes > 0, envoyes, message: envoyes ? 'Notification envoyée' : "Expo n'a pas accepté l'envoi" });
        } catch (e) {
            console.error('❌ [Push] test :', e.message);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /** POST /api/notifications/test-resume — envoie tout de suite le résumé du jour (patron) */
    static async testerResume(req, res) {
        try {
            if (req.user.type === 'employe') return res.status(403).json({ success: false, message: 'Réservé au propriétaire' });
            const envoyes = await envoyerResume(req.user.id_utilisateur, undefined, true);
            return res.json({ success: envoyes > 0, envoyes });
        } catch (e) {
            console.error('❌ [Push] test résumé :', e.message);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }
}

export default NotificationController;
