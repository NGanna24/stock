// models/Alerte.js
import { pool } from '../config/db.js';

class Alerte {
    /**
     * ============================================================
     * LISTE DES ALERTES DE STOCK (à partir des produits)
     * Calcule dynamiquement : rupture, stock bas, surstock
     * ✅ Retourne unite_nom, unite_symbole + TOUTES les unités de vente
     * ============================================================
     */
    static async findAll(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                p.quantite_stock,
                p.quantite_minimale,
                p.quantite_maximale,
                p.statut AS statut_produit,
                p.prix_achat,
                p.emplacement,
                p.rayon,
                p.etagere,
                c.nom AS categorie_nom,
                m.nom AS marque_nom,
                u.nom AS unite_nom,
                u.symbole AS unite_symbole,
                f.nom AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                uv_principal.nom AS unite_vente_nom,
                uv_principal.quantite_base AS unite_vente_quantite_base,
                uv_principal.prix_achat AS unite_vente_prix_achat,
                CASE
                    WHEN p.quantite_stock <= 0 THEN 'rupture'
                    WHEN p.quantite_stock <= p.quantite_minimale THEN 'stock_bas'
                    WHEN p.quantite_maximale > 0
                         AND p.quantite_stock >= p.quantite_maximale THEN 'surstock'
                    ELSE 'normal'
                END AS type_alerte,
                CASE
                    WHEN p.quantite_stock <= 0
                        THEN CONCAT('Rupture de stock : ', p.nom)
                    WHEN p.quantite_stock <= p.quantite_minimale
                        THEN CONCAT('Stock bas (', p.quantite_stock, ' / ', p.quantite_minimale, ') : ', p.nom)
                    WHEN p.quantite_maximale > 0 AND p.quantite_stock >= p.quantite_maximale
                        THEN CONCAT('Surstock (', p.quantite_stock, ' / ', p.quantite_maximale, ') : ', p.nom)
                    ELSE NULL
                END AS message
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             LEFT JOIN unites_vente uv_principal
                ON uv_principal.id_produit = p.id_produit
                AND uv_principal.est_principal = TRUE
                AND uv_principal.actif = TRUE
             WHERE p.id_utilisateur = ?
               AND (
                    p.quantite_stock <= 0
                    OR p.quantite_stock <= p.quantite_minimale
                    OR (p.quantite_maximale > 0 AND p.quantite_stock >= p.quantite_maximale)
               )
             ORDER BY
                FIELD(type_alerte, 'rupture', 'stock_bas', 'surstock'),
                p.nom ASC`,
            [id_utilisateur]
        );

        if (rows.length === 0) return [];

        // ✅ Charger TOUTES les unités de vente des produits en alerte
        const produitIds = rows.map(r => r.id_produit);
        const placeholders = produitIds.map(() => '?').join(',');

        const [allUnites] = await pool.execute(
            `SELECT id_unite_vente, id_produit, nom, quantite_base,
                    prix_vente, prix_achat, est_principal
             FROM unites_vente
             WHERE id_produit IN (${placeholders}) AND actif = TRUE
             ORDER BY est_principal DESC, quantite_base ASC`,
            produitIds
        );

        const unitesParProduit = {};
        allUnites.forEach(u => {
            if (!unitesParProduit[u.id_produit]) {
                unitesParProduit[u.id_produit] = [];
            }
            unitesParProduit[u.id_produit].push({
                id_unite_vente: u.id_unite_vente,
                nom: u.nom,
                quantite_base: parseFloat(u.quantite_base) || 1,
                prix_vente: parseFloat(u.prix_vente) || 0,
                prix_achat: parseFloat(u.prix_achat) || 0,
                est_principal: u.est_principal === 1 || u.est_principal === true,
            });
        });

        return rows.map(r => {
            const stock = parseFloat(r.quantite_stock) || 0;
            const min = parseFloat(r.quantite_minimale) || 0;
            const max = parseFloat(r.quantite_maximale) || 0;
            const prixAchat = parseFloat(r.prix_achat) || 0;

            const objectif = max > 0 ? max : (min > 0 ? min * 2 : 10);
            const qteACmd = (r.type_alerte === 'rupture' || r.type_alerte === 'stock_bas')
                ? Math.max(0, objectif - stock)
                : 0;

            return {
                ...r,
                quantite_stock: stock,
                quantite_minimale: min,
                quantite_maximale: max,
                prix_achat: prixAchat,
                quantite_a_commander: qteACmd,
                valeur_manque: prixAchat * qteACmd,
                quantite_a_commander_unite_vente:
                    r.unite_vente_quantite_base > 0
                        ? Math.ceil(qteACmd / parseFloat(r.unite_vente_quantite_base))
                        : null,
                // ✅ Toutes les unités de vente du produit
                unites_vente: unitesParProduit[r.id_produit] || [],
            };
        });
    }

    /**
     * ============================================================
     * TOTAUX ET RÉSUMÉ DES ALERTES
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS total_alertes,
                SUM(CASE WHEN quantite_stock <= 0 THEN 1 ELSE 0 END) AS total_rupture,
                SUM(CASE WHEN quantite_stock > 0 AND quantite_stock <= quantite_minimale THEN 1 ELSE 0 END) AS total_stock_bas,
                SUM(CASE WHEN quantite_maximale > 0 AND quantite_stock >= quantite_maximale THEN 1 ELSE 0 END) AS total_surstock,
                COALESCE(SUM(
                    CASE
                        WHEN quantite_stock <= 0 OR quantite_stock <= quantite_minimale
                        THEN (COALESCE(NULLIF(quantite_maximale, 0), quantite_minimale * 2, 10) - quantite_stock) * prix_achat
                        ELSE 0
                    END
                ), 0) AS valeur_reapprovisionnement
             FROM produits
             WHERE id_utilisateur = ?
               AND (
                    quantite_stock <= 0
                    OR quantite_stock <= quantite_minimale
                    OR (quantite_maximale > 0 AND quantite_stock >= quantite_maximale)
               )`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total_alertes: parseInt(s.total_alertes) || 0,
            total_rupture: parseInt(s.total_rupture) || 0,
            total_stock_bas: parseInt(s.total_stock_bas) || 0,
            total_surstock: parseInt(s.total_surstock) || 0,
            valeur_reapprovisionnement: parseFloat(s.valeur_reapprovisionnement) || 0
        };
    }

    /**
     * ============================================================
     * ALERTES PAR CATÉGORIE
     * ============================================================
     */
    static async getAlertesParCategorie(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAlertesParCategorie');
        }

        const [rows] = await pool.execute(
            `SELECT
                COALESCE(c.nom, 'Sans catégorie') AS categorie_nom,
                COUNT(*) AS nombre_alertes,
                SUM(CASE WHEN p.quantite_stock <= 0 THEN 1 ELSE 0 END) AS ruptures,
                SUM(CASE WHEN p.quantite_stock > 0 AND p.quantite_stock <= p.quantite_minimale THEN 1 ELSE 0 END) AS stocks_bas
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             WHERE p.id_utilisateur = ?
               AND (
                    p.quantite_stock <= 0
                    OR p.quantite_stock <= p.quantite_minimale
               )
             GROUP BY c.id_categorie, c.nom
             ORDER BY nombre_alertes DESC`,
            [id_utilisateur]
        );

        return rows.map(r => ({
            categorie_nom: r.categorie_nom,
            nombre_alertes: parseInt(r.nombre_alertes) || 0,
            ruptures: parseInt(r.ruptures) || 0,
            stocks_bas: parseInt(r.stocks_bas) || 0
        }));
    }

    /**
     * ============================================================
     * ALERTES PAR FOURNISSEUR
     * ============================================================
     */
    static async getAlertesParFournisseur(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAlertesParFournisseur');
        }

        const [rows] = await pool.execute(
            `SELECT
                f.id_fournisseur,
                COALESCE(f.nom, 'Sans fournisseur') AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                f.email AS fournisseur_email,
                COUNT(*) AS nombre_alertes,
                SUM(CASE WHEN p.quantite_stock <= 0 THEN 1 ELSE 0 END) AS ruptures,
                SUM(CASE WHEN p.quantite_stock > 0 AND p.quantite_stock <= p.quantite_minimale THEN 1 ELSE 0 END) AS stocks_bas,
                COALESCE(SUM(
                    CASE
                        WHEN p.quantite_stock <= 0 OR p.quantite_stock <= p.quantite_minimale
                        THEN (COALESCE(NULLIF(p.quantite_maximale, 0), p.quantite_minimale * 2, 10) - p.quantite_stock) * p.prix_achat
                        ELSE 0
                    END
                ), 0) AS valeur_a_commander
             FROM produits p
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
               AND (
                    p.quantite_stock <= 0
                    OR p.quantite_stock <= p.quantite_minimale
               )
             GROUP BY f.id_fournisseur, f.nom, f.telephone, f.email
             ORDER BY nombre_alertes DESC`,
            [id_utilisateur]
        );

        return rows.map(r => ({
            id_fournisseur: r.id_fournisseur,
            fournisseur_nom: r.fournisseur_nom,
            fournisseur_telephone: r.fournisseur_telephone,
            fournisseur_email: r.fournisseur_email,
            nombre_alertes: parseInt(r.nombre_alertes) || 0,
            ruptures: parseInt(r.ruptures) || 0,
            stocks_bas: parseInt(r.stocks_bas) || 0,
            valeur_a_commander: parseFloat(r.valeur_a_commander) || 0
        }));
    }

    /**
     * ============================================================
     * PRODUITS EN RUPTURE UNIQUEMENT
     * ============================================================
     */
    static async getRuptures(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getRuptures');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                p.quantite_stock,
                p.quantite_minimale,
                p.prix_achat,
                c.nom AS categorie_nom,
                m.nom AS marque_nom,
                u.nom AS unite_nom,
                u.symbole AS unite_symbole,
                f.nom AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                uv_principal.nom AS unite_vente_nom,
                uv_principal.quantite_base AS unite_vente_quantite_base
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             LEFT JOIN unites_vente uv_principal
                ON uv_principal.id_produit = p.id_produit
                AND uv_principal.est_principal = TRUE
                AND uv_principal.actif = TRUE
             WHERE p.id_utilisateur = ?
               AND p.quantite_stock <= 0
             ORDER BY p.nom ASC`,
            [id_utilisateur]
        );

        if (rows.length === 0) return [];

        const produitIds = rows.map(r => r.id_produit);
        const placeholders = produitIds.map(() => '?').join(',');

        const [allUnites] = await pool.execute(
            `SELECT id_unite_vente, id_produit, nom, quantite_base,
                    prix_vente, prix_achat, est_principal
             FROM unites_vente
             WHERE id_produit IN (${placeholders}) AND actif = TRUE
             ORDER BY est_principal DESC, quantite_base ASC`,
            produitIds
        );

        const unitesParProduit = {};
        allUnites.forEach(u => {
            if (!unitesParProduit[u.id_produit]) {
                unitesParProduit[u.id_produit] = [];
            }
            unitesParProduit[u.id_produit].push({
                id_unite_vente: u.id_unite_vente,
                nom: u.nom,
                quantite_base: parseFloat(u.quantite_base) || 1,
                prix_vente: parseFloat(u.prix_vente) || 0,
                prix_achat: parseFloat(u.prix_achat) || 0,
                est_principal: u.est_principal === 1 || u.est_principal === true,
            });
        });

        return rows.map(r => ({
            ...r,
            quantite_stock: parseFloat(r.quantite_stock) || 0,
            quantite_minimale: parseFloat(r.quantite_minimale) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            unites_vente: unitesParProduit[r.id_produit] || [],
        }));
    }

    /**
     * ============================================================
     * PRODUITS EN STOCK BAS
     * ============================================================
     */
    static async getStockBas(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStockBas');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                p.quantite_stock,
                p.quantite_minimale,
                p.quantite_maximale,
                p.prix_achat,
                c.nom AS categorie_nom,
                m.nom AS marque_nom,
                u.nom AS unite_nom,
                u.symbole AS unite_symbole,
                f.nom AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                uv_principal.nom AS unite_vente_nom,
                uv_principal.quantite_base AS unite_vente_quantite_base
             FROM produits p
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             LEFT JOIN unites_vente uv_principal
                ON uv_principal.id_produit = p.id_produit
                AND uv_principal.est_principal = TRUE
                AND uv_principal.actif = TRUE
             WHERE p.id_utilisateur = ?
               AND p.quantite_stock > 0
               AND p.quantite_stock <= p.quantite_minimale
             ORDER BY p.quantite_stock ASC`,
            [id_utilisateur]
        );

        if (rows.length === 0) return [];

        const produitIds = rows.map(r => r.id_produit);
        const placeholders = produitIds.map(() => '?').join(',');

        const [allUnites] = await pool.execute(
            `SELECT id_unite_vente, id_produit, nom, quantite_base,
                    prix_vente, prix_achat, est_principal
             FROM unites_vente
             WHERE id_produit IN (${placeholders}) AND actif = TRUE
             ORDER BY est_principal DESC, quantite_base ASC`,
            produitIds
        );

        const unitesParProduit = {};
        allUnites.forEach(u => {
            if (!unitesParProduit[u.id_produit]) {
                unitesParProduit[u.id_produit] = [];
            }
            unitesParProduit[u.id_produit].push({
                id_unite_vente: u.id_unite_vente,
                nom: u.nom,
                quantite_base: parseFloat(u.quantite_base) || 1,
                prix_vente: parseFloat(u.prix_vente) || 0,
                prix_achat: parseFloat(u.prix_achat) || 0,
                est_principal: u.est_principal === 1 || u.est_principal === true,
            });
        });

        return rows.map(r => ({
            ...r,
            quantite_stock: parseFloat(r.quantite_stock) || 0,
            quantite_minimale: parseFloat(r.quantite_minimale) || 0,
            quantite_maximale: parseFloat(r.quantite_maximale) || 0,
            prix_achat: parseFloat(r.prix_achat) || 0,
            pourcentage_restant: r.quantite_minimale > 0
                ? ((parseFloat(r.quantite_stock) / parseFloat(r.quantite_minimale)) * 100)
                : 0,
            unites_vente: unitesParProduit[r.id_produit] || [],
        }));
    }
}

export default Alerte;