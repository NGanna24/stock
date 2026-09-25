// models/Produit.js
import { pool } from '../config/db.js';

class Produit {
    /**
     * ============================================================
     * Récupérer tous les produits du workspace
     * ============================================================ 
     */
    static async findAll(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer un produit par ID (workspace)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_produit = ?
               AND p.id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * ✅ NOUVEAU : Récupérer un produit avec ses unités de vente
     * ============================================================
     */
    static async findByIdWithUnites(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByIdWithUnites');
        }

        // 1. Récupérer le produit
        const produit = await this.findById(id, id_utilisateur);
        if (!produit) return null;

        // 2. Récupérer les unités de vente
        const [unites] = await pool.execute(
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
            [id]
        );

        return {
            ...produit,
            unites_vente: unites.map(u => ({
                ...u,
                quantite_base: parseFloat(u.quantite_base) || 1,
                prix_vente: parseFloat(u.prix_vente) || 0,
                prix_achat: parseFloat(u.prix_achat) || 0,
                est_principal: u.est_principal === 1 || u.est_principal === true
            }))
        };
    }


    
    /**
     * ============================================================
     * ✅ NOUVEAU : Récupérer plusieurs produits avec leurs unités
     * ============================================================
     */
    static async findManyWithUnites(produits, id_utilisateur) {
        if (!produits || produits.length === 0) return [];

        const produitIds = produits.map(p => p.id_produit);
        const placeholders = produitIds.map(() => '?').join(',');

        // Récupérer TOUTES les unités en UNE SEULE requête
        const [allUnites] = await pool.execute(
            `SELECT 
                id_unite_vente,
                id_produit,
                nom,
                quantite_base,
                prix_vente,
                prix_achat,
                est_principal,
                actif
             FROM unites_vente
             WHERE id_produit IN (${placeholders}) AND actif = TRUE
             ORDER BY est_principal DESC, quantite_base ASC`,
            produitIds
        );

        // Grouper par id_produit
        const unitesParProduit = {};
        for (const unite of allUnites) {
            if (!unitesParProduit[unite.id_produit]) {
                unitesParProduit[unite.id_produit] = [];
            }
            unitesParProduit[unite.id_produit].push({
                ...unite,
                quantite_base: parseFloat(unite.quantite_base) || 1,
                prix_vente: parseFloat(unite.prix_vente) || 0,
                prix_achat: parseFloat(unite.prix_achat) || 0,
                est_principal: unite.est_principal === 1 || unite.est_principal === true
            });
        }

        // Attacher à chaque produit
        return produits.map(p => ({
            ...p,
            unites_vente: unitesParProduit[p.id_produit] || []
        }));
    }

    // models/Produit.js

/**
 * ============================================================
 * ✅ Vérifie si un produit identique existe déjà (anti-doublon)
 *
 * Un produit est considéré comme doublon si :
 *   - même nom (insensible à la casse et aux espaces)
 *   - même modèle (ou les deux NULL)
 *   - même marque (ou les deux NULL)
 *   - même workspace (id_utilisateur)
 *
 * ⚠️ Les unités de vente et les prix n'entrent PAS en jeu.
 *
 * @param {Object} params
 * @param {string} params.nom
 * @param {number|null} params.idModele
 * @param {number|null} params.idMarque   ← ✅ NOUVEAU
 * @param {number} params.id_utilisateur
 * @param {number|null} [params.excludeId] - ID à exclure (pour l'update)
 * @returns {Promise<Object|null>} Le produit en doublon ou null
 * ============================================================
 */
static async findDuplicate({
    nom,
    idModele = null,
    idMarque = null,
    id_utilisateur,
    excludeId = null
}) {
    if (!id_utilisateur) {
        throw new Error('id_utilisateur requis pour findDuplicate');
    }

    const conditions = [
        'p.id_utilisateur = ?',
        'LOWER(TRIM(p.nom)) = LOWER(TRIM(?))'
    ];
    const params = [id_utilisateur, nom];

    // Gestion des NULL pour id_modele
    if (idModele) {
        conditions.push('p.id_modele = ?');
        params.push(idModele);
    } else {
        conditions.push('p.id_modele IS NULL');
    }

    // ✅ Gestion des NULL pour id_marque
    if (idMarque) {
        conditions.push('p.id_marque = ?');
        params.push(idMarque);
    } else {
        conditions.push('p.id_marque IS NULL');
    }

    // Exclure le produit en cours d'édition
    if (excludeId) {
        conditions.push('p.id_produit != ?');
        params.push(excludeId);
    }

    const [rows] = await pool.execute(
        `SELECT p.id_produit,
                p.nom,
                p.id_modele,
                p.id_marque,
                md.nom AS modele_nom,
                m.nom AS marque_nom
         FROM produits p
         LEFT JOIN modeles md ON p.id_modele = md.id_modele
         LEFT JOIN marques m ON p.id_marque = m.id_marque
         WHERE ${conditions.join(' AND ')}
         LIMIT 1`,
        params
    );

    return rows[0] || null;
}

