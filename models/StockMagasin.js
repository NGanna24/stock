// models/StockMagasin.js
import { pool } from '../config/db.js';

class StockMagasin {
    /**
     * ============================================================
     * Récupérer le stock d'un produit dans un magasin
     * ============================================================
     */
    static async findByProduit(id_magasin, id_produit) {
        const [rows] = await pool.execute(
            `SELECT * FROM stock_magasin
             WHERE id_magasin = ? AND id_produit = ?`,
            [id_magasin, id_produit]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Lister tous les stocks d'un magasin
     * ============================================================
     */
    static async findByMagasin(id_magasin) {
        const [rows] = await pool.execute(
            `SELECT sm.*,
                    p.nom as produit_nom,
                    p.prix_achat,
                    p.prix_vente,
                    u.symbole as unite_symbole
             FROM stock_magasin sm
             INNER JOIN produits p ON sm.id_produit = p.id_produit
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             WHERE sm.id_magasin = ?
             ORDER BY p.nom ASC`,
            [id_magasin]
        );
        return rows;
    }

    /**
     * ============================================================
     * Ajuster la quantité (delta positif/négatif)
     * ============================================================
     */
    static async ajuster(id_magasin, id_produit, id_utilisateur, delta, connection = null) {
        const conn = connection || await pool.getConnection();
        const shouldRelease = !connection;

        try {
            if (shouldRelease) await conn.beginTransaction();

            const [rows] = await conn.execute(
                `SELECT quantite FROM stock_magasin
                 WHERE id_magasin = ? AND id_produit = ?
                 FOR UPDATE`,
                [id_magasin, id_produit]
            );

            if (rows.length === 0) {
                if (delta > 0) {
                    await conn.execute(
                        `INSERT INTO stock_magasin (id_magasin, id_produit, id_utilisateur, quantite)
                         VALUES (?, ?, ?, ?)`,
                        [id_magasin, id_produit, id_utilisateur, delta]
                    );
                } else {
                    throw new Error('Stock magasin inexistant');
                }
            } else {
                const nouvelle = parseFloat(rows[0].quantite) + delta;
                if (nouvelle < 0) {
                    throw new Error(`Stock insuffisant (disponible: ${rows[0].quantite})`);
                }
                await conn.execute(
                    `UPDATE stock_magasin SET quantite = ?
                     WHERE id_magasin = ? AND id_produit = ?`,
                    [nouvelle, id_magasin, id_produit]
                );
            }

            if (shouldRelease) await conn.commit();

            return await this.findByProduit(id_magasin, id_produit);

        } catch (error) {
            if (shouldRelease) await conn.rollback();
            throw error;
        } finally {
            if (shouldRelease) conn.release();
        }
    }

    /**
     * ============================================================
     * Définir la quantité absolue
     * ============================================================
     */
    static async setQuantite(id_magasin, id_produit, id_utilisateur, quantite) {
        await pool.execute(
            `INSERT INTO stock_magasin (id_magasin, id_produit, id_utilisateur, quantite)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE quantite = VALUES(quantite)`,
            [id_magasin, id_produit, id_utilisateur, quantite]
        );
        return await this.findByProduit(id_magasin, id_produit);
    }
}

export default StockMagasin;