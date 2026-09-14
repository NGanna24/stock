// models/Benefice.js
import { pool } from '../config/db.js';

class Benefice {
    /**
     * ============================================================
     * BÉNÉFICES PAR PÉRIODE
     * ============================================================
     */
    static async getBeneficesByPeriod(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getBeneficesByPeriod');
        }

        const [rows] = await pool.execute(
            `SELECT
                cv.id_commande,
                cv.numero_commande,
                cv.date_commande,
                cv.nomclient,
                cv.telephone,
                cv.montant_total AS ca_total,
                COALESCE(SUM(lcv.quantite * p.prix_achat), 0) AS cout_achat,
                COALESCE(SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)), 0) AS benefice,
                DATE_FORMAT(cv.date_commande, '%d/%m/%Y') AS date_formatee
             FROM commandes_vente cv
             JOIN ligne_commande_vente lcv ON cv.id_commande = lcv.id_commande
             JOIN produits p ON lcv.id_produit = p.id_produit
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY cv.id_commande, cv.numero_commande, cv.date_commande,
                      cv.nomclient, cv.telephone, cv.montant_total
             ORDER BY cv.date_commande DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            ...r,
            ca_total: parseFloat(r.ca_total) || 0,
            cout_achat: parseFloat(r.cout_achat) || 0,
            benefice: parseFloat(r.benefice) || 0
        }));
    }

    /**
     * ============================================================
     * TOTAUX ET MARGES GLOBALES
     * ============================================================
     */
    static async getTotauxBenefices(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTotauxBenefices');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(DISTINCT cv.id_commande) AS nombre_commandes,
                COALESCE(SUM(lcv.montant_total), 0) AS chiffre_affaires,
                COALESCE(SUM(lcv.quantite * p.prix_achat), 0) AS cout_achat,
                COALESCE(SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)), 0) AS benefice_brut,
                COALESCE(SUM(lcv.quantite), 0) AS quantite_vendue
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'`,
            [id_utilisateur, dateDebut, dateFin]
        );

        const t = rows[0];
        const ca = parseFloat(t.chiffre_affaires) || 0;
        const cout = parseFloat(t.cout_achat) || 0;
        const benefice = parseFloat(t.benefice_brut) || 0;

