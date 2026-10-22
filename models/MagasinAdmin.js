// models/MagasinAdmin.js
import { pool } from '../config/db.js';

function safeInt(value, def, min = 1, max = 5000) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(n, max));
}

class MagasinAdmin {
    // ============================================================
    // 📋 LISTE PAGINÉE + FILTRES
    // ============================================================
    static async getListe(options = {}) {
        const {
            page = 1,
            limit = 20,
            search = '',
            statut = 'tous',        // 'tous' | 'actif' | 'inactif'
            geolocalise = 'tous',   // 'tous' | 'oui' | 'non'
            pays = null,
            ville = null,
            orderBy = 'date_creation',
            orderDir = 'desc',
        } = options;

        const p = safeInt(page, 1, 1, 100000);
        const l = safeInt(limit, 20, 1, 200);
        const offset = (p - 1) * l;

        const where = ['1=1'];
        const params = [];

        if (search && search.trim()) {
            where.push('(m.nom_commercial LIKE ? OR u.fullname LIKE ? OR u.email LIKE ? OR m.telephone LIKE ?)');
            const q = `%${search.trim()}%`;
            params.push(q, q, q, q);
        }

        if (statut === 'actif')   where.push('m.actif = TRUE');
        if (statut === 'inactif') where.push('m.actif = FALSE');

        if (geolocalise === 'oui') {
            where.push('m.latitude IS NOT NULL AND m.longitude IS NOT NULL');
        } else if (geolocalise === 'non') {
            where.push('(m.latitude IS NULL OR m.longitude IS NULL)');
        }

        if (pays) { where.push('m.pays = ?'); params.push(pays); }
        if (ville) { where.push('m.ville = ?'); params.push(ville); }

        const allowedOrder = ['date_creation', 'nom_commercial', 'ville', 'pays'];
        const safeOrder = allowedOrder.includes(orderBy) ? orderBy : 'date_creation';
        const safeDir = orderDir === 'asc' ? 'ASC' : 'DESC';

        const whereSql = where.join(' AND ');

        // Compte total
        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total
             FROM magasins m
             INNER JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
             WHERE ${whereSql}`,
            params
        );
        const total = parseInt(countRows[0]?.total || 0, 10);

        // Liste
        const [rows] = await pool.query(
            `SELECT
                m.id_magasin,
                m.nom_commercial,
                m.slogan,
                m.logo_url,
                m.quartier,
                m.ville,
                m.pays,
                m.telephone,
                m.telephone2,
                m.whatsapp,
                m.email,
                m.latitude,
                m.longitude,
                m.adresse_complete,
                m.position_source,
                m.precision_gps,
                m.actif,
                m.date_creation,
                m.date_modification,
                u.id_utilisateur,
                u.fullname  AS nom_patron,
                u.slug      AS slug_patron,
                u.email     AS email_patron,
                u.telephone AS telephone_patron,
                u.actif     AS patron_actif
             FROM magasins m
             INNER JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
             WHERE ${whereSql}
             ORDER BY m.${safeOrder} ${safeDir}
             LIMIT ? OFFSET ?`,
            [...params, l, offset]
        );

        return {
            total,
            page: p,
            limit: l,
            totalPages: Math.ceil(total / l),
            magasins: rows.map((m) => ({
                ...m,
                latitude:  m.latitude  != null ? parseFloat(m.latitude)  : null,
                longitude: m.longitude != null ? parseFloat(m.longitude) : null,
            })),
        };
    }

    // ============================================================
    // 🗺️ TOUS LES MAGASINS GÉOLOCALISÉS (pour la carte)
    // ============================================================
    static async getGeolocalises(limit = 1000) {
        const l = safeInt(limit, 1000, 1, 5000);

        const [rows] = await pool.query(
            `SELECT
                m.id_magasin,
                m.nom_commercial,
                m.logo_url,
                m.ville,
                m.pays,
                m.telephone,
                m.latitude,
                m.longitude,
                u.id_utilisateur,
                u.fullname  AS nom_patron,
                u.slug      AS slug_patron
             FROM magasins m
             INNER JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
             WHERE m.actif = TRUE
               AND m.latitude  IS NOT NULL
               AND m.longitude IS NOT NULL
               AND m.latitude  BETWEEN -90  AND 90
               AND m.longitude BETWEEN -180 AND 180
             ORDER BY m.date_creation DESC
             LIMIT ?`,
            [l]
        );

        return rows.map((m) => ({
            ...m,
            latitude:  parseFloat(m.latitude),
            longitude: parseFloat(m.longitude),
        }));
    }

    // ============================================================
    // 🔍 DÉTAIL MAGASIN
    // ============================================================
    static async getDetail(id_magasin) {
        const [rows] = await pool.query(
            `SELECT
                m.*,
                u.id_utilisateur,
                u.fullname  AS nom_patron,
                u.slug      AS slug_patron,
                u.email     AS email_patron,
                u.telephone AS telephone_patron,
                u.actif     AS patron_actif,
                u.date_creation     AS patron_date_creation,
                u.derniere_connexion AS patron_derniere_connexion
             FROM magasins m
             INNER JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
             WHERE m.id_magasin = ?
             LIMIT 1`,
            [id_magasin]
        );

        if (!rows[0]) return null;

        const m = rows[0];
        m.latitude  = m.latitude  != null ? parseFloat(m.latitude)  : null;
        m.longitude = m.longitude != null ? parseFloat(m.longitude) : null;
        m.precision_gps = m.precision_gps != null ? parseFloat(m.precision_gps) : null;

        // Stats légères du tenant (facultatif, pour enrichir la fiche)
        const [stats] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM produits      WHERE id_utilisateur = ?) AS nb_produits,
                (SELECT COUNT(*) FROM clients       WHERE id_utilisateur = ?) AS nb_clients,
                (SELECT COUNT(*) FROM commandes_vente WHERE id_utilisateur = ?) AS nb_commandes,
                (SELECT COUNT(*) FROM factures_vente  WHERE id_utilisateur = ?) AS nb_factures,
                (SELECT COUNT(*) FROM employes        WHERE id_utilisateur = ?) AS nb_employes`,
            [m.id_utilisateur, m.id_utilisateur, m.id_utilisateur, m.id_utilisateur, m.id_utilisateur]
        );

