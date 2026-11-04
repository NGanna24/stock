// utils/securite.js
//
// Sécurité de la connexion :
//   - jeton de session de 12 h (prolongé tant qu'on travaille, voir /utilisateur/renouveler) ;
//   - « version de session » : la changer (mot de passe modifié, « déconnecter tous les appareils »)
//     rend inutilisables TOUS les jetons déjà donnés ;
//   - 5 mauvais codes de suite → compte bloqué 15 minutes ;
//   - limite d'essais par appareil (adresse IP) sur les routes sensibles.
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const DUREE_SESSION = '12h';
export const MAX_ESSAIS = 5;
export const BLOCAGE_MINUTES = 15;

const TABLES = {
    utilisateur: { table: 'utilisateurs', cle: 'id_utilisateur' },
    employe: { table: 'employes', cle: 'id_employe' },
};
const cible = (type) => TABLES[type === 'employe' ? 'employe' : 'utilisateur'];

/** Jeton de session (contient la version de session du compte). */
export function signerJeton({ id, telephone, role, type, sv }) {
    return jwt.sign(
        { id, telephone, role, type, sv: Number(sv) || 1 },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: DUREE_SESSION }
    );
}

/** Minutes de blocage restantes (0 si le compte n'est pas bloqué). */
export async function minutesDeBlocage(type, id) {
    const { table, cle } = cible(type);
    const [rows] = await pool.query(
        `SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), bloque_jusqua) AS reste
         FROM \`${table}\` WHERE \`${cle}\` = ? AND bloque_jusqua IS NOT NULL`,
        [id]
    );
    const reste = Number(rows[0]?.reste) || 0;
    return reste > 0 ? Math.ceil(reste / 60) : 0;
}

/**
 * Note un mauvais code. Au 5e de suite, bloque le compte 15 minutes (et remet le compteur à zéro).
 * → { bloque: boolean, restants: nombre d'essais avant blocage }
 */
export async function noterEchec(type, id) {
    const { table, cle } = cible(type);
    await pool.query(`UPDATE \`${table}\` SET tentatives_echouees = tentatives_echouees + 1 WHERE \`${cle}\` = ?`, [id]);
    const [[r]] = await pool.query(`SELECT tentatives_echouees AS n FROM \`${table}\` WHERE \`${cle}\` = ?`, [id]);
    const n = Number(r?.n) || 0;
    if (n >= MAX_ESSAIS) {
        await pool.query(
            `UPDATE \`${table}\` SET tentatives_echouees = 0,
                    bloque_jusqua = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
             WHERE \`${cle}\` = ?`,
            [BLOCAGE_MINUTES, id]
        );
        return { bloque: true, restants: 0 };
    }
    return { bloque: false, restants: MAX_ESSAIS - n };
}

export async function effacerEchecs(type, id) {
    const { table, cle } = cible(type);
    await pool.query(`UPDATE \`${table}\` SET tentatives_echouees = 0, bloque_jusqua = NULL WHERE \`${cle}\` = ?`, [id]);
}

/** Version de session actuelle du compte. */
export async function versionSession(type, id) {
    const { table, cle } = cible(type);
    const [[r]] = await pool.query(`SELECT session_version AS v FROM \`${table}\` WHERE \`${cle}\` = ?`, [id]);
    return Number(r?.v) || 1;
}

/** Rend inutilisables tous les jetons déjà donnés pour ce compte. → nouvelle version */
export async function revoquerSessions(type, id, db = pool) {
    const { table, cle } = cible(type);
    await db.query(`UPDATE \`${table}\` SET session_version = session_version + 1 WHERE \`${cle}\` = ?`, [id]);
    return versionSession(type, id);
}

// ------------------------------------------------------------
// Limite d'essais par appareil (en mémoire du serveur)
// ------------------------------------------------------------
const compteurs = new Map();

/** Adresse du client (derrière nginx : première adresse de X-Forwarded-For). */
export const adresseClient = (req) =>
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '').split(',')[0].trim() || 'inconnue';

/**
 * Middleware : au plus `max` requêtes par `minutes` pour une même adresse et un même usage.
 * Ex. : limiterParAppareil('connexion', 20, 15)
 */
export function limiterParAppareil(nom, max, minutes) {
    const fenetre = minutes * 60 * 1000;
    return (req, res, next) => {
        const adresse = adresseClient(req);
        // Derrière un proxy qui ne transmet pas l'adresse réelle, tout le monde aurait la même adresse
        // (127.0.0.1…) : on ne limite pas, pour ne pas bloquer tous les utilisateurs d'un coup.
        // Le blocage par compte (5 mauvais codes) reste actif dans tous les cas.
        if (/^(127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168)\.)/.test(adresse) && !process.env.LIMITER_ADRESSES_LOCALES) {
            return next();
        }
        const cle = `${nom}|${adresse}`;
        const maintenant = Date.now();
        const liste = (compteurs.get(cle) || []).filter((t) => maintenant - t < fenetre);
        if (liste.length >= max) {
            const attente = Math.ceil((fenetre - (maintenant - liste[0])) / 60000);
            res.set('Retry-After', String(attente * 60));
            return res.status(429).json({
                success: false,
                code: 'TROP_ESSAIS',
                message: `Trop d'essais depuis cet appareil. Réessayez dans ${attente} minute${attente > 1 ? 's' : ''}.`,
            });
        }
        liste.push(maintenant);
        compteurs.set(cle, liste);
        return next();
    };
}

// Nettoyage régulier de la mémoire
setInterval(() => {
    const maintenant = Date.now();
    for (const [cle, liste] of compteurs) {
        const reste = liste.filter((t) => maintenant - t < 60 * 60 * 1000);
        if (reste.length) compteurs.set(cle, reste); else compteurs.delete(cle);
    }
}, 10 * 60 * 1000).unref?.();
