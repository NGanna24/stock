// backend/models/StockEntrepot.js
import { pool } from '../config/db.js';

class StockEntrepot {
    /* ============================================================
       Lister le stock d'un entrepôt
       ============================================================ */
    static async findByEntrepot(id_entrepot) {
        const [rows] = await pool.execute(
            `SELECT
                se.id_stock_entrepot,
                se.id_entrepot,
                se.id_produit,
                se.quantite,
                se.quantite_minimale,
                se.quantite_maximale,
                se.id_unite_vente,
                se.nom_unite_vente,
                se.quantite_base,
                se.num_lot,
                se.date_peremption,
                se.emplacement,
                se.rayon,
                se.etagere,
                se.notes,
                se.date_creation,
                se.date_modification,

                p.nom              AS produit_nom,
                p.description,
                p.prix_achat,
                p.prix_vente,
                p.statut,

                u.symbole          AS unite_symbole,
                u.nom              AS unite_nom,

                uv.nom             AS unite_vente_nom
             FROM stock_entrepot se
             JOIN produits p    ON p.id_produit = se.id_produit
             LEFT JOIN unites u ON u.id_unite = p.id_unite
             LEFT JOIN unites_vente uv ON uv.id_unite_vente = se.id_unite_vente
             WHERE se.id_entrepot = ?
             ORDER BY p.nom ASC`,
            [id_entrepot]
        );
        return rows;
    }