    /**
     * ============================================================
     * Rechercher des produits (workspace)
     * ============================================================
     */
    static async search(keyword, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
               AND (p.nom LIKE ?
                    OR p.description LIKE ?
                    OR f.nom LIKE ?)
             ORDER BY p.nom ASC`,
            [id_utilisateur, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits par catégorie
     * ============================================================
     */
    static async findByCategorie(idCategorie, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCategorie');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_categorie = ?
               AND p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [idCategorie, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits par marque
     * ============================================================
     */
    static async findByMarque(idMarque, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByMarque');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_marque = ?
               AND p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [idMarque, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits par fournisseur
     * ============================================================
     */
    static async findByFournisseur(idFournisseur, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByFournisseur');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_fournisseur = ?
               AND p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [idFournisseur, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits en rupture
     * ============================================================
     */
    static async findRupture(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findRupture');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
               AND (p.statut = 'rupture' OR p.quantite_stock <= p.quantite_minimale)
             ORDER BY p.nom ASC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits avec stock bas
     * ============================================================
     */
    static async findStockBas(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findStockBas');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
               AND p.quantite_stock <= p.quantite_minimale
               AND p.quantite_stock > 0
             ORDER BY p.quantite_stock ASC`,
            [id_utilisateur]
        );
        return rows;
    }