        m.stats = stats[0] || {};
        return m;
    }

    // ============================================================
    // 📊 STATS GLOBALES (header)
    // ============================================================
    static async getStats() {
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN actif = TRUE THEN 1 ELSE 0 END) AS total_actifs,
                SUM(CASE WHEN actif = FALSE THEN 1 ELSE 0 END) AS total_inactifs,
                SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS total_geolocalises,
                SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) AS total_sans_gps,
                COUNT(DISTINCT pays) AS nb_pays,
                COUNT(DISTINCT ville) AS nb_villes
            FROM magasins
        `);
        return rows[0] || {};
    }

    // ============================================================
    // 🌍 LISTES DE FILTRES
    // ============================================================
    static async getPays() {
        const [rows] = await pool.query(
            `SELECT DISTINCT pays FROM magasins
             WHERE pays IS NOT NULL AND pays != ''
             ORDER BY pays ASC`
        );
        return rows.map((r) => r.pays);
    }

    static async getVilles(pays = null) {
        const params = [];
        let where = `ville IS NOT NULL AND ville != ''`;
        if (pays) {
            where += ' AND pays = ?';
            params.push(pays);
        }
        const [rows] = await pool.query(
            `SELECT DISTINCT ville FROM magasins WHERE ${where} ORDER BY ville ASC`,
            params
        );
        return rows.map((r) => r.ville);
    }

    // ============================================================
    // 🛠️ ACTIONS
    // ============================================================
    static async toggleActif(id_magasin, actif) {
        const [result] = await pool.query(
            `UPDATE magasins SET actif = ? WHERE id_magasin = ?`,
            [actif ? 1 : 0, id_magasin]
        );
        return result.affectedRows > 0;
    }

    static async updateGeolocalisation(id_magasin, { latitude, longitude, position_source = 'manuel' }) {
        const [result] = await pool.query(
            `UPDATE magasins
             SET latitude = ?, longitude = ?, position_source = ?
             WHERE id_magasin = ?`,
            [latitude, longitude, position_source, id_magasin]
        );
        return result.affectedRows > 0;
    }



    
}

export default MagasinAdmin;