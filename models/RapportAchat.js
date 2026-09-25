// models/RapportAchat.js
import { pool } from '../config/db.js';

class RapportAchat {
    /**
     * ============================================================
     * RAPPORT DES ACHATS PAR PÉRIODE
     * ============================================================
     */
    static async getAchatsByPeriod(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAchatsByPeriod');
        }

        const [rows] = await pool.execute(
            `SELECT
                ca.id_commande_achat,
                ca.numero_commande,
                ca.date_commande,
                ca.statut,
                ca.montant_total,
                f.nom AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                f.ville AS fournisseur_ville,
                r.numero_reception,
                r.statut AS statut_reception,
                DATE_FORMAT(ca.date_commande, '%d/%m/%Y') AS date_formatee
             FROM commandes_achat ca
             LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
             LEFT JOIN receptions r ON ca.id_commande_achat = r.id_commande_achat
             WHERE ca.id_utilisateur = ?
               AND ca.date_commande BETWEEN ? AND ?
               AND ca.statut != 'annulee'
             ORDER BY ca.date_commande DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows;
    }

    /**
     * ============================================================
     * TOTAUX ET STATISTIQUES DES ACHATS
     * ============================================================
     */
    static async getTotauxAchats(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTotauxAchats');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS nombre_commandes,
                COALESCE(SUM(montant_total), 0) AS montant_total,
                COALESCE(AVG(montant_total), 0) AS panier_moyen,
                SUM(CASE WHEN statut = 'recue' THEN 1 ELSE 0 END) AS commandes_recues,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) AS commandes_en_attente,
                SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) AS commandes_annulees
             FROM commandes_achat
             WHERE id_utilisateur = ?
               AND date_commande BETWEEN ? AND ?`,
            [id_utilisateur, dateDebut, dateFin]
        );

        const t = rows[0];
        return {
            nombre_commandes: parseInt(t.nombre_commandes) || 0,
            montant_total: parseFloat(t.montant_total) || 0,
            panier_moyen: parseFloat(t.panier_moyen) || 0,
            commandes_recues: parseInt(t.commandes_recues) || 0,
            commandes_en_attente: parseInt(t.commandes_en_attente) || 0,
            commandes_annulees: parseInt(t.commandes_annulees) || 0
        };
    }

    /**
     * ============================================================
     * ACHATS PAR PRODUIT
     * ============================================================
     */
    static async getAchatsParProduit(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAchatsParProduit');
        }

        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                m.nom AS marque_nom,
                c.nom AS categorie_nom,
                u.nom AS unite_nom,
                u.symbole AS unite_symbole,
                SUM(lca.quantite_totale_base) AS total_achete_base,
                SUM(lca.quantite) AS total_achete_uv,
                SUM(lca.montant_total) AS montant_total,
                COUNT(DISTINCT ca.id_commande_achat) AS nombre_commandes
             FROM ligne_commande_achat lca
             JOIN produits p ON lca.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             JOIN commandes_achat ca ON lca.id_commande_achat = ca.id_commande_achat
             WHERE ca.id_utilisateur = ?
               AND ca.date_commande BETWEEN ? AND ?
               AND ca.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom, c.nom, u.nom, u.symbole
             ORDER BY total_achete_base DESC`,
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
            total_achete_base: parseFloat(r.total_achete_base) || 0,
            total_achete: parseFloat(r.total_achete_base) || 0,
            total_achete_uv: parseFloat(r.total_achete_uv) || 0,
            montant_total: parseFloat(r.montant_total) || 0,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            unites_vente: unitesParProduit[r.id_produit] || [],
        }));
    }

    /**
     * ============================================================
     * ACHATS PAR JOUR
     * ============================================================
     */
    static async getAchatsParJour(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAchatsParJour');
        }

        const [rows] = await pool.execute(
            `SELECT
                DATE(date_commande) AS date,
                COUNT(*) AS nombre_commandes,
                COALESCE(SUM(montant_total), 0) AS montant_total
             FROM commandes_achat
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
            montant_total: parseFloat(r.montant_total) || 0
        }));
    }

    /**
     * ============================================================
     * ACHATS PAR STATUT
     * ============================================================
     */
    static async getAchatsParStatut(dateDebut, dateFin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAchatsParStatut');
        }

        const [rows] = await pool.execute(
            `SELECT
                statut,
                COUNT(*) AS nombre,
                COALESCE(SUM(montant_total), 0) AS montant_total
             FROM commandes_achat
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
     * TOP FOURNISSEURS
     * ============================================================
     */
    static async getTopFournisseurs(dateDebut, dateFin, id_utilisateur, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopFournisseurs');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                f.id_fournisseur,
                f.nom AS fournisseur_nom,
                f.telephone,
                f.ville,
                COUNT(ca.id_commande_achat) AS nombre_commandes,
                COALESCE(SUM(ca.montant_total), 0) AS montant_total
             FROM commandes_achat ca
             JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
             WHERE ca.id_utilisateur = ?
               AND ca.date_commande BETWEEN ? AND ?
               AND ca.statut != 'annulee'
             GROUP BY f.id_fournisseur, f.nom, f.telephone, f.ville
             ORDER BY montant_total DESC
             LIMIT ${limitInt}`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => ({
            id_fournisseur: r.id_fournisseur,
            fournisseur_nom: r.fournisseur_nom,
            telephone: r.telephone,
            ville: r.ville,
            nombre_commandes: parseInt(r.nombre_commandes) || 0,
            montant_total: parseFloat(r.montant_total) || 0
        }));
    }
}

export default RapportAchat;