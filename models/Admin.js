// models/Admin.js
import { pool } from '../config/db.js';

function safeLimit(value, defaultValue = 10, max = 500) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1) return defaultValue;
    return Math.min(n, max);
}

class Admin {
    // ============================================================
    // 📊 STATISTIQUES GLOBALES
    // ============================================================
    static async getStatsGlobales() {
        const [rows] = await pool.execute(`
            SELECT
                -- Utilisateurs
                (SELECT COUNT(*) FROM utilisateurs WHERE actif = TRUE) AS total_utilisateurs,
                (SELECT COUNT(*) FROM utilisateurs WHERE actif = FALSE) AS utilisateurs_inactifs,
                (SELECT COUNT(*) FROM utilisateurs WHERE date_creation >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS nouveaux_7j,
                (SELECT COUNT(*) FROM utilisateurs WHERE date_creation >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS nouveaux_30j,
                (SELECT COUNT(*) FROM utilisateurs WHERE derniere_connexion >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS actifs_7j,
                (SELECT COUNT(*) FROM utilisateurs WHERE derniere_connexion IS NULL) AS jamais_connectes,

                -- Magasins
                (SELECT COUNT(*) FROM magasins WHERE actif = TRUE) AS total_magasins,
                (SELECT COUNT(*) FROM magasins WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS magasins_geolocalises,
                (SELECT COUNT(*) FROM magasins WHERE latitude IS NULL OR longitude IS NULL) AS magasins_non_geolocalises,
                (SELECT COUNT(*) FROM magasins WHERE actif = FALSE) AS magasins_inactifs,

                -- Diversité géographique
                (SELECT COUNT(DISTINCT pays) FROM magasins WHERE pays IS NOT NULL AND pays != '') AS nb_pays,
                (SELECT COUNT(DISTINCT ville) FROM magasins WHERE ville IS NOT NULL AND ville != '') AS nb_villes
        `);
        return rows[0];
    }

    // ============================================================
    // 📈 STATS JOURNALIÈRES (inscriptions + magasins par jour)
    // ============================================================
    static async getStatsJournalieres(days = 30) {
        const d = safeLimit(days, 30, 365);

        const [rows] = await pool.execute(`
            SELECT
                d.jour,
                COALESCE(u.inscriptions, 0) AS inscriptions,
                COALESCE(m.magasins, 0) AS magasins
            FROM (
                SELECT DATE_SUB(CURDATE(), INTERVAL n DAY) AS jour
                FROM (
                    SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                    UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
                    UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14
                    UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19
                    UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24
                    UNION SELECT 25 UNION SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29
                    UNION SELECT 30 UNION SELECT 31 UNION SELECT 32 UNION SELECT 33 UNION SELECT 34
                    UNION SELECT 35 UNION SELECT 36 UNION SELECT 37 UNION SELECT 38 UNION SELECT 39
                    UNION SELECT 40 UNION SELECT 41 UNION SELECT 42 UNION SELECT 43 UNION SELECT 44
                    UNION SELECT 45 UNION SELECT 46 UNION SELECT 47 UNION SELECT 48 UNION SELECT 49
                    UNION SELECT 50 UNION SELECT 51 UNION SELECT 52 UNION SELECT 53 UNION SELECT 54
                    UNION SELECT 55 UNION SELECT 56 UNION SELECT 57 UNION SELECT 58 UNION SELECT 59
                    UNION SELECT 60 UNION SELECT 61 UNION SELECT 62 UNION SELECT 63 UNION SELECT 64
                    UNION SELECT 65 UNION SELECT 66 UNION SELECT 67 UNION SELECT 68 UNION SELECT 69
                    UNION SELECT 70 UNION SELECT 71 UNION SELECT 72 UNION SELECT 73 UNION SELECT 74
                    UNION SELECT 75 UNION SELECT 76 UNION SELECT 77 UNION SELECT 78 UNION SELECT 79
                    UNION SELECT 80 UNION SELECT 81 UNION SELECT 82 UNION SELECT 83 UNION SELECT 84
                    UNION SELECT 85 UNION SELECT 86 UNION SELECT 87 UNION SELECT 88 UNION SELECT 89
                ) nums
                WHERE n < ${d}
            ) d
            LEFT JOIN (
                SELECT DATE(date_creation) AS jour, COUNT(*) AS inscriptions
                FROM utilisateurs
                WHERE date_creation >= DATE_SUB(CURDATE(), INTERVAL ${d} DAY)
                GROUP BY DATE(date_creation)
            ) u ON u.jour = d.jour
            LEFT JOIN (
                SELECT DATE(date_creation) AS jour, COUNT(*) AS magasins
                FROM magasins
                WHERE date_creation >= DATE_SUB(CURDATE(), INTERVAL ${d} DAY)
                GROUP BY DATE(date_creation)
            ) m ON m.jour = d.jour
            ORDER BY d.jour ASC
        `);
        return rows;
    }

