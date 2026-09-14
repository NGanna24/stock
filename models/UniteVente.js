// models/UniteVente.js
import { pool } from '../config/db.js';

class UniteVente {
    /**
     * ============================================================
     * Récupérer toutes les unités de vente d'un produit
     * ============================================================
     */
    static async findByProduit(id_produit, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByProduit');
        }

        // Vérifier que le produit appartient à l'utilisateur
        const [produit] = await pool.execute(
            `SELECT id_produit FROM produits
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [id_produit, id_utilisateur]
        );
 
        if (produit.length === 0) {
            throw new Error('Produit non trouvé');
        }

        const [rows] = await pool.execute(
            `SELECT
                id_unite_vente,
                id_produit,
                nom,
                quantite_base,
                prix_vente,
                prix_achat,
                est_principal,
                actif,
                date_creation
             FROM unites_vente
             WHERE id_produit = ? AND actif = TRUE
             ORDER BY est_principal DESC, quantite_base ASC`,
            [id_produit]
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

    /**
     * ============================================================
     * ✅ Récupérer une unité de vente par ID
     * ✅ CORRIGÉ : filtre actif = TRUE
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT uv.*, p.id_utilisateur
             FROM unites_vente uv
             INNER JOIN produits p ON uv.id_produit = p.id_produit
             WHERE uv.id_unite_vente = ?
               AND p.id_utilisateur = ?
               AND uv.actif = TRUE`,
            [id, id_utilisateur]
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

    /**
     * ============================================================
     * Créer une unité de vente
     * ============================================================
     */
    static async create(data, id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }

        const {
            id_produit,
            nom,
            quantite_base,
            prix_vente,
            prix_achat = 0,
            est_principal = false
        } = data;

        const db = connection || pool;

        // Vérifier que le produit appartient à l'utilisateur
        const [produit] = await db.execute(
            `SELECT id_produit FROM produits
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [id_produit, id_utilisateur]
        );

        if (produit.length === 0) {
            throw new Error('Produit non trouvé');
        }

        // Si c'est principal, désactiver les autres
        if (est_principal) {
            await db.execute(
                `UPDATE unites_vente SET est_principal = FALSE
                 WHERE id_produit = ?`,
                [id_produit]
            );
        }

        const [result] = await db.execute(
            `INSERT INTO unites_vente (
                id_produit, nom, quantite_base, prix_vente, prix_achat,
                est_principal, actif
            ) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
            [
                id_produit,
                nom.trim(),
                parseFloat(quantite_base) || 1,
                parseFloat(prix_vente) || 0,
                parseFloat(prix_achat) || 0,
                est_principal ? 1 : 0
            ]
        );

        return result.insertId;
    }