        return {
            nombre_commandes: parseInt(t.nombre_commandes) || 0,
            chiffre_affaires: ca,
            cout_achat: cout,
            benefice_brut: benefice,
            quantite_vendue: parseFloat(t.quantite_vendue) || 0,
            marge_brute_pct: ca > 0 ? ((benefice / ca) * 100) : 0,
            taux_marge: ca > 0 ? ((benefice / cout) * 100) : 0
        };
    }

    /**
     * ============================================================
     * BÉNÉFICES PAR PRODUIT
     * ============================================================
     */
    static async getBeneficesParProduit(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getBeneficesParProduit');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                m.nom AS marque_nom,
                c.nom AS categorie_nom,
                SUM(lcv.quantite) AS quantite_vendue,
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(lcv.quantite * p.prix_achat) AS cout_achat,
                SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)) AS benefice,
                p.prix_achat,
                p.prix_vente
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom, c.nom, p.prix_achat, p.prix_vente
             ORDER BY benefice DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const ca = parseFloat(r.chiffre_affaires) || 0;
            const benefice = parseFloat(r.benefice) || 0;
            const prixAchat = parseFloat(r.prix_achat) || 0;
            const prixVente = parseFloat(r.prix_vente) || 0;
            const margeUnitaire = prixVente - prixAchat;
            const margePct = prixVente > 0 ? ((margeUnitaire / prixVente) * 100) : 0;

            return {
                id_produit: r.id_produit,
                produit_nom: r.produit_nom,
                marque_nom: r.marque_nom,
                categorie_nom: r.categorie_nom,
                quantite_vendue: parseFloat(r.quantite_vendue) || 0,
                chiffre_affaires: ca,
                cout_achat: parseFloat(r.cout_achat) || 0,
                benefice: benefice,
                marge_pct: ca > 0 ? ((benefice / ca) * 100) : 0,
                prix_achat: prixAchat,
                prix_vente: prixVente,
                marge_unitaire: margeUnitaire,
                marge_unitaire_pct: margePct
            };
        });
    }

    /**
     * ============================================================
     * BÉNÉFICES PAR CATÉGORIE
     * ============================================================
     */
    static async getBeneficesParCategorie(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getBeneficesParCategorie');
        }

        const [rows] = await pool.execute(
            `SELECT
                c.id_categorie,
                COALESCE(c.nom, 'Sans catégorie') AS categorie_nom,
                COUNT(DISTINCT p.id_produit) AS nombre_produits,
                SUM(lcv.quantite) AS quantite_vendue,
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(lcv.quantite * p.prix_achat) AS cout_achat,
                SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)) AS benefice
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY c.id_categorie, c.nom
             ORDER BY benefice DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const ca = parseFloat(r.chiffre_affaires) || 0;
            const benefice = parseFloat(r.benefice) || 0;
            return {
                id_categorie: r.id_categorie,
                categorie_nom: r.categorie_nom,
                nombre_produits: parseInt(r.nombre_produits) || 0,
                quantite_vendue: parseFloat(r.quantite_vendue) || 0,
                chiffre_affaires: ca,
                cout_achat: parseFloat(r.cout_achat) || 0,
                benefice: benefice,
                marge_pct: ca > 0 ? ((benefice / ca) * 100) : 0
            };
        });
    }

    /**
     * ============================================================
     * ÉVOLUTION DES BÉNÉFICES PAR JOUR
     * ============================================================
     */
    static async getBeneficesParJour(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getBeneficesParJour');
        }

        const [rows] = await pool.execute(
            `SELECT
                DATE(cv.date_commande) AS date,
                COUNT(DISTINCT cv.id_commande) AS nombre_commandes,
                COALESCE(SUM(lcv.montant_total), 0) AS chiffre_affaires,
                COALESCE(SUM(lcv.quantite * p.prix_achat), 0) AS cout_achat,
                COALESCE(SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)), 0) AS benefice
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY DATE(cv.date_commande)
             ORDER BY date ASC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            date: r.date,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
            cout_achat: parseFloat(r.cout_achat) || 0,
            benefice: parseFloat(r.benefice) || 0
        }));
    }

    /**
     * ============================================================
     * TOP PRODUITS PAR BÉNÉFICE
     * ============================================================
     */
    static async getTopProduitsBenefice(dateDebut, dateFin, id_utilisateur, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopProduitsBenefice');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                m.nom AS marque_nom,
                SUM(lcv.quantite) AS quantite_vendue,
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)) AS benefice
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom
             ORDER BY benefice DESC
             LIMIT ${limitInt}`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            id_produit: r.id_produit,
            produit_nom: r.produit_nom,
            marque_nom: r.marque_nom,
            quantite_vendue: parseFloat(r.quantite_vendue) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
            benefice: parseFloat(r.benefice) || 0
        }));
    }

    /**
     * ============================================================
     * TOP CLIENTS PAR BÉNÉFICE GÉNÉRÉ
     * ============================================================
     */
    static async getTopClientsBenefice(dateDebut, dateFin, id_utilisateur, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopClientsBenefice');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                cv.nomclient,
                cv.telephone,
                COUNT(DISTINCT cv.id_commande) AS nombre_commandes,
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)) AS benefice
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
               AND cv.nomclient IS NOT NULL
             GROUP BY cv.nomclient, cv.telephone
             ORDER BY benefice DESC
             LIMIT ${limitInt}`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            nomclient: r.nomclient,
            telephone: r.telephone,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
            benefice: parseFloat(r.benefice) || 0
        }));
    }

    /**
     * ============================================================
     * PRODUITS LES PLUS RENTABLES (par marge %)
     * ============================================================
     */
    static async getProduitsPlusRentables(dateDebut, dateFin, id_utilisateur, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getProduitsPlusRentables');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                m.nom AS marque_nom,
                p.prix_achat,
                p.prix_vente,
                (p.prix_vente - p.prix_achat) AS marge_unitaire,
                CASE WHEN p.prix_vente > 0
                     THEN ((p.prix_vente - p.prix_achat) / p.prix_vente) * 100
                     ELSE 0
                END AS marge_pct,
                COALESCE(SUM(lcv.quantite), 0) AS quantite_vendue,
                COALESCE(SUM(lcv.montant_total - (lcv.quantite * p.prix_achat)), 0) AS benefice_total
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN ligne_commande_vente lcv ON p.id_produit = lcv.id_produit
             LEFT JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 AND cv.date_commande BETWEEN ? AND ?
                 AND cv.statut != 'annulee'
             WHERE p.id_utilisateur = ?
               AND p.prix_vente > 0
             GROUP BY p.id_produit, p.nom, m.nom, p.prix_achat, p.prix_vente
             HAVING quantite_vendue > 0
             ORDER BY marge_pct DESC
             LIMIT ${limitInt}`,
            [dateDebut, dateFin, id_utilisateur]
        );

        return rows.map(r => ({
            id_produit: r.id_produit,
            produit_nom: r.produit_nom,
            marque_nom: r.marque_nom,
            prix_achat: parseFloat(r.prix_achat) || 0,
            prix_vente: parseFloat(r.prix_vente) || 0,
            marge_unitaire: parseFloat(r.marge_unitaire) || 0,
            marge_pct: parseFloat(r.marge_pct) || 0,
            quantite_vendue: parseFloat(r.quantite_vendue) || 0,
            benefice_total: parseFloat(r.benefice_total) || 0
        }));
    }
}

export default Benefice;