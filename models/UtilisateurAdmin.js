// models/UtilisateurAdmin.js
import { pool } from '../config/db.js';

function safeInt(value, def, min = 1, max = 5000) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(n, max));
}

class UtilisateurAdmin {
    // ============================================================
    // 📋 LISTE PAGINÉE + FILTRES
    // ============================================================
    static async getListe(options = {}) {
        const {
            page = 1,
            limit = 20,
            search = '',
            statut = 'tous',          // 'tous' | 'actif' | 'inactif'
            jamaisConnecte = false,
        } = options;

        const p = safeInt(page, 1, 1, 100000);
        const l = safeInt(limit, 20, 1, 200);
        const offset = (p - 1) * l;

        const where = ['1=1'];
        const params = [];

        if (search && search.trim()) {
            where.push('(u.fullname LIKE ? OR u.email LIKE ? OR u.telephone LIKE ? OR u.slug LIKE ?)');
            const q = `%${search.trim()}%`;
            params.push(q, q, q, q);
        }
        if (statut === 'actif')   where.push('u.actif = TRUE');
        if (statut === 'inactif') where.push('u.actif = FALSE');
        if (jamaisConnecte)       where.push('u.derniere_connexion IS NULL');

        const whereSql = where.join(' AND ');

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total FROM utilisateurs u WHERE ${whereSql}`,
            params
        );
        const total = parseInt(countRows[0]?.total || 0, 10);

        const [rows] = await pool.query(
            `SELECT
                u.id_utilisateur,
                u.fullname,
                u.email,
                u.telephone,
                u.slug,
                u.actif,
                u.date_creation,
                u.derniere_connexion,
                r.nom AS role,
                m.id_magasin,
                m.nom_commercial AS nom_magasin,
                m.logo_url       AS logo_magasin,
                m.ville          AS ville_magasin,
                m.pays           AS pays_magasin
             FROM utilisateurs u
             LEFT JOIN roles r ON u.id_role = r.id_role
             LEFT JOIN magasins m ON m.id_utilisateur = u.id_utilisateur
             WHERE ${whereSql}
             ORDER BY u.date_creation DESC
             LIMIT ? OFFSET ?`,
            [...params, l, offset]
        );

        return {
            total,
            page: p,
            limit: l,
            totalPages: Math.ceil(total / l),
            utilisateurs: rows,
        };
    }

    // ============================================================
    // 📊 STATS (header)
    // ============================================================
    static async getStats() {
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN actif = TRUE THEN 1 ELSE 0 END) AS total_actifs,
                SUM(CASE WHEN actif = FALSE THEN 1 ELSE 0 END) AS total_inactifs,
                SUM(CASE WHEN date_creation >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS nouveaux_7j,
                SUM(CASE WHEN derniere_connexion IS NULL THEN 1 ELSE 0 END) AS jamais_connectes
            FROM utilisateurs
        `);
        return rows[0] || {};
    }

    // ============================================================
    // 🔍 DÉTAIL UTILISATEUR + MAGASINS + STATS
    // ============================================================
    static async getDetail(id_utilisateur) {
        const [userRows] = await pool.query(
            `SELECT
                u.id_utilisateur,
                u.fullname,
                u.email,
                u.telephone,
                u.slug,
                u.actif,
                u.date_creation,
                u.derniere_connexion,
                r.nom AS role
             FROM utilisateurs u
             LEFT JOIN roles r ON u.id_role = r.id_role
             WHERE u.id_utilisateur = ?
             LIMIT 1`,
            [id_utilisateur]
        );

        if (!userRows[0]) return null;

        const [magasins] = await pool.query(
            `SELECT
                id_magasin,
                nom_commercial,
                logo_url,
                ville,
                pays,
                quartier,
                telephone,
                email,
                latitude,
                longitude,
                actif,
                date_creation
             FROM magasins
             WHERE id_utilisateur = ?
             ORDER BY date_creation DESC`,
            [id_utilisateur]
        );

        const [stats] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM produits        WHERE id_utilisateur = ?) AS nb_produits,
                (SELECT COUNT(*) FROM clients         WHERE id_utilisateur = ?) AS nb_clients,
                (SELECT COUNT(*) FROM commandes_vente WHERE id_utilisateur = ?) AS nb_commandes,
                (SELECT COUNT(*) FROM factures_vente  WHERE id_utilisateur = ?) AS nb_factures,
                (SELECT COUNT(*) FROM employes        WHERE id_utilisateur = ?) AS nb_employes,
                (SELECT COUNT(*) FROM fournisseurs    WHERE id_utilisateur = ?) AS nb_fournisseurs`,
            [id_utilisateur, id_utilisateur, id_utilisateur,
             id_utilisateur, id_utilisateur, id_utilisateur]
        );

        // Normaliser lat/lng pour chaque magasin
        const magasinsClean = magasins.map((m) => ({
            ...m,
            latitude:  m.latitude  != null ? parseFloat(m.latitude)  : null,
            longitude: m.longitude != null ? parseFloat(m.longitude) : null,
        }));

        return {
            utilisateur: userRows[0],
            magasins: magasinsClean,
            stats: stats[0] || {},
        };
    }

    // ============================================================
    // 🛠️ ACTIONS
    // ============================================================
    static async toggleActif(id_utilisateur, actif) {
        const [result] = await pool.query(
            `UPDATE utilisateurs SET actif = ? WHERE id_utilisateur = ?`,
            [actif ? 1 : 0, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    // ============================================================
    // 📅 INACTIFS (dernière connexion > X jours)
    // ============================================================
    static async getInactifs(days = 30) {
        const d = safeInt(days, 30, 1, 365);
        const [rows] = await pool.query(
            `SELECT
                u.id_utilisateur,
                u.fullname,
                u.email,
                u.telephone,
                u.slug,
                u.date_creation,
                u.derniere_connexion,
                m.nom_commercial AS nom_magasin,
                m.ville,
                m.pays,
                DATEDIFF(NOW(), COALESCE(u.derniere_connexion, u.date_creation)) AS jours_inactif
             FROM utilisateurs u
             LEFT JOIN magasins m ON m.id_utilisateur = u.id_utilisateur
             WHERE u.actif = TRUE
               AND (u.derniere_connexion IS NULL
                    OR u.derniere_connexion < DATE_SUB(NOW(), INTERVAL ? DAY))
             ORDER BY u.derniere_connexion ASC`,
            [d]
        );
        return rows;
    }
}

export default UtilisateurAdmin;