    /**
     * ============================================================
     * ✅ Mettre à jour une unité de vente
     * ✅ CORRIGÉ : permet de mettre prix_achat / prix_vente à 0
     * ============================================================
     */
    static async update(id, data, id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const db = connection || pool;

        // Vérifier l'existence
        const unite = await this.findById(id, id_utilisateur);
        if (!unite) {
            throw new Error('Unité de vente non trouvée');
        }

        const { nom, quantite_base, prix_vente, prix_achat, est_principal } = data;

        // Si c'est principal, désactiver les autres
        if (est_principal) {
            await db.execute(
                `UPDATE unites_vente SET est_principal = FALSE
                 WHERE id_produit = ? AND id_unite_vente != ?`,
                [unite.id_produit, id]
            );
        }

        // ✅ CORRIGÉ : utiliser `!== undefined` au lieu de `||` pour permettre 0
        const nouveauNom = (nom !== undefined && nom !== null)
            ? nom.trim()
            : unite.nom;

        const nouvelleQteBase = (quantite_base !== undefined && quantite_base !== null)
            ? parseFloat(quantite_base)
            : unite.quantite_base;

        const nouveauPrixVente = (prix_vente !== undefined && prix_vente !== null)
            ? parseFloat(prix_vente)
            : unite.prix_vente;

        const nouveauPrixAchat = (prix_achat !== undefined && prix_achat !== null)
            ? parseFloat(prix_achat)
            : unite.prix_achat;

        const nouveauEstPrincipal = (est_principal !== undefined && est_principal !== null)
            ? (est_principal ? 1 : 0)
            : (unite.est_principal ? 1 : 0);

        const [result] = await db.execute(
            `UPDATE unites_vente SET
                nom = ?,
                quantite_base = ?,
                prix_vente = ?,
                prix_achat = ?,
                est_principal = ?
             WHERE id_unite_vente = ?`,
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

    /**
     * ============================================================
     * Supprimer une unité de vente (soft delete)
     * ============================================================
     */
    static async delete(id, id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const db = connection || pool;

        const unite = await this.findById(id, id_utilisateur);
        if (!unite) {
            throw new Error('Unité de vente non trouvée');
        }

        // Soft delete : on désactive au lieu de supprimer
        // (pour ne pas casser les lignes de commande existantes)
        const [result] = await db.execute(
            `UPDATE unites_vente SET actif = FALSE
             WHERE id_unite_vente = ?`,
            [id]
        );

        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Supprimer toutes les unités d'un produit (soft delete)
     * ============================================================
     */
    static async deleteByProduit(id_produit, id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour deleteByProduit');
        }

        const db = connection || pool;

        const [result] = await db.execute(
            `UPDATE unites_vente SET actif = FALSE
             WHERE id_produit = ?`,
            [id_produit]
        );

        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * ✅ Synchroniser les unités de vente d'un produit
     * ✅ CORRIGÉ : utilise une sous-requête au lieu de UPDATE ... ORDER BY ... LIMIT
     * ============================================================
     */
    static async syncForProduit(id_produit, unites_vente, unites_deleted, id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour syncForProduit');
        }

        const db = connection || pool;

        // 1. Supprimer (soft delete) les unités marquées pour suppression
        if (unites_deleted && unites_deleted.length > 0) {
            const placeholders = unites_deleted.map(() => '?').join(',');
            await db.execute(
                `UPDATE unites_vente SET actif = FALSE
                 WHERE id_unite_vente IN (${placeholders})`,
                unites_deleted
            );
        }

        // 2. Traiter les unités (création ou mise à jour)
        if (unites_vente && unites_vente.length > 0) {
            for (const unite of unites_vente) {
                if (unite.id_unite_vente) {
                    // Mise à jour
                    await db.execute(
                        `UPDATE unites_vente SET
                            nom = ?,
                            quantite_base = ?,
                            prix_vente = ?,
                            prix_achat = ?,
                            est_principal = ?,
                            actif = TRUE
                         WHERE id_unite_vente = ?`,
                        [
                            unite.nom.trim(),
                            parseFloat(unite.quantite_base) || 1,
                            parseFloat(unite.prix_vente) || 0,
                            parseFloat(unite.prix_achat) || 0,
                            unite.est_principal ? 1 : 0,
                            unite.id_unite_vente
                        ]
                    );
                } else {
                    // Création
                    await db.execute(
                        `INSERT INTO unites_vente (
                            id_produit, nom, quantite_base, prix_vente,
                            prix_achat, est_principal, actif
                        ) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                        [
                            id_produit,
                            unite.nom.trim(),
                            parseFloat(unite.quantite_base) || 1,
                            parseFloat(unite.prix_vente) || 0,
                            parseFloat(unite.prix_achat) || 0,
                            unite.est_principal ? 1 : 0
                        ]
                    );
                }
            }

            // 3. S'assurer qu'il y a UNE seule unité principale
            const [principales] = await db.execute(
                `SELECT COUNT(*) as count FROM unites_vente
                 WHERE id_produit = ? AND est_principal = TRUE AND actif = TRUE`,
                [id_produit]
            );

            if (principales[0].count === 0) {
                // Aucune principale → définir la première (via sous-requête)
                await db.execute(
                    `UPDATE unites_vente
                     SET est_principal = TRUE
                     WHERE id_unite_vente = (
                         SELECT id_unite_vente FROM (
                             SELECT id_unite_vente FROM unites_vente
                             WHERE id_produit = ? AND actif = TRUE
                             ORDER BY quantite_base ASC, id_unite_vente ASC
                             LIMIT 1
                         ) AS tmp
                     )`,
                    [id_produit]
                );
            } else if (principales[0].count > 1) {
                // Plusieurs principales → garder la première
                const [premieres] = await db.execute(
                    `SELECT id_unite_vente FROM unites_vente
                     WHERE id_produit = ? AND est_principal = TRUE AND actif = TRUE
                     ORDER BY id_unite_vente ASC LIMIT 1`,
                    [id_produit]
                );

                if (premieres.length > 0) {
                    await db.execute(
                        `UPDATE unites_vente SET est_principal = FALSE
                         WHERE id_produit = ? AND id_unite_vente != ?`,
                        [id_produit, premieres[0].id_unite_vente]
                    );
                }
            }
        }

        return true;
    }

    /**
     * ============================================================
     * Récupérer l'unité principale d'un produit
     * ============================================================
     */
    static async findPrincipale(id_produit, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT uv.*
             FROM unites_vente uv
             INNER JOIN produits p ON uv.id_produit = p.id_produit
             WHERE uv.id_produit = ?
               AND p.id_utilisateur = ?
               AND uv.est_principal = TRUE
               AND uv.actif = TRUE
             LIMIT 1`,
            [id_produit, id_utilisateur]
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

    /**
     * ============================================================
     * ✅ Récupérer plusieurs unités par IDs (batch)
     * Utile pour CommandeAchat / CommandeVente
     * ============================================================
     */
    static async findByIds(ids, id_utilisateur) {
        if (!ids || ids.length === 0) return [];
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByIds');
        }

        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await pool.execute(
            `SELECT uv.*
             FROM unites_vente uv
             INNER JOIN produits p ON uv.id_produit = p.id_produit
             WHERE uv.id_unite_vente IN (${placeholders})
               AND p.id_utilisateur = ?
               AND uv.actif = TRUE`,
            [...ids, id_utilisateur]
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

export default UniteVente;