// models/JournalSuperAdmin.js
// Journal de la console Super Admin : chaque action et chaque connexion.
import { pool } from '../config/db.js';

const court = (v, n) => (v == null ? null : String(v).slice(0, n));

class JournalSuperAdmin {
    /** Ne bloque jamais l'action en cours : une erreur d'écriture est seulement affichée */
    static async noter({ id_super_admin = null, acteur_nom = null, action, cible_type = null, cible_id = null,
                         cible_nom = null, libelle, details = null, ip = null, user_agent = null }) {
        try {
            await pool.execute(
                `INSERT INTO journal_super_admin
                    (id_super_admin, acteur_nom, action, cible_type, cible_id, cible_nom, libelle, details, ip, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id_super_admin, court(acteur_nom, 120), court(action, 40), court(cible_type, 30),
                 Number.isInteger(cible_id) ? cible_id : null, court(cible_nom, 160), court(libelle, 255),
                 details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 4000),
                 court(ip, 64), court(user_agent, 255)]
            );
        } catch (e) {
            console.error('⚠️ Journal super admin non écrit :', e.message);
        }
    }

    /** Liste filtrée et paginée */
    static async liste({ action = '', q = '', jours = 30, limite = 50, page = 1 } = {}) {
        const where = ['date_action >= DATE_SUB(NOW(), INTERVAL ? DAY)'];
        const params = [Math.min(Math.max(parseInt(jours, 10) || 30, 1), 3650)];
        if (action) { where.push('action = ?'); params.push(action); }
        if (q) {
            where.push('(libelle LIKE ? OR cible_nom LIKE ? OR acteur_nom LIKE ? OR ip LIKE ?)');
            const l = `%${q}%`; params.push(l, l, l, l);
        }
        const lim = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200);
        const off = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM journal_super_admin WHERE ${where.join(' AND ')}`, params);
        const [lignes] = await pool.query(
            `SELECT id_journal, id_super_admin, acteur_nom, action, cible_type, cible_id, cible_nom, libelle, details, ip, user_agent,
                    DATE_FORMAT(date_action, '%Y-%m-%d %H:%i:%s') AS date_action
             FROM journal_super_admin WHERE ${where.join(' AND ')}
             ORDER BY date_action DESC, id_journal DESC LIMIT ${lim} OFFSET ${off}`,
            params
        );
        const [actions] = await pool.query('SELECT action, COUNT(*) AS n FROM journal_super_admin GROUP BY action ORDER BY n DESC');
        return { total: Number(total), lignes, actions };
    }
}

export default JournalSuperAdmin;