    /* ============================================================
       Ajouter du stock manuellement (entrée)
       - Écrit dans stock_entrepot (upsert)
       - Écrit dans mouvements_entrepot (traçabilité dédiée)
       ============================================================ */
    static async entreeManuelle({
        id_entrepot,
        id_produit,
        id_utilisateur,
        quantite_base,          // quantité TOTALE en unité de base (déjà convertie)
        id_unite_vente = null,
        nom_unite_vente = 'Unité',
        quantite_saisie = null, // ce que l'utilisateur a tapé (ex: 3 cartons)
        quantite_base_unite = 1,
        num_lot = null,
        date_peremption = null,
        notes = null,
        emplacement = null,
        rayon = null,
        etagere = null,
    }) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1) Récupérer l'ancienne quantité (avec verrou)
            const [existing] = await connection.execute(
                `SELECT id_stock_entrepot, quantite
                   FROM stock_entrepot
                  WHERE id_entrepot = ? AND id_produit = ?
                  FOR UPDATE`,
                [id_entrepot, id_produit]
            );

            const ancienne = existing.length > 0 ? parseFloat(existing[0].quantite) || 0 : 0;
            const nouvelle = ancienne + parseFloat(quantite_base);

            // 2) Upsert stock_entrepot
            await connection.execute(
                `INSERT INTO stock_entrepot
                    (id_entrepot, id_produit, quantite,
                     id_unite_vente, nom_unite_vente, quantite_base,
                     num_lot, date_peremption, notes,
                     emplacement, rayon, etagere)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    quantite           = quantite + VALUES(quantite),
                    id_unite_vente     = COALESCE(VALUES(id_unite_vente), id_unite_vente),
                    nom_unite_vente    = VALUES(nom_unite_vente),
                    quantite_base      = VALUES(quantite_base),
                    num_lot            = COALESCE(VALUES(num_lot), num_lot),
                    date_peremption    = COALESCE(VALUES(date_peremption), date_peremption),
                    notes              = COALESCE(VALUES(notes), notes),
                    emplacement        = COALESCE(VALUES(emplacement), emplacement),
                    rayon              = COALESCE(VALUES(rayon), rayon),
                    etagere            = COALESCE(VALUES(etagere), etagere),
                    date_modification  = CURRENT_TIMESTAMP`,
                [
                    id_entrepot, id_produit, quantite_base,
                    id_unite_vente, nom_unite_vente, quantite_base_unite,
                    num_lot, date_peremption, notes,
                    emplacement, rayon, etagere,
                ]
            );

            // 3) Récupérer l'id_stock_entrepot
            const [stockRows] = await connection.execute(
                `SELECT id_stock_entrepot FROM stock_entrepot
                  WHERE id_entrepot = ? AND id_produit = ?`,
                [id_entrepot, id_produit]
            );
            const id_stock_entrepot = stockRows[0]?.id_stock_entrepot || null;

            // 4) Mouvement dédié entrepôt
            const noteMouvement = notes
                || `Ajout de ${quantite_saisie ?? quantite_base} ${nom_unite_vente} `
                 + `(${quantite_base} en unité de base)`;

            await connection.execute(
                `INSERT INTO mouvements_entrepot
                    (id_entrepot, id_produit, id_stock_entrepot, id_utilisateur,
                     type_mouvement,
                     quantite, ancienne_quantite, nouvelle_quantite,
                     id_unite_vente, nom_unite_vente, quantite_base, quantite_saisie,
                     num_lot, date_peremption,
                     emplacement, rayon, etagere,
                     type_reference, id_reference, notes)
                 VALUES (?, ?, ?, ?,
                         'entree',
                         ?, ?, ?,
                         ?, ?, ?, ?,
                         ?, ?,
                         ?, ?, ?,
                         'manuel', NULL, ?)`,
                [
                    id_entrepot, id_produit, id_stock_entrepot, id_utilisateur,
                    quantite_base, ancienne, nouvelle,
                    id_unite_vente, nom_unite_vente, quantite_base_unite,
                    quantite_saisie ?? quantite_base,
                    num_lot, date_peremption,
                    emplacement, rayon, etagere,
                    noteMouvement,
                ]
            );

            await connection.commit();

            // 5) Retourner l'état final
            const [finalRows] = await connection.execute(
                `SELECT * FROM stock_entrepot
                  WHERE id_entrepot = ? AND id_produit = ?`,
                [id_entrepot, id_produit]
            );

            return {
                id_stock_entrepot,
                id_entrepot,
                id_produit,
                ancienne_quantite: ancienne,
                quantite_ajoutee: parseFloat(quantite_base),
                nouvelle_quantite: nouvelle,
                id_unite_vente,
                nom_unite_vente,
                quantite_base: quantite_base_unite,
                num_lot,
                date_peremption,
                stock: finalRows[0] || null,
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       Historique des mouvements d'un entrepôt
       ============================================================ */
    static async getMouvements(id_entrepot, { id_produit = null, limit = 100 } = {}) {
        let sql = `
            SELECT
                me.*,
                p.nom AS produit_nom,
                u.fullname AS auteur_nom,
                uv.nom AS unite_vente_nom,
                un.symbole AS unite_symbole
            FROM mouvements_entrepot me
            JOIN produits p       ON p.id_produit = me.id_produit
            JOIN utilisateurs u   ON u.id_utilisateur = me.id_utilisateur
            LEFT JOIN unites_vente uv ON uv.id_unite_vente = me.id_unite_vente
            LEFT JOIN unites un   ON un.id_unite = p.id_unite
            WHERE me.id_entrepot = ?`;
        const params = [id_entrepot];

        if (id_produit) {
            sql += ` AND me.id_produit = ?`;
            params.push(id_produit);
        }

        sql += ` ORDER BY me.date_mouvement DESC LIMIT ?`;
        params.push(parseInt(limit) || 100);

        const [rows] = await pool.execute(sql, params);
        return rows;
    }

    /* ============================================================
       Statistiques d'un entrepôt (dashboard)
       ============================================================ */
    static async getStats(id_entrepot) {
        const [rows] = await pool.execute(
            `SELECT
                type_mouvement,
                COUNT(*) AS nb,
                COALESCE(SUM(quantite), 0) AS total_quantite
             FROM mouvements_entrepot
             WHERE id_entrepot = ?
             GROUP BY type_mouvement`,
            [id_entrepot]
        );
        return rows;
    }

    static async exists(id_entrepot, id_produit) {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS count FROM stock_entrepot
              WHERE id_entrepot = ? AND id_produit = ?`,
            [id_entrepot, id_produit]
        );
        return rows[0].count > 0;
    }
}

export default StockEntrepot;