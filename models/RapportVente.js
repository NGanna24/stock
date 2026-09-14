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
                SUM(lcv.quantite) AS total_vendu,
                SUM(lcv.montant_total) AS chiffre_affaires,
                COUNT(DISTINCT cv.id_commande) AS nombre_commandes
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom, c.nom
             ORDER BY total_vendu DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            id_produit: r.id_produit,
            produit_nom: r.produit_nom,
            marque_nom: r.marque_nom,
            categorie_nom: r.categorie_nom,
            total_vendu: parseFloat(r.total_vendu) || 0,
            chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
            nombre_commandes: parseInt(r.nombre_commandes) || 0
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