    // ============================================================
    // 👥 DERNIERS UTILISATEURS
    // ============================================================
    static async getDerniersUtilisateurs(limit = 10) {
        const l = safeLimit(limit, 10, 500);

        const [rows] = await pool.execute(`
            SELECT
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
                m.logo_url,
                m.quartier,
                m.ville,
                m.pays,
                m.latitude,
                m.longitude,
                m.position_source
            FROM utilisateurs u
            LEFT JOIN roles r ON u.id_role = r.id_role
            LEFT JOIN magasins m ON m.id_utilisateur = u.id_utilisateur
            ORDER BY u.date_creation DESC
            LIMIT ${l}
        `);
        return rows;
    }

    // ============================================================
    // 🏪 TOUS LES MAGASINS
    // ============================================================
    static async getTousLesMagasins(limit = 500) {
        const l = safeLimit(limit, 500, 2000);

        const [rows] = await pool.execute(`
            SELECT
                m.id_magasin,
                m.nom_commercial,
                m.slogan,
                m.description,
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
                m.numero_rccm,
                m.numero_nif,
                m.numero_contribuable,
                m.regime_fiscal,
                m.actif,
                m.date_creation,
                m.date_modification,
                u.id_utilisateur,
                u.fullname AS nom_patron,
                u.email AS email_patron,
                u.telephone AS telephone_patron,
                u.slug AS slug_patron
            FROM magasins m
            JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
            ORDER BY m.date_creation DESC
            LIMIT ${l}
        `);
        return rows;
    }

    // ============================================================
    // 🏪 MAGASINS GÉOLOCALISÉS
    // ============================================================
    static async getMagasinsGeolocalises() {
        const [rows] = await pool.execute(`
            SELECT
                m.id_magasin,
                m.nom_commercial,
                m.slogan,
                m.logo_url,
                m.quartier,
                m.ville,
                m.pays,
                m.telephone,
                m.email,
                m.latitude,
                m.longitude,
                m.position_source,
                m.precision_gps,
                m.date_creation,
                u.id_utilisateur,
                u.fullname AS nom_patron,
                u.email AS email_patron,
                u.slug AS slug_patron,
                u.telephone AS telephone_patron
            FROM magasins m
            JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
            WHERE m.latitude IS NOT NULL
              AND m.longitude IS NOT NULL
              AND m.actif = TRUE
            ORDER BY m.date_creation DESC
        `);
        return rows;
    }

    // ============================================================
    // 🗺️ RÉPARTITION GÉOGRAPHIQUE
    // ============================================================
    static async getRepartitionGeographique() {
        const [parPays] = await pool.execute(`
            SELECT
                COALESCE(m.pays, 'Non renseigné') AS pays,
                COUNT(DISTINCT m.id_utilisateur) AS nb_utilisateurs,
                COUNT(m.id_magasin) AS nb_magasins
            FROM magasins m
            GROUP BY m.pays
            ORDER BY nb_magasins DESC
        `);

        const [parVille] = await pool.execute(`
            SELECT
                COALESCE(m.ville, 'Non renseignée') AS ville,
                COALESCE(m.pays, '') AS pays,
                COUNT(*) AS nb_magasins,
                COUNT(DISTINCT m.id_utilisateur) AS nb_utilisateurs
            FROM magasins m
            WHERE m.ville IS NOT NULL AND m.ville != ''
            GROUP BY m.ville, m.pays
            ORDER BY nb_magasins DESC
            LIMIT 20
        `);

        return { parPays, parVille };
    }

