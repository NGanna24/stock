// models/RapportStock.js
import { pool } from '../config/db.js';

class RapportStock {
    /**
     * ============================================================
     * VUE D'ENSEMBLE DU STOCK (tous les produits)
     * ============================================================
     */
    static async getStockGlobal(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStockGlobal');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                p.quantite_stock,
                p.quantite_minimale,
                p.quantite_maximale,
                p.prix_achat,
                p.prix_vente,
                p.statut,
                p.emplacement,
                p.rayon,
                p.etagere,
                c.nom AS categorie_nom,
                m.nom AS marque_nom,
                md.nom AS modele_nom,
                u.symbole AS unite_symbole,
                f.nom AS fournisseur_nom,
                (p.quantite_stock * p.prix_achat) AS valeur_stock,
                CASE
                    WHEN p.quantite_stock <= 0 THEN 'rupture'
                    WHEN p.quantite_stock <= p.quantite_minimale THEN 'stock_bas'
                    WHEN p.quantite_stock >= p.quantite_maximale THEN 'surstock'
                    ELSE 'normal'
                END AS etat_stock
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

        return rows.map(r => ({
            ...r,
            quantite_stock: parseFloat(r.quantite_stock) || 0,
            quantite_minimale: parseFloat(r.quantite_minimale) || 0,
            quantite_maximale: parseFloat(r.quantite_maximale) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            prix_vente: parseFloat(r.prix_vente) || 0,
            valeur_stock: parseFloat(r.valeur_stock) || 0
        }));
    }

    /**
     * ============================================================
     * TOTAUX ET STATISTIQUES DU STOCK
     * ============================================================
     */
    static async getTotauxStock(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTotauxStock');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS nombre_produits,
                COALESCE(SUM(quantite_stock), 0) AS quantite_totale,
                COALESCE(SUM(quantite_stock * prix_achat), 0) AS valeur_achat,
                COALESCE(SUM(quantite_stock * prix_vente), 0) AS valeur_vente,
                SUM(CASE WHEN quantite_stock <= 0 THEN 1 ELSE 0 END) AS total_rupture,
                SUM(CASE WHEN quantite_stock > 0 AND quantite_stock <= quantite_minimale THEN 1 ELSE 0 END) AS total_stock_bas,
                SUM(CASE WHEN quantite_stock >= quantite_maximale AND quantite_maximale > 0 THEN 1 ELSE 0 END) AS total_surstock
             FROM produits
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const t = rows[0];
        return {
            nombre_produits: parseInt(t.nombre_produits) || 0,
            quantite_totale: parseFloat(t.quantite_totale) || 0,
            valeur_achat: parseFloat(t.valeur_achat) || 0,
            valeur_vente: parseFloat(t.valeur_vente) || 0,
            total_rupture: parseInt(t.total_rupture) || 0,
            total_stock_bas: parseInt(t.total_stock_bas) || 0,
            total_surstock: parseInt(t.total_surstock) || 0
        };
    }

    /**
     * ============================================================
     * STOCK PAR CATÉGORIE
     * ============================================================
     */
    static async getStockParCategorie(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStockParCategorie');
        }

        const [rows] = await pool.execute(
            `SELECT
                c.id_categorie,
                COALESCE(c.nom, 'Sans catégorie') AS categorie_nom,
                COUNT(p.id_produit) AS nombre_produits,
                COALESCE(SUM(p.quantite_stock), 0) AS quantite_totale,
                COALESCE(SUM(p.quantite_stock * p.prix_achat), 0) AS valeur_achat,
                COALESCE(SUM(p.quantite_stock * p.prix_vente), 0) AS valeur_vente
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             WHERE p.id_utilisateur = ?
             GROUP BY c.id_categorie, c.nom
             ORDER BY valeur_achat DESC`,
            [id_utilisateur]
        );

