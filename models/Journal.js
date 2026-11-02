// models/Journal.js
// Lecture du journal d'activité (l'écriture est faite par middleware/journal.js).
import { pool } from '../config/db.js';

const DUREE_CONSERVATION_JOURS = 365;
let dernierePurge = 0;

const ACTIONS_VALIDES = ['connexion', 'creation', 'modification', 'suppression', 'annulation', 'paiement',
    'statut', 'ouverture', 'cloture', 'validation', 'refus', 'securite', 'relance', 'autre'];

class Journal {
    /** Construit le WHERE commun (liste, total, facettes). */
    static _filtres(idUtilisateur, f = {}) {
        const where = ['j.id_utilisateur = ?'];
        const params = [idUtilisateur];
        if (f.dateDebut) { where.push('j.date_action >= ?'); params.push(`${f.dateDebut} 00:00:00`); }
        if (f.dateFin) { where.push('j.date_action <= ?'); params.push(`${f.dateFin} 23:59:59`); }
        if (f.acteur) {
            const [type, id] = String(f.acteur).split(':');
            if (['utilisateur', 'employe'].includes(type) && /^\d+$/.test(id || '')) {
                where.push('j.acteur_type = ? AND j.acteur_id = ?');
                params.push(type, Number(id));
            }
        }
        if (f.module) { where.push('j.module = ?'); params.push(String(f.module)); }
        if (f.action && ACTIONS_VALIDES.includes(f.action)) { where.push('j.action = ?'); params.push(f.action); }
        if (f.search && String(f.search).trim()) {
            const s = `%${String(f.search).trim()}%`;
            where.push('(j.libelle LIKE ? OR j.reference LIKE ? OR j.acteur_nom LIKE ? OR j.module LIKE ?)');
            params.push(s, s, s, s);
        }
        return { where: where.join(' AND '), params };
    }

    static async lister(idUtilisateur, f = {}) {
        await Journal.purgerSiBesoin();
        const limite = Math.min(Math.max(parseInt(f.limit, 10) || 50, 1), 500);
        const page = Math.max(parseInt(f.page, 10) || 1, 1);
        const { where, params } = Journal._filtres(idUtilisateur, f);

        const [rows] = await pool.query(
            `SELECT j.id_journal, j.acteur_type, j.acteur_id, j.acteur_nom, j.acteur_role, j.action, j.module,
                    j.libelle, j.reference, j.entite_id, j.methode, j.chemin, j.statut_http, j.ip,
                    j.date_action
             FROM journal_activite j
             WHERE ${where}
             ORDER BY j.date_action DESC, j.id_journal DESC
             LIMIT ? OFFSET ?`,
            [...params, limite, (page - 1) * limite]
        );
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM journal_activite j WHERE ${where}`, params
        );
        return { lignes: rows, total: Number(total), page, limit: limite, pages: Math.max(1, Math.ceil(total / limite)) };
    }

    /** Tout (sans pagination, max 5000) pour l'export CSV. */
    static async exporter(idUtilisateur, f = {}) {
        const { where, params } = Journal._filtres(idUtilisateur, f);
        const [rows] = await pool.query(
            `SELECT j.date_action, j.acteur_nom, j.acteur_role, j.acteur_type, j.module, j.action, j.libelle,
                    j.reference, j.ip
             FROM journal_activite j WHERE ${where}
             ORDER BY j.date_action DESC, j.id_journal DESC LIMIT 5000`,
            params
        );
        return rows;
    }

    static async detail(idUtilisateur, idJournal) {
        const [rows] = await pool.query(
            'SELECT * FROM journal_activite WHERE id_journal = ? AND id_utilisateur = ?',
            [idJournal, idUtilisateur]
        );
        const ligne = rows[0];
        if (!ligne) return null;
        try { ligne.details = ligne.details ? JSON.parse(ligne.details) : null; } catch { /* texte brut */ }
        return ligne;
    }

    /** Listes pour les filtres + petits compteurs de la période. */
    static async facettes(idUtilisateur, f = {}) {
        const { where, params } = Journal._filtres(idUtilisateur, { dateDebut: f.dateDebut, dateFin: f.dateFin });
        const [acteurs] = await pool.query(
            `SELECT j.acteur_type, j.acteur_id, MAX(j.acteur_nom) AS acteur_nom, MAX(j.acteur_role) AS acteur_role,
                    COUNT(*) AS nb
             FROM journal_activite j WHERE ${where}
             GROUP BY j.acteur_type, j.acteur_id ORDER BY nb DESC`,
            params
        );
        const [modules] = await pool.query(
            `SELECT j.module, COUNT(*) AS nb FROM journal_activite j WHERE ${where}
             GROUP BY j.module ORDER BY nb DESC`,
            params
        );
        const [actions] = await pool.query(
            `SELECT j.action, COUNT(*) AS nb FROM journal_activite j WHERE ${where}
             GROUP BY j.action ORDER BY nb DESC`,
            params
        );
        const total = actions.reduce((s, a) => s + Number(a.nb), 0);
        return {
            acteurs: acteurs.map((a) => ({ ...a, nb: Number(a.nb) })),
            modules: modules.map((m) => ({ ...m, nb: Number(m.nb) })),
            actions: actions.map((a) => ({ ...a, nb: Number(a.nb) })),
            total,
        };
    }

    /** Supprime les lignes de plus d'un an (au plus une fois par jour). */
    static async purgerSiBesoin() {
        if (Date.now() - dernierePurge < 24 * 3600 * 1000) return;
        dernierePurge = Date.now();
        try {
            await pool.query(
                'DELETE FROM journal_activite WHERE date_action < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)',
                [DUREE_CONSERVATION_JOURS]
            );
        } catch (e) {
            console.error('⚠️ [journal] purge :', e.message);
        }
    }
}

export default Journal;