    // ============================================================
    // 📅 CROISSANCE MENSUELLE (12 derniers mois)
    // ============================================================
    static async getCroissanceMensuelle() {
        const [rows] = await pool.execute(`
            SELECT
                DATE_FORMAT(date_creation, '%Y-%m') AS mois,
                COUNT(*) AS inscriptions
            FROM utilisateurs
            WHERE date_creation >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(date_creation, '%Y-%m')
            ORDER BY mois ASC
        `);
        return rows;
    }

    // ============================================================
    // 😴 UTILISATEURS INACTIFS
    // ============================================================
    static async getUtilisateursInactifs(days = 30) {
        const d = safeLimit(days, 30, 365);

        const [rows] = await pool.execute(`
            SELECT
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
              AND (
                u.derniere_connexion IS NULL
                OR u.derniere_connexion < DATE_SUB(NOW(), INTERVAL ${d} DAY)
              )
            ORDER BY u.derniere_connexion ASC
        `);
        return rows;
    }

    // ============================================================
    // 🩺 QUALITÉ DES DONNÉES
    // ============================================================
    static async getQualiteDonnees() {
        const [rows] = await pool.execute(`
            SELECT
                (SELECT COUNT(*) FROM magasins WHERE latitude IS NULL OR longitude IS NULL) AS magasins_sans_gps,
                (SELECT COUNT(*) FROM magasins WHERE ville IS NULL OR ville = '') AS magasins_sans_ville,
                (SELECT COUNT(*) FROM magasins WHERE nom_commercial IS NULL OR nom_commercial = '') AS magasins_sans_nom,
                (SELECT COUNT(*) FROM utilisateurs WHERE actif = FALSE) AS comptes_desactives,
                (SELECT COUNT(*) FROM utilisateurs WHERE derniere_connexion IS NULL) AS jamais_connectes
        `);
        return rows[0];
    }

    // ============================================================
    // 🔍 DÉTAIL UTILISATEUR
    // ============================================================
    static async getUtilisateurDetail(id_utilisateur) {
        const [rows] = await pool.execute(`
            SELECT
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
                m.nom_commercial,
                m.slogan,
                m.logo_url,
                m.description AS magasin_description,
                m.quartier,
                m.ville,
                m.pays,
                m.telephone AS magasin_telephone,
                m.telephone2 AS magasin_telephone2,
                m.whatsapp AS magasin_whatsapp,
                m.email AS magasin_email,
                m.latitude,
                m.longitude,
                m.adresse_complete,
                m.position_source,
                m.precision_gps,
                m.numero_rccm,
                m.numero_nif,
                m.numero_contribuable,
                m.regime_fiscal,
                m.actif AS magasin_actif,
                m.date_creation AS magasin_date_creation
            FROM utilisateurs u
            LEFT JOIN roles r ON u.id_role = r.id_role
            LEFT JOIN magasins m ON m.id_utilisateur = u.id_utilisateur
            WHERE u.id_utilisateur = ?
        `, [id_utilisateur]);
        return rows[0] || null;
    }

    // ============================================================
    // 🛠️ ACTIONS
    // ============================================================
    static async toggleUtilisateur(id_utilisateur, actif) {
        const [result] = await pool.execute(
            `UPDATE utilisateurs SET actif = ? WHERE id_utilisateur = ?`,
            [actif ? 1 : 0, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    static async toggleMagasin(id_magasin, actif) {
        const [result] = await pool.execute(
            `UPDATE magasins SET actif = ? WHERE id_magasin = ?`,
            [actif ? 1 : 0, id_magasin]
        );
        return result.affectedRows > 0;
    }

    // ============================================================
    // 📊 DASHBOARD COMPLET
    // ============================================================
    static async getDashboardComplet() {
        const [
            stats,
            inscriptions_30j,
            derniers_utilisateurs,
            magasins,
            geo,
            croissance_12m,
            qualite,
        ] = await Promise.all([
            this.getStatsGlobales(),
            this.getStatsJournalieres(30),
            this.getDerniersUtilisateurs(8),
            this.getTousLesMagasins(500),
            this.getRepartitionGeographique(),
            this.getCroissanceMensuelle(),
            this.getQualiteDonnees(),
        ]);

        return {
            stats,
            inscriptions_30j,
            derniers_utilisateurs,
            magasins,
            repartition_geo: geo,
            croissance_12m,
            qualite,
        };
    }
}

export default Admin;