        return rows.map(r => ({
            id_categorie: r.id_categorie,
            categorie_nom: r.categorie_nom,
            nombre_produits: parseInt(r.nombre_produits) || 0,
            quantite_totale: parseFloat(r.quantite_totale) || 0,
            valeur_achat: parseFloat(r.valeur_achat) || 0,
            valeur_vente: parseFloat(r.valeur_vente) || 0
        }));
    }

    /**
     * ============================================================
     * STOCK PAR MARQUE
     * ============================================================
     */
    static async getStockParMarque(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStockParMarque');
        }

        const [rows] = await pool.execute(
            `SELECT
                m.id_marque,
                COALESCE(m.nom, 'Sans marque') AS marque_nom,
                COUNT(p.id_produit) AS nombre_produits,
                COALESCE(SUM(p.quantite_stock), 0) AS quantite_totale,
                COALESCE(SUM(p.quantite_stock * p.prix_achat), 0) AS valeur_achat
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             WHERE p.id_utilisateur = ?
             GROUP BY m.id_marque, m.nom
             ORDER BY valeur_achat DESC`,
            [id_utilisateur]
        );

        return rows.map(r => ({
            id_marque: r.id_marque,
            marque_nom: r.marque_nom,
            nombre_produits: parseInt(r.nombre_produits) || 0,
            quantite_totale: parseFloat(r.quantite_totale) || 0,
            valeur_achat: parseFloat(r.valeur_achat) || 0
        }));
    }

    /**
     * ============================================================
     * PRODUITS EN ALERTE (rupture, stock bas, surstock)
     * ============================================================
     */
    static async getProduitsEnAlerte(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getProduitsEnAlerte');
        }

        const [rupture] = await pool.execute(
            `SELECT id_produit, nom AS produit_nom, quantite_stock, quantite_minimale
             FROM produits
             WHERE id_utilisateur = ? AND quantite_stock <= 0
             ORDER BY nom ASC`,
            [id_utilisateur]
        );

        const [stockBas] = await pool.execute(
            `SELECT id_produit, nom AS produit_nom, quantite_stock, quantite_minimale
             FROM produits
             WHERE id_utilisateur = ?
               AND quantite_stock > 0
               AND quantite_stock <= quantite_minimale
             ORDER BY quantite_stock ASC`,
            [id_utilisateur]
        );

        const [surstock] = await pool.execute(
            `SELECT id_produit, nom AS produit_nom, quantite_stock, quantite_maximale
             FROM produits
             WHERE id_utilisateur = ?
               AND quantite_maximale > 0
               AND quantite_stock >= quantite_maximale
             ORDER BY quantite_stock DESC`,
            [id_utilisateur]
        );

        const map = (arr) => arr.map(r => ({
            ...r,
            quantite_stock: parseFloat(r.quantite_stock) || 0,
            quantite_minimale: parseFloat(r.quantite_minimale) || 0,
            quantite_maximale: parseFloat(r.quantite_maximale) || 0
        }));

        return {
            rupture: map(rupture),
            stock_bas: map(stockBas),
            surstock: map(surstock)
        };
    }

    /**
     * ============================================================
     * TOP VALEUR STOCK (produits qui immobilisent le plus de capital)
     * ============================================================
     */
    static async getTopValeurStock(id_utilisateur, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopValeurStock');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                m.nom AS marque_nom,
                c.nom AS categorie_nom,
                p.quantite_stock,
                p.prix_achat,
                (p.quantite_stock * p.prix_achat) AS valeur_stock
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             WHERE p.id_utilisateur = ?
             ORDER BY valeur_stock DESC
             LIMIT ${limitInt}`,
            [id_utilisateur]
        );

        return rows.map(r => ({
            id_produit: r.id_produit,
            produit_nom: r.produit_nom,
            marque_nom: r.marque_nom,
            categorie_nom: r.categorie_nom,
            quantite_stock: parseFloat(r.quantite_stock) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            valeur_stock: parseFloat(r.valeur_stock) || 0
        }));
    }

    /**
     * ============================================================
     * MOUVEMENTS DE STOCK SUR LA PÉRIODE
     * ============================================================
     */
    static async getMouvementsByPeriod(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getMouvementsByPeriod');
        }

        const [rows] = await pool.execute(
            `SELECT
                m.id_mouvement,
                m.type_mouvement,
                m.quantite,
                m.ancienne_quantite,
                m.nouvelle_quantite,
                m.type_reference,
                m.notes,
                m.date_mouvement,
                p.nom AS produit_nom,
                ma.nom AS marque_nom,
                u.symbole AS unite_symbole,
                DATE_FORMAT(m.date_mouvement, '%d/%m/%Y %H:%i') AS date_formatee
             FROM mouvements_stock m
             LEFT JOIN produits p ON m.id_produit = p.id_produit
             LEFT JOIN marques ma ON p.id_marque = ma.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             WHERE m.id_utilisateur = ?
               AND DATE(m.date_mouvement) BETWEEN ? AND ?
             ORDER BY m.date_mouvement DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            ...r,
            quantite: parseFloat(r.quantite) || 0,
            ancienne_quantite: parseFloat(r.ancienne_quantite) || 0,
            nouvelle_quantite: parseFloat(r.nouvelle_quantite) || 0
        }));
    }
}

export default RapportStock;