// models/RapportVente.js
import { pool } from '../config/db.js';

class RapportVente {
    /**
     * ============================================================
     * RAPPORT DES VENTES PAR PÉRIODE
     * ============================================================
     */
    static async getVentesByPeriod(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getVentesByPeriod');
        }

        const [rows] = await pool.execute(
            `SELECT
                cv.id_commande,
                cv.numero_commande,
                cv.date_commande,
                cv.nomclient,
                cv.telephone,
                cv.statut,
                cv.montant_total,
                fv.numero_facture,
                fv.statut AS statut_facture,
                fv.mode_paiement,
                DATE_FORMAT(cv.date_commande, '%d/%m/%Y') AS date_formatee
             FROM commandes_vente cv
             LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             ORDER BY cv.date_commande DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows;
    }

    /**
     * ============================================================
     * TOTAUX ET STATISTIQUES DU RAPPORT
     * ============================================================
     */
    static async getTotauxVentes(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTotauxVentes');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS nombre_commandes,
                COALESCE(SUM(montant_total), 0) AS chiffre_affaires,
                COALESCE(AVG(montant_total), 0) AS panier_moyen,
                SUM(CASE WHEN statut = 'livree' THEN 1 ELSE 0 END) AS commandes_livrees,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) AS commandes_en_attente,
                SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) AS commandes_annulees
             FROM commandes_vente
             WHERE id_utilisateur = ?
               AND date_commande BETWEEN ? AND ?`,
            [id_utilisateur, dateDebut, dateFin]
        );

        const t = rows[0];
        return {
            nombre_commandes: parseInt(t.nombre_commandes) || 0,
            chiffre_affaires: parseFloat(t.chiffre_affaires) || 0,
            panier_moyen: parseFloat(t.panier_moyen) || 0,
            commandes_livrees: parseInt(t.commandes_livrees) || 0,
            commandes_en_attente: parseInt(t.commandes_en_attente) || 0,
            commandes_annulees: parseInt(t.commandes_annulees) || 0
        };
    }

    /**
     * ============================================================
     * VENTES PAR PRODUIT
     * ============================================================
     */
    static async getVentesParProduit(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getVentesParProduit');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                m.nom AS marque_nom,
                c.nom AS categorie_nom,
                u.nom AS unite_nom,
                u.symbole AS unite_symbole,
                SUM(lcv.quantite_totale_base) AS total_vendu_base,
                SUM(lcv.quantite) AS total_vendu_uv,
                SUM(lcv.montant_total) AS chiffre_affaires,
                COUNT(DISTINCT cv.id_commande) AS nombre_commandes
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom, c.nom, u.nom, u.symbole
             ORDER BY total_vendu_base DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        if (rows.length === 0) return [];

        // ✅ Charger toutes les unités de vente des produits concernés
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
            id_produit: r.id_produit,
            produit_nom: r.produit_nom,
            marque_nom: r.marque_nom,
            categorie_nom: r.categorie_nom,
            unite_nom: r.unite_nom,
            unite_symbole: r.unite_symbole,
            // ✅ Quantité totale en unité de base (pour StockSelector)
            total_vendu_base: parseFloat(r.total_vendu_base) || 0,
            // ✅ Quantité en unité de vente (info)
            total_vendu: parseFloat(r.total_vendu_base) || 0,  // gardé pour compat
            total_vendu_uv: parseFloat(r.total_vendu_uv) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            unites_vente: unitesParProduit[r.id_produit] || [],
        }));
    }

    /**
     * ============================================================
     * VENTES PAR JOUR
     * ============================================================
     */
    static async getVentesParJour(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getVentesParJour');
        }

        const [rows] = await pool.execute(
            `SELECT
                DATE(date_commande) AS date,
                COUNT(*) AS nombre_commandes,
                COALESCE(SUM(montant_total), 0) AS chiffre_affaires
             FROM commandes_vente
             WHERE id_utilisateur = ?
               AND date_commande BETWEEN ? AND ?
               AND statut != 'annulee'
             GROUP BY DATE(date_commande)
             ORDER BY date ASC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            date: r.date,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0
        }));
    }

    /**
     * ============================================================
     * VENTES PAR STATUT
     * ============================================================
     */
    static async getVentesParStatut(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getVentesParStatut');
        }

        const [rows] = await pool.execute(
            `SELECT
                statut,
                COUNT(*) AS nombre,
                COALESCE(SUM(montant_total), 0) AS montant_total
             FROM commandes_vente
             WHERE id_utilisateur = ?
               AND date_commande BETWEEN ? AND ?
             GROUP BY statut
             ORDER BY nombre DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            statut: r.statut,
            nombre: parseInt(r.nombre) || 0,
            montant_total: parseFloat(r.montant_total) || 0
        }));
    }

    /**
     * ============================================================
     * TOP CLIENTS
     * ============================================================
     */
    static async getTopClients(dateDebut, dateFin, id_utilisateur, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopClients');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                nomclient,
                telephone,
                COUNT(*) AS nombre_commandes,
                COALESCE(SUM(montant_total), 0) AS chiffre_affaires
             FROM commandes_vente
             WHERE id_utilisateur = ?
               AND date_commande BETWEEN ? AND ?
               AND statut != 'annulee'
               AND nomclient IS NOT NULL
             GROUP BY nomclient, telephone
             ORDER BY chiffre_affaires DESC
             LIMIT ${limitInt}`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            nomclient: r.nomclient,
            telephone: r.telephone,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0
        }));
    }
}

export default RapportVente;