// models/UniteVenteEntrepot.js
import { pool } from '../config/db.js';

class UniteVenteEntrepot {
    /* ============================================================
       HELPER — vérifier que le produit entrepôt appartient bien
       à l'entrepôt et que l'utilisateur y a accès
       ============================================================ */
    static async _ensureProduitEntrepot(db, id_produit_entrepot, id_entrepot, id_utilisateur) {
        const [rows] = await db.execute(
            `SELECT pe.id_produit_entrepot, pe.id_entrepot
               FROM produits_entrepot pe
               INNER JOIN membres_entrepot me
                       ON me.id_entrepot = pe.id_entrepot
                      AND me.id_utilisateur = ?
                      AND me.actif = TRUE
              WHERE pe.id_produit_entrepot = ?
                AND pe.id_entrepot = ?
                AND pe.actif = 1`,
            [id_utilisateur, id_produit_entrepot, id_entrepot]
        );
        if (rows.length === 0) {
            throw new Error('Produit entrepôt non trouvé ou accès refusé');
        }
        return rows[0];
    }

    /* ============================================================
       Récupérer toutes les unités de vente d'un produit entrepôt
       ============================================================ */
    static async findByProduit(id_produit_entrepot, id_entrepot, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findByProduit');

        await this._ensureProduitEntrepot(pool, id_produit_entrepot, id_entrepot, id_utilisateur);

        const [rows] = await pool.execute(
            `SELECT
                id_unite_vente_entrepot,
                id_produit_entrepot,
                nom,
                quantite_base,
                prix_vente,
                prix_achat,
                est_principal,
                actif,
                date_creation
             FROM unites_vente_entrepot
             WHERE id_produit_entrepot = ? AND actif = TRUE
             ORDER BY est_principal DESC, quantite_base ASC`,
            [id_produit_entrepot]
        );

        return rows.map(r => ({
            ...r,
            quantite_base: parseFloat(r.quantite_base) || 1,
            prix_vente: parseFloat(r.prix_vente) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            est_principal: r.est_principal === 1 || r.est_principal === true,
            actif: r.actif === 1 || r.actif === true
        }));
    }

    /* ============================================================
       Récupérer une unité de vente par ID
       ============================================================ */
    static async findById(id, id_entrepot, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findById');

        const [rows] = await pool.execute(
            `SELECT uv.*, pe.id_entrepot
               FROM unites_vente_entrepot uv
               INNER JOIN produits_entrepot pe
                       ON uv.id_produit_entrepot = pe.id_produit_entrepot
               INNER JOIN membres_entrepot me
                       ON me.id_entrepot = pe.id_entrepot
                      AND me.id_utilisateur = ?
                      AND me.actif = TRUE
              WHERE uv.id_unite_vente_entrepot = ?
                AND pe.id_entrepot = ?
                AND uv.actif = TRUE`,
            [id_utilisateur, id, id_entrepot]
        );

        if (rows.length === 0) return null;

        const r = rows[0];
        return {
            ...r,
            quantite_base: parseFloat(r.quantite_base) || 1,
            prix_vente: parseFloat(r.prix_vente) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            est_principal: r.est_principal === 1 || r.est_principal === true,
            actif: r.actif === 1 || r.actif === true
        };
    }

    /* ============================================================
       Créer une unité de vente entrepôt
       ============================================================ */
    static async create(data, id_entrepot, id_utilisateur, connection = null) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour create');

        const {
            id_produit_entrepot,
            nom,
            quantite_base,
            prix_vente,
            prix_achat = 0,
            est_principal = false
        } = data;

        const db = connection || pool;

        await this._ensureProduitEntrepot(db, id_produit_entrepot, id_entrepot, id_utilisateur);

        if (est_principal) {
            await db.execute(
                `UPDATE unites_vente_entrepot SET est_principal = FALSE
                  WHERE id_produit_entrepot = ?`,
                [id_produit_entrepot]
            );
        }

