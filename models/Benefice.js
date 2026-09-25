// models/Benefice.js
import { pool } from '../config/db.js';

/**
 * ============================================================
 * LOGIQUE MÉTIER — Calcul du bénéfice
 * ============================================================
 * (identique, on garde la même logique)
 */
class Benefice {
    static get PRIX_ACHAT_UNITE_SQL() {
        return `
            CASE
                WHEN uv.prix_achat IS NOT NULL AND uv.prix_achat > 0
                    THEN uv.prix_achat
                WHEN p.prix_achat IS NOT NULL AND p.prix_achat > 0
                    THEN p.prix_achat * COALESCE(lcv.quantite_base, 1)
                ELSE NULL
            END
        `;
    }

    /**
     * ============================================================
     * BÉNÉFICES PAR PÉRIODE (liste des commandes)
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

                COALESCE(SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.quantite * uv.prix_achat
                        WHEN p.prix_achat > 0
                            THEN lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1))
                        ELSE 0
                    END
                ), 0) AS cout_achat,

                COALESCE(SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ), 0) AS benefice_calcule,

                COUNT(CASE
                    WHEN uv.prix_achat IS NULL OR uv.prix_achat <= 0
                        THEN 1
                END) AS nb_lignes_prix_uv,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND p.prix_achat > 0
                        THEN 1
                END) AS nb_lignes_prix_produit,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix,

                DATE_FORMAT(cv.date_commande, '%d/%m/%Y') AS date_formatee
             FROM commandes_vente cv
             JOIN ligne_commande_vente lcv ON cv.id_commande = lcv.id_commande
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY cv.id_commande, cv.numero_commande, cv.date_commande,
                      cv.nomclient, cv.telephone, cv.montant_total
             ORDER BY cv.date_commande DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const nbSansPrix = parseInt(r.nb_lignes_sans_prix) || 0;
            const beneficeCalcule = parseFloat(r.benefice_calcule) || 0;
            const coutCalcule = parseFloat(r.cout_achat) || 0;
            const disponible = nbSansPrix === 0;

            return {
                id_commande: r.id_commande,
                numero_commande: r.numero_commande,
                date_commande: r.date_commande,
                date_formatee: r.date_formatee,
                nomclient: r.nomclient,
                telephone: r.telephone,
                ca_total: parseFloat(r.ca_total) || 0,
                cout_achat: coutCalcule,
                benefice: disponible ? beneficeCalcule : null,
                benefice_estime: beneficeCalcule,
                benefice_disponible: disponible,
                nb_lignes_prix_uv: parseInt(r.nb_lignes_prix_uv) || 0,
                nb_lignes_prix_produit: parseInt(r.nb_lignes_prix_produit) || 0,
                nb_lignes_sans_prix: nbSansPrix
            };
        });
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
                COALESCE(SUM(
                    CASE
                        WHEN uv.prix_achat > 0 OR p.prix_achat > 0
                            THEN lcv.montant_total
                        ELSE 0
                    END
                ), 0) AS ca_avec_cout_connu,
                COALESCE(SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.quantite * uv.prix_achat
                        WHEN p.prix_achat > 0
                            THEN lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1))
                        ELSE 0
                    END
                ), 0) AS cout_achat,
                COALESCE(SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ), 0) AS benefice_calcule,
                COALESCE(SUM(lcv.quantite_totale_base), 0) AS quantite_vendue,
                COUNT(CASE
                    WHEN uv.prix_achat IS NULL OR uv.prix_achat <= 0
                        THEN 1
                END) AS nb_lignes_prix_uv,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND p.prix_achat > 0
                        THEN 1
                END) AS nb_lignes_prix_produit,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix,
                COUNT(*) AS nb_lignes_total
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'`,
            [id_utilisateur, dateDebut, dateFin]
        );

        const t = rows[0];
        const ca = parseFloat(t.chiffre_affaires) || 0;
        const caCalcule = parseFloat(t.ca_avec_cout_connu) || 0;
        const cout = parseFloat(t.cout_achat) || 0;
        const benefice = parseFloat(t.benefice_calcule) || 0;
        const nbSansPrix = parseInt(t.nb_lignes_sans_prix) || 0;
        const nbTotal = parseInt(t.nb_lignes_total) || 0;
        const disponible = nbSansPrix === 0;

        return {
            nombre_commandes: parseInt(t.nombre_commandes) || 0,
            chiffre_affaires: ca,
            ca_avec_cout_connu: caCalcule,
            cout_achat: cout,
            benefice_brut: disponible ? benefice : null,
            benefice_estime: benefice,
            benefice_disponible: disponible,
            quantite_vendue: parseFloat(t.quantite_vendue) || 0,
            quantite_vendue_base: parseFloat(t.quantite_vendue) || 0,
            marge_brute_pct: disponible && ca > 0 ? ((benefice / ca) * 100) : null,
            taux_marge: disponible && cout > 0 ? ((benefice / cout) * 100) : null,
            nb_lignes_total: nbTotal,
            nb_lignes_prix_uv: parseInt(t.nb_lignes_prix_uv) || 0,
            nb_lignes_prix_produit: parseInt(t.nb_lignes_prix_produit) || 0,
            nb_lignes_sans_prix: nbSansPrix,
            taux_couverture: nbTotal > 0
                ? parseFloat((((nbTotal - nbSansPrix) / nbTotal) * 100).toFixed(2))
                : 100
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
                u.nom AS unite_nom,
                u.symbole AS unite_symbole,
                SUM(lcv.quantite_totale_base) AS quantite_vendue,
                SUM(lcv.montant_total) AS chiffre_affaires,

                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.quantite * uv.prix_achat
                        WHEN p.prix_achat > 0
                            THEN lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1))
                        ELSE 0
                    END
                ) AS cout_achat,

                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ) AS benefice_calcule,

                COUNT(CASE
                    WHEN uv.prix_achat IS NULL OR uv.prix_achat <= 0
                        THEN 1
                END) AS nb_lignes_prix_uv,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND p.prix_achat > 0
                        THEN 1
                END) AS nb_lignes_prix_produit,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix,

                p.prix_achat,
                p.prix_vente
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom, c.nom, u.nom, u.symbole, p.prix_achat, p.prix_vente
             ORDER BY benefice_calcule DESC`,
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

        return rows.map(r => {
            const ca = parseFloat(r.chiffre_affaires) || 0;
            const benefice = parseFloat(r.benefice_calcule) || 0;
            const nbSansPrix = parseInt(r.nb_lignes_sans_prix) || 0;
            const disponible = nbSansPrix === 0;

            const prixAchat = parseFloat(r.prix_achat) || 0;
            const prixVente = parseFloat(r.prix_vente) || 0;
            const margeUnitaire = prixVente - prixAchat;
            const margeUnitairePct = prixVente > 0 && prixAchat > 0
                ? ((margeUnitaire / prixVente) * 100)
                : null;

            return {
                id_produit: r.id_produit,
                produit_nom: r.produit_nom,
                marque_nom: r.marque_nom,
                categorie_nom: r.categorie_nom,
                unite_nom: r.unite_nom,
                unite_symbole: r.unite_symbole,
                quantite_vendue: parseFloat(r.quantite_vendue) || 0,
                quantite_vendue_base: parseFloat(r.quantite_vendue) || 0,
                chiffre_affaires: ca,
                cout_achat: parseFloat(r.cout_achat) || 0,
                benefice: disponible ? benefice : null,
                benefice_estime: benefice,
                benefice_disponible: disponible,
                marge_pct: disponible && ca > 0 ? ((benefice / ca) * 100) : null,
                prix_achat: prixAchat,
                prix_vente: prixVente,
                marge_unitaire: margeUnitaire,
                marge_unitaire_pct: margeUnitairePct,
                nb_lignes_prix_uv: parseInt(r.nb_lignes_prix_uv) || 0,
                nb_lignes_prix_produit: parseInt(r.nb_lignes_prix_produit) || 0,
                nb_lignes_sans_prix: nbSansPrix,
                unites_vente: unitesParProduit[r.id_produit] || [],
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
                SUM(lcv.quantite_totale_base) AS quantite_vendue,
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.quantite * uv.prix_achat
                        WHEN p.prix_achat > 0
                            THEN lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1))
                        ELSE 0
                    END
                ) AS cout_achat,
                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ) AS benefice_calcule,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             LEFT JOIN categories c ON p.id_categorie = c.id_categorie
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY c.id_categorie, c.nom
             ORDER BY benefice_calcule DESC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const ca = parseFloat(r.chiffre_affaires) || 0;
            const benefice = parseFloat(r.benefice_calcule) || 0;
            const nbSansPrix = parseInt(r.nb_lignes_sans_prix) || 0;
            const disponible = nbSansPrix === 0;

            return {
                id_categorie: r.id_categorie,
                categorie_nom: r.categorie_nom,
                nombre_produits: parseInt(r.nombre_produits) || 0,
                quantite_vendue: parseFloat(r.quantite_vendue) || 0,
                quantite_vendue_base: parseFloat(r.quantite_vendue) || 0,
                chiffre_affaires: ca,
                cout_achat: parseFloat(r.cout_achat) || 0,
                benefice: disponible ? benefice : null,
                benefice_estime: benefice,
                benefice_disponible: disponible,
                marge_pct: disponible && ca > 0 ? ((benefice / ca) * 100) : null,
                nb_lignes_sans_prix: nbSansPrix
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
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.quantite * uv.prix_achat
                        WHEN p.prix_achat > 0
                            THEN lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1))
                        ELSE 0
                    END
                ) AS cout_achat,
                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ) AS benefice_calcule,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY DATE(cv.date_commande)
             ORDER BY date ASC`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const ca = parseFloat(r.chiffre_affaires) || 0;
            const benefice = parseFloat(r.benefice_calcule) || 0;
            const nbSansPrix = parseInt(r.nb_lignes_sans_prix) || 0;
            const disponible = nbSansPrix === 0;

            return {
                date: r.date,
                nombre_commandes: parseInt(r.nombre_commandes) || 0,
                chiffre_affaires: ca,
                cout_achat: parseFloat(r.cout_achat) || 0,
                benefice: disponible ? benefice : null,
                benefice_estime: benefice,
                benefice_disponible: disponible,
                nb_lignes_sans_prix: nbSansPrix
            };
        });
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
                SUM(lcv.quantite_totale_base) AS quantite_vendue,
                SUM(lcv.montant_total) AS chiffre_affaires,
                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ) AS benefice_calcule,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, m.nom
             ORDER BY benefice_calcule DESC
             LIMIT ${limitInt}`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const nbSansPrix = parseInt(r.nb_lignes_sans_prix) || 0;
            const disponible = nbSansPrix === 0;
            const benefice = parseFloat(r.benefice_calcule) || 0;

            return {
                id_produit: r.id_produit,
                produit_nom: r.produit_nom,
                marque_nom: r.marque_nom,
                quantite_vendue: parseFloat(r.quantite_vendue) || 0,
                quantite_vendue_base: parseFloat(r.quantite_vendue) || 0,
                chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
                benefice: disponible ? benefice : null,
                benefice_estime: benefice,
                benefice_disponible: disponible,
                nb_lignes_sans_prix: nbSansPrix
            };
        });
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
                SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ) AS benefice_calcule,
                COUNT(CASE
                    WHEN (uv.prix_achat IS NULL OR uv.prix_achat <= 0)
                     AND (p.prix_achat IS NULL OR p.prix_achat <= 0)
                        THEN 1
                END) AS nb_lignes_sans_prix
             FROM ligne_commande_vente lcv
             JOIN produits p ON lcv.id_produit = p.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.date_commande BETWEEN ? AND ?
               AND cv.statut != 'annulee'
               AND cv.nomclient IS NOT NULL
             GROUP BY cv.nomclient, cv.telephone
             ORDER BY benefice_calcule DESC
             LIMIT ${limitInt}`,
            [id_utilisateur, dateDebut, dateFin]
        );

        return rows.map(r => {
            const nbSansPrix = parseInt(r.nb_lignes_sans_prix) || 0;
            const disponible = nbSansPrix === 0;
            const benefice = parseFloat(r.benefice_calcule) || 0;

            return {
                nomclient: r.nomclient,
                telephone: r.telephone,
                nombre_commandes: parseInt(r.nombre_commandes) || 0,
                chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
                benefice: disponible ? benefice : null,
                benefice_estime: benefice,
                benefice_disponible: disponible,
                nb_lignes_sans_prix: nbSansPrix
            };
        });
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
                CASE
                    WHEN p.prix_vente > 0 AND p.prix_achat > 0
                        THEN p.prix_vente - p.prix_achat
                    ELSE NULL
                END AS marge_unitaire,
                CASE
                    WHEN p.prix_vente > 0 AND p.prix_achat > 0
                        THEN ((p.prix_vente - p.prix_achat) / p.prix_vente) * 100
                    ELSE NULL
                END AS marge_pct,
                COALESCE(SUM(lcv.quantite_totale_base), 0) AS quantite_vendue,
                COALESCE(SUM(
                    CASE
                        WHEN uv.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * uv.prix_achat)
                        WHEN p.prix_achat > 0
                            THEN lcv.montant_total - (lcv.quantite * (p.prix_achat * COALESCE(lcv.quantite_base, 1)))
                        ELSE 0
                    END
                ), 0) AS benefice_total
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN ligne_commande_vente lcv ON p.id_produit = lcv.id_produit
             LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
             LEFT JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 AND cv.date_commande BETWEEN ? AND ?
                 AND cv.statut != 'annulee'
             WHERE p.id_utilisateur = ?
               AND p.prix_vente > 0
               AND p.prix_achat > 0
             GROUP BY p.id_produit, p.nom, m.nom, p.prix_achat, p.prix_vente
             HAVING quantite_vendue > 0
             ORDER BY marge_pct DESC
             LIMIT ${limitInt}`,
            [dateDebut, dateFin, id_utilisateur]
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
            id_produit: r.id_produit,
            produit_nom: r.produit_nom,
            marque_nom: r.marque_nom,
            prix_achat: parseFloat(r.prix_achat) || 0,
            prix_vente: parseFloat(r.prix_vente) || 0,
            marge_unitaire: r.marge_unitaire !== null ? parseFloat(r.marge_unitaire) : null,
            marge_pct: r.marge_pct !== null ? parseFloat(r.marge_pct) : null,
            quantite_vendue: parseFloat(r.quantite_vendue) || 0,
            quantite_vendue_base: parseFloat(r.quantite_vendue) || 0,
            benefice_total: parseFloat(r.benefice_total) || 0,
            unites_vente: unitesParProduit[r.id_produit] || [],
        }));
    }
}

export default Benefice;