static async findByModele(modeleNom, id_utilisateur) {
    if (!id_utilisateur) {
        throw new Error('id_utilisateur requis pour findByModele');
    }

    const [rows] = await pool.execute(
        `SELECT p.*,
                c.nom as categorie_nom,
                m.nom as marque_nom,
                md.nom as modele_nom,
                u.nom as unite_nom,
                u.symbole as unite_symbole,
                f.nom as fournisseur_nom
         FROM produits p
         LEFT JOIN categories c ON p.id_categorie = c.id_categorie
         LEFT JOIN marques m ON p.id_marque = m.id_marque
         LEFT JOIN modeles md ON p.id_modele = md.id_modele
         LEFT JOIN unites u ON p.id_unite = u.id_unite
         LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
         WHERE p.id_utilisateur = ?
           AND (md.nom LIKE ? OR p.nom LIKE ?)
         ORDER BY p.nom ASC`,
        [id_utilisateur, `%${modeleNom}%`, `%${modeleNom}%`]
    );

    // ✅ AJOUT : Charger les unités de vente
    return await this.findManyWithUnites(rows, id_utilisateur);
}

    /**
     * ============================================================
     * Récupérer les produits par ID de modèle
     * ============================================================
     */
    static async findByModeleId(idModele, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByModeleId');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_modele = ?
               AND p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [idModele, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits par statut
     * ============================================================
     */
    static async findByStatut(statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.statut = ?
               AND p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [statut, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits par plage de prix
     * ============================================================
     */
    static async findByPrixRange(prixMin, prixMax, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByPrixRange');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.prix_vente BETWEEN ? AND ?
               AND p.id_utilisateur = ?
             ORDER BY p.prix_vente ASC`,
            [prixMin, prixMax, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les produits par plage de stock
     * ============================================================
     */
    static async findByStockRange(stockMin, stockMax, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStockRange');
        }

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.quantite_stock BETWEEN ? AND ?
               AND p.id_utilisateur = ?
             ORDER BY p.quantite_stock ASC`,
            [stockMin, stockMax, id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Créer un nouveau produit
     * ============================================================
     */
    static async create(data, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }

        const {
            nom,
            description,
            id_fournisseur,
            id_categorie,
            id_marque,
            id_modele,
            id_unite,
            prix_achat,
            prix_vente,
            quantite_stock,
            quantite_minimale,
            quantite_maximale,
            emplacement,
            rayon,
            etagere,
            statut
        } = data;

        const [result] = await pool.execute(
            `INSERT INTO produits (
                id_utilisateur, nom, description, id_fournisseur, id_categorie,
                id_marque, id_modele, id_unite, prix_achat, prix_vente, quantite_stock,
                quantite_minimale, quantite_maximale, emplacement, rayon,
                etagere, statut
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id_utilisateur,
                nom,
                description,
                id_fournisseur,
                id_categorie,
                id_marque,
                id_modele,
                id_unite,
                prix_achat || 0,
                prix_vente || 0,
                quantite_stock || 0,
                quantite_minimale || 0,
                quantite_maximale || 0,
                emplacement,
                rayon,
                etagere,
                statut || 'disponible'
            ]
        );

        return result.insertId;
    }

    /**
     * ============================================================
     * Mettre à jour un produit
     * ============================================================
     */
    static async update(id, data, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const {
            nom,
            description,
            id_fournisseur,
            id_categorie,
            id_marque,
            id_modele,
            id_unite,
            prix_achat,
            prix_vente,
            quantite_stock,
            quantite_minimale,
            quantite_maximale,
            emplacement,
            rayon,
            etagere,
            statut
        } = data;

        const [result] = await pool.execute(
            `UPDATE produits SET
                nom = ?,
                description = ?,
                id_fournisseur = ?,
                id_categorie = ?,
                id_marque = ?,
                id_modele = ?,
                id_unite = ?,
                prix_achat = ?,
                prix_vente = ?,
                quantite_stock = ?,
                quantite_minimale = ?,
                quantite_maximale = ?,
                emplacement = ?,
                rayon = ?,
                etagere = ?,
                statut = ?
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [
                nom,
                description,
                id_fournisseur,
                id_categorie,
                id_marque,
                id_modele,
                id_unite,
                prix_achat || 0,
                prix_vente || 0,
                quantite_stock || 0,
                quantite_minimale || 0,
                quantite_maximale || 0,
                emplacement,
                rayon,
                etagere,
                statut || 'disponible',
                id,
                id_utilisateur
            ]
        );

        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Mettre à jour le stock (workspace)
     * ============================================================
     */
    static async updateStock(id, quantite, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStock');
        }

        const [result] = await pool.execute(
            `UPDATE produits SET quantite_stock = ?
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [quantite, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Mettre à jour le statut (workspace)
     * ============================================================
     */
    static async updateStatus(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatus');
        }

        const [result] = await pool.execute(
            `UPDATE produits SET statut = ?
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [statut, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Supprimer un produit (workspace)
     * Les unités de vente sont supprimées en cascade
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const [result] = await pool.execute(
            `DELETE FROM produits
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Vérifier si un produit existe (workspace)
     * ============================================================
     */
    static async exists(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM produits
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Vérifier si un nom existe déjà (workspace)
     * ============================================================
     */
    static async nomExists(nom, id_utilisateur, excludeId = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour nomExists');
        }

        let query = `SELECT COUNT(*) as count FROM produits
                     WHERE nom = ? AND id_utilisateur = ?`;
        const params = [nom, id_utilisateur];

        if (excludeId) {
            query += ' AND id_produit != ?';
            params.push(excludeId);
        }

        const [rows] = await pool.execute(query, params);
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Statistiques des produits (workspace)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'disponible' THEN 1 ELSE 0 END) as disponibles,
                SUM(CASE WHEN statut = 'rupture' THEN 1 ELSE 0 END) as rupture,
                SUM(CASE WHEN quantite_stock <= quantite_minimale
                          AND quantite_stock > 0 THEN 1 ELSE 0 END) as stock_bas
             FROM produits
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            disponibles: parseInt(s.disponibles) || 0,
            rupture: parseInt(s.rupture) || 0,
            stockBas: parseInt(s.stock_bas) || 0
        };
    }

    /**
     * ============================================================
     * Compter les produits (workspace)
     * ============================================================
     */
    static async count(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour count');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total FROM produits WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );
        return parseInt(rows[0].total) || 0;
    }

    /**
     * ============================================================
     * Filtrer les produits (workspace)
     * ============================================================
     */
    static async filter(filters, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour filter');
        }

        let conditions = ['p.id_utilisateur = ?'];
        let params = [id_utilisateur];

        if (filters.categorie) {
            conditions.push('p.id_categorie = ?');
            params.push(filters.categorie);
        }

        if (filters.marque) {
            conditions.push('p.id_marque = ?');
            params.push(filters.marque);
        }

        if (filters.modele) {
            conditions.push('p.id_modele = ?');
            params.push(filters.modele);
        }

        if (filters.fournisseur) {
            conditions.push('p.id_fournisseur = ?');
            params.push(filters.fournisseur);
        }

        if (filters.statut) {
            conditions.push('p.statut = ?');
            params.push(filters.statut);
        }

        if (filters.stockMin !== undefined && filters.stockMin !== '') {
            conditions.push('p.quantite_stock >= ?');
            params.push(parseFloat(filters.stockMin));
        }

        if (filters.stockMax !== undefined && filters.stockMax !== '') {
            conditions.push('p.quantite_stock <= ?');
            params.push(parseFloat(filters.stockMax));
        }

        if (filters.prixMin !== undefined && filters.prixMin !== '') {
            conditions.push('p.prix_vente >= ?');
            params.push(parseFloat(filters.prixMin));
        }

        if (filters.prixMax !== undefined && filters.prixMax !== '') {
            conditions.push('p.prix_vente <= ?');
            params.push(parseFloat(filters.prixMax));
        }

        if (filters.search) {
            conditions.push('(p.nom LIKE ? OR p.description LIKE ? OR f.nom LIKE ?)');
            params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [rows] = await pool.execute(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             ${whereClause}
             ORDER BY p.nom ASC`,
            params
        );

        return rows;
    }

    /**
     * ============================================================
     * Pagination (workspace)
     * ============================================================
     */
    static async findPaginated(limit, offset, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findPaginated');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
        const offsetInt = Math.max(0, parseInt(offset, 10) || 0);

        const [rows] = await pool.query(
            `SELECT p.*,
                    c.nom as categorie_nom,
                    m.nom as marque_nom,
                    md.nom as modele_nom,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    f.nom as fournisseur_nom
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles md ON p.id_modele = md.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
             ORDER BY p.nom ASC
             LIMIT ${limitInt} OFFSET ${offsetInt}`,
            [id_utilisateur]
        );
        return rows;
    }
}

export default Produit;