        const [result] = await db.execute(
            `INSERT INTO unites_vente_entrepot (
                id_produit_entrepot, nom, quantite_base, prix_vente, prix_achat,
                est_principal, actif
             ) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
            [
                id_produit_entrepot,
                nom.trim(),
                parseFloat(quantite_base) || 1,
                parseFloat(prix_vente) || 0,
                parseFloat(prix_achat) || 0,
                est_principal ? 1 : 0
            ]
        );

        return result.insertId;
    }

    /* ============================================================
       Mettre à jour une unité de vente entrepôt
       ============================================================ */
    static async update(id, data, id_entrepot, id_utilisateur, connection = null) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour update');

        const db = connection || pool;

        const unite = await this.findById(id, id_entrepot, id_utilisateur);
        if (!unite) throw new Error('Unité de vente non trouvée');

        const { nom, quantite_base, prix_vente, prix_achat, est_principal } = data;

        if (est_principal) {
            await db.execute(
                `UPDATE unites_vente_entrepot SET est_principal = FALSE
                  WHERE id_produit_entrepot = ? AND id_unite_vente_entrepot != ?`,
                [unite.id_produit_entrepot, id]
            );
        }

        const nouveauNom = (nom !== undefined && nom !== null) ? nom.trim() : unite.nom;
        const nouvelleQteBase = (quantite_base !== undefined && quantite_base !== null)
            ? parseFloat(quantite_base) : unite.quantite_base;
        const nouveauPrixVente = (prix_vente !== undefined && prix_vente !== null)
            ? parseFloat(prix_vente) : unite.prix_vente;
        const nouveauPrixAchat = (prix_achat !== undefined && prix_achat !== null)
            ? parseFloat(prix_achat) : unite.prix_achat;
        const nouveauEstPrincipal = (est_principal !== undefined && est_principal !== null)
            ? (est_principal ? 1 : 0) : (unite.est_principal ? 1 : 0);

        const [result] = await db.execute(
            `UPDATE unites_vente_entrepot SET
                nom = ?, quantite_base = ?, prix_vente = ?,
                prix_achat = ?, est_principal = ?
              WHERE id_unite_vente_entrepot = ?`,
            [
                nouveauNom,
                isNaN(nouvelleQteBase) ? unite.quantite_base : nouvelleQteBase,
                isNaN(nouveauPrixVente) ? unite.prix_vente : nouveauPrixVente,
                isNaN(nouveauPrixAchat) ? unite.prix_achat : nouveauPrixAchat,
                nouveauEstPrincipal,
                id
            ]
        );

        return result.affectedRows > 0;
    }

    /* ============================================================
       Supprimer (soft delete) une unité de vente entrepôt
       ============================================================ */
    static async delete(id, id_entrepot, id_utilisateur, connection = null) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour delete');

        const db = connection || pool;

        const unite = await this.findById(id, id_entrepot, id_utilisateur);
        if (!unite) throw new Error('Unité de vente non trouvée');

        const [result] = await db.execute(
            `UPDATE unites_vente_entrepot SET actif = FALSE
              WHERE id_unite_vente_entrepot = ?`,
            [id]
        );

        return result.affectedRows > 0;
    }

    /* ============================================================
       Supprimer toutes les unités d'un produit entrepôt (soft delete)
       ============================================================ */
    static async deleteByProduit(id_produit_entrepot, connection = null) {
        const db = connection || pool;

        const [result] = await db.execute(
            `UPDATE unites_vente_entrepot SET actif = FALSE
              WHERE id_produit_entrepot = ?`,
            [id_produit_entrepot]
        );

        return result.affectedRows > 0;
    }

    /* ============================================================
       Synchroniser les unités de vente d'un produit entrepôt
       (même logique que le magasin)
       ============================================================ */
    static async syncForProduit(
        id_produit_entrepot,
        unites_vente,
        unites_deleted,
        id_entrepot,
        id_utilisateur,
        connection = null
    ) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour syncForProduit');

        const db = connection || pool;

        // 1. Soft delete des unités marquées
        if (unites_deleted && unites_deleted.length > 0) {
            const placeholders = unites_deleted.map(() => '?').join(',');
            await db.execute(
                `UPDATE unites_vente_entrepot SET actif = FALSE
                  WHERE id_unite_vente_entrepot IN (${placeholders})
                    AND id_produit_entrepot = ?`,
                [...unites_deleted, id_produit_entrepot]
            );
        }

        // 2. Upsert
        if (unites_vente && unites_vente.length > 0) {
            for (const unite of unites_vente) {
                if (unite.id_unite_vente_entrepot) {
                    await db.execute(
                        `UPDATE unites_vente_entrepot SET
                            nom = ?, quantite_base = ?, prix_vente = ?,
                            prix_achat = ?, est_principal = ?, actif = TRUE
                          WHERE id_unite_vente_entrepot = ?
                            AND id_produit_entrepot = ?`,
                        [
                            unite.nom.trim(),
                            parseFloat(unite.quantite_base) || 1,
                            parseFloat(unite.prix_vente) || 0,
                            parseFloat(unite.prix_achat) || 0,
                            unite.est_principal ? 1 : 0,
                            unite.id_unite_vente_entrepot,
                            id_produit_entrepot
                        ]
                    );
                } else {
                    await db.execute(
                        `INSERT INTO unites_vente_entrepot (
                            id_produit_entrepot, nom, quantite_base, prix_vente,
                            prix_achat, est_principal, actif
                         ) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                        [
                            id_produit_entrepot,
                            unite.nom.trim(),
                            parseFloat(unite.quantite_base) || 1,
                            parseFloat(unite.prix_vente) || 0,
                            parseFloat(unite.prix_achat) || 0,
                            unite.est_principal ? 1 : 0
                        ]
                    );
                }
            }

            // 3. Une seule unité principale
            const [principales] = await db.execute(
                `SELECT COUNT(*) AS count FROM unites_vente_entrepot
                  WHERE id_produit_entrepot = ? AND est_principal = TRUE AND actif = TRUE`,
                [id_produit_entrepot]
            );

            if (principales[0].count === 0) {
                await db.execute(
                    `UPDATE unites_vente_entrepot
                        SET est_principal = TRUE
                      WHERE id_unite_vente_entrepot = (
                          SELECT id_unite_vente_entrepot FROM (
                              SELECT id_unite_vente_entrepot FROM unites_vente_entrepot
                               WHERE id_produit_entrepot = ? AND actif = TRUE
                               ORDER BY quantite_base ASC, id_unite_vente_entrepot ASC
                               LIMIT 1
                          ) AS tmp
                      )`,
                    [id_produit_entrepot]
                );
            } else if (principales[0].count > 1) {
                const [premieres] = await db.execute(
                    `SELECT id_unite_vente_entrepot FROM unites_vente_entrepot
                      WHERE id_produit_entrepot = ? AND est_principal = TRUE AND actif = TRUE
                      ORDER BY id_unite_vente_entrepot ASC LIMIT 1`,
                    [id_produit_entrepot]
                );
                if (premieres.length > 0) {
                    await db.execute(
                        `UPDATE unites_vente_entrepot SET est_principal = FALSE
                          WHERE id_produit_entrepot = ? AND id_unite_vente_entrepot != ?`,
                        [id_produit_entrepot, premieres[0].id_unite_vente_entrepot]
                    );
                }
            }
        }

        return true;
    }

    /* ============================================================
       Récupérer l'unité principale d'un produit entrepôt
       ============================================================ */
    static async findPrincipale(id_produit_entrepot, id_entrepot, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT uv.*
               FROM unites_vente_entrepot uv
               INNER JOIN produits_entrepot pe
                       ON uv.id_produit_entrepot = pe.id_produit_entrepot
               INNER JOIN membres_entrepot me
                       ON me.id_entrepot = pe.id_entrepot
                      AND me.id_utilisateur = ?
                      AND me.actif = TRUE
              WHERE uv.id_produit_entrepot = ?
                AND pe.id_entrepot = ?
                AND uv.est_principal = TRUE
                AND uv.actif = TRUE
              LIMIT 1`,
            [id_utilisateur, id_produit_entrepot, id_entrepot]
        );

        if (rows.length === 0) return null;

        const r = rows[0];
        return {
            ...r,
            quantite_base: parseFloat(r.quantite_base) || 1,
            prix_vente: parseFloat(r.prix_vente) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            est_principal: true,
            actif: r.actif === 1 || r.actif === true
        };
    }

    /* ============================================================
       Récupérer plusieurs unités par IDs (batch)
       ============================================================ */
    static async findByIds(ids, id_entrepot, id_utilisateur) {
        if (!ids || ids.length === 0) return [];
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findByIds');

        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await pool.execute(
            `SELECT uv.*
               FROM unites_vente_entrepot uv
               INNER JOIN produits_entrepot pe
                       ON uv.id_produit_entrepot = pe.id_produit_entrepot
               INNER JOIN membres_entrepot me
                       ON me.id_entrepot = pe.id_entrepot
                      AND me.id_utilisateur = ?
                      AND me.actif = TRUE
              WHERE uv.id_unite_vente_entrepot IN (${placeholders})
                AND pe.id_entrepot = ?
                AND uv.actif = TRUE`,
            [id_utilisateur, ...ids, id_entrepot]
        );

        return rows.map(r => ({
            ...r,
            quantite_base: parseFloat(r.quantite_base) || 1,
            prix_vente: parseFloat(r.prix_vente) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            est_principal: r.est_principal === 1 || r.est_principal === true
        }));
    }
}

export default UniteVenteEntrepot;