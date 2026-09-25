// models/Dashboard.js
import { pool } from '../config/db.js';

class Dashboard {
    /**
     * ============================================================
     * KPIs GLOBAUX (par workspace)
     * ============================================================
     */
    static async getKPIs(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getKPIs');

        try {
            const [produits] = await pool.execute(
                `SELECT COUNT(*) as total FROM produits WHERE id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [clients] = await pool.execute(
                `SELECT COUNT(DISTINCT telephone) as total
                 FROM commandes_vente
                 WHERE telephone IS NOT NULL AND telephone <> '' AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [commandesEnAttente] = await pool.execute(
                `SELECT COUNT(*) as total FROM commandes_vente
                 WHERE statut IN ('en_attente', 'confirmee', 'en_preparation')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [ventesMois] = await pool.execute(
                `SELECT COALESCE(SUM(montant_total), 0) as total FROM commandes_vente
                 WHERE YEAR(date_commande) = YEAR(CURDATE())
                   AND MONTH(date_commande) = MONTH(CURDATE())
                   AND statut != 'annulee'
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [ventesJour] = await pool.execute(
                `SELECT COALESCE(SUM(montant_total), 0) as total FROM commandes_vente
                 WHERE DATE(date_commande) = CURDATE()
                   AND statut != 'annulee'
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [facturesImpayees] = await pool.execute(
                `SELECT COUNT(*) as total FROM factures_vente
                 WHERE statut IN ('en_attente', 'partiellement_payee', 'en_retard')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [montantImpaye] = await pool.execute(
                `SELECT COALESCE(SUM(montant_total), 0) as total FROM factures_vente
                 WHERE statut IN ('en_attente', 'partiellement_payee', 'en_retard')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [benefices] = await pool.execute(
                `SELECT 
                    COALESCE(SUM(
                        CASE 
                            WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) > 0
                                THEN lcv.montant_total - (
                                    lcv.quantite * COALESCE(
                                        NULLIF(uv.prix_achat, 0),
                                        p.prix_achat * COALESCE(lcv.quantite_base, 1)
                                    )
                                )
                            ELSE 0
                        END
                    ), 0) as total,
                    COUNT(DISTINCT CASE 
                        WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) <= 0 
                        THEN lcv.id_produit 
                    END) as nb_produits_sans_cout
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE YEAR(cv.date_commande) = YEAR(CURDATE())
                   AND MONTH(cv.date_commande) = MONTH(CURDATE())
                   AND cv.statut != 'annulee'
                   AND cv.id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [beneficesJour] = await pool.execute(
                `SELECT 
                    COALESCE(SUM(
                        CASE 
                            WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) > 0
                                THEN lcv.montant_total - (
                                    lcv.quantite * COALESCE(
                                        NULLIF(uv.prix_achat, 0),
                                        p.prix_achat * COALESCE(lcv.quantite_base, 1)
                                    )
                                )
                            ELSE 0
                        END
                    ), 0) as total,
                    COUNT(DISTINCT CASE 
                        WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) <= 0 
                        THEN lcv.id_produit 
                    END) as nb_produits_sans_cout
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE DATE(cv.date_commande) = CURDATE()
                   AND cv.statut != 'annulee'
                   AND cv.id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [produitsSansCout] = await pool.execute(
                `SELECT COUNT(DISTINCT p.id_produit) as total
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE YEAR(cv.date_commande) = YEAR(CURDATE())
                   AND MONTH(cv.date_commande) = MONTH(CURDATE())
                   AND cv.statut != 'annulee'
                   AND cv.id_utilisateur = ?
                   AND COALESCE(uv.prix_achat, p.prix_achat, 0) <= 0`,
                [id_utilisateur]
            );

            const [caMois] = await pool.execute(
                `SELECT COALESCE(SUM(lcv.montant_total), 0) as total
                 FROM ligne_commande_vente lcv
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE YEAR(cv.date_commande) = YEAR(CURDATE())
                   AND MONTH(cv.date_commande) = MONTH(CURDATE())
                   AND cv.statut != 'annulee'
                   AND cv.id_utilisateur = ?`,
                [id_utilisateur]
            );

            const beneficeMois = parseFloat(benefices[0].total) || 0;
            const beneficeJour = parseFloat(beneficesJour[0].total) || 0;
            const caMoisTotal = parseFloat(caMois[0].total) || 0;
            const margeMoyennePct = caMoisTotal > 0 ? (beneficeMois / caMoisTotal) * 100 : 0;
            const nbProduitsSansCout = parseInt(produitsSansCout[0].total) || 0;
            const nbProduitsSansCoutJour = parseInt(beneficesJour[0].nb_produits_sans_cout) || 0;

            return {
                total_produits: parseInt(produits[0].total) || 0,
                total_clients: parseInt(clients[0].total) || 0,
                commandes_en_attente: parseInt(commandesEnAttente[0].total) || 0,
                ventes_mois: parseFloat(ventesMois[0].total) || 0,
                ventes_jour: parseFloat(ventesJour[0].total) || 0,
                factures_impayees: parseInt(facturesImpayees[0].total) || 0,
                montant_impaye: parseFloat(montantImpaye[0].total) || 0,
                benefices_mois: beneficeMois,
                benefices_jour: beneficeJour,
                marge_moyenne_pct: parseFloat(margeMoyennePct.toFixed(2)),
                produits_sans_cout: nbProduitsSansCout,
                produits_sans_cout_jour: nbProduitsSansCoutJour,
            };
        } catch (error) {
            console.error('❌ Erreur getKPIs:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * BÉNÉFICES PAR JOUR
     * ============================================================
     */
    static async getBeneficesParJour(jours = 30, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getBeneficesParJour');

        try {
            const joursInt = Math.max(1, Math.min(365, parseInt(jours, 10) || 30));

            const [rows] = await pool.query(
                `SELECT
                    DATE(cv.date_commande) AS date,
                    COALESCE(SUM(lcv.montant_total), 0) AS ca,
                    COALESCE(SUM(
                        CASE 
                            WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) > 0
                                THEN lcv.quantite * COALESCE(
                                    NULLIF(uv.prix_achat, 0),
                                    p.prix_achat * COALESCE(lcv.quantite_base, 1)
                                )
                            ELSE 0
                        END
                    ), 0) AS cout_achat,
                    COALESCE(SUM(
                        CASE 
                            WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) > 0
                                THEN lcv.montant_total - (
                                    lcv.quantite * COALESCE(
                                        NULLIF(uv.prix_achat, 0),
                                        p.prix_achat * COALESCE(lcv.quantite_base, 1)
                                    )
                                )
                            ELSE 0
                        END
                    ), 0) AS benefice,
                    COUNT(DISTINCT CASE 
                        WHEN COALESCE(uv.prix_achat, p.prix_achat, 0) <= 0 
                        THEN lcv.id_produit 
                    END) AS nb_produits_sans_cout,
                    COUNT(DISTINCT cv.id_commande) AS nb_commandes
                 FROM commandes_vente cv
                 JOIN ligne_commande_vente lcv ON cv.id_commande = lcv.id_commande
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
                 WHERE cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
                   AND cv.statut != 'annulee'
                   AND cv.id_utilisateur = ?
                 GROUP BY DATE(cv.date_commande)
                 ORDER BY date ASC`,
                [id_utilisateur]
            );

            const result = [];
            const today = new Date();
            for (let i = joursInt - 1; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const found = rows.find(r => {
                    const rDate = new Date(r.date).toISOString().split('T')[0];
                    return rDate === dateStr;
                });
                const ca = found ? parseFloat(found.ca) || 0 : 0;
                const cout = found ? parseFloat(found.cout_achat) || 0 : 0;
                const benefice = found ? parseFloat(found.benefice) || 0 : 0;
                const nbSansCout = found ? parseInt(found.nb_produits_sans_cout) || 0 : 0;
                const marge = ca > 0 ? (benefice / ca) * 100 : 0;

                result.push({
                    date: dateStr,
                    ca,
                    cout_achat: cout,
                    benefice,
                    benefice_disponible: nbSansCout === 0,
                    nb_produits_sans_cout: nbSansCout,
                    marge_pct: parseFloat(marge.toFixed(2)),
                    nb_commandes: found ? parseInt(found.nb_commandes) || 0 : 0
                });
            }

            return result;
        } catch (error) {
            console.error('❌ Erreur getBeneficesParJour:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * VENTES PAR SEMAINE
     * ============================================================
     */
    static async getVentesParSemaine(semaines = 4, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getVentesParSemaine');

        try {
            const semainesInt = Math.max(1, Math.min(12, parseInt(semaines, 10) || 4));

            const [rows] = await pool.query(
                `SELECT
                    YEARWEEK(date_commande, 1) as annee_semaine,
                    MIN(DATE(date_commande)) as date_debut,
                    MAX(DATE(date_commande)) as date_fin,
                    COALESCE(SUM(montant_total), 0) as montant,
                    COUNT(*) as nb_commandes
                 FROM commandes_vente
                 WHERE date_commande >= DATE_SUB(CURDATE(), INTERVAL ${semainesInt * 7} DAY)
                   AND statut != 'annulee'
                   AND id_utilisateur = ?
                 GROUP BY YEARWEEK(date_commande, 1)
                 ORDER BY annee_semaine ASC`,
                [id_utilisateur]
            );

            return rows.map((r, i) => ({
                semaine: `S${i + 1}`,
                label: `Sem. ${i + 1}`,
                date_debut: r.date_debut,
                date_fin: r.date_fin,
                montant: parseFloat(r.montant) || 0,
                nb_commandes: parseInt(r.nb_commandes) || 0
            }));
        } catch (error) {
            console.error('❌ Erreur getVentesParSemaine:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * VENTES DU JOUR (heure par heure)
     * ============================================================
     */
    static async getVentesJourChart(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getVentesJourChart');

        try {
            const [rows] = await pool.execute(
                `SELECT
                    HOUR(date_creation) as heure,
                    COALESCE(SUM(montant_total), 0) as montant,
                    COUNT(*) as nb_commandes
                 FROM commandes_vente
                 WHERE DATE(date_creation) = CURDATE()
                   AND statut != 'annulee'
                   AND id_utilisateur = ?
                 GROUP BY HOUR(date_creation)
                 ORDER BY heure ASC`,
                [id_utilisateur]
            );

            const result = [];
            for (let h = 0; h < 24; h++) {
                const found = rows.find(r => parseInt(r.heure) === h);
                result.push({
                    heure: h,
                    label: `${String(h).padStart(2, '0')}h`,
                    montant: found ? parseFloat(found.montant) : 0,
                    nb_commandes: found ? parseInt(found.nb_commandes) : 0
                });
            }
            return result;
        } catch (error) {
            console.error('❌ Erreur getVentesJourChart:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * VENTES CHART (30 derniers jours)
     * ============================================================
     */
    static async getVentesChart(jours = 30, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getVentesChart');

        try {
            const joursInt = Math.max(1, Math.min(365, parseInt(jours, 10) || 30));

            const [rows] = await pool.query(
                `SELECT
                    DATE(date_commande) as date,
                    COALESCE(SUM(montant_total), 0) as montant,
                    COUNT(*) as nb_commandes
                 FROM commandes_vente
                 WHERE date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
                   AND statut != 'annulee'
                   AND id_utilisateur = ?
                 GROUP BY DATE(date_commande)
                 ORDER BY date ASC`,
                [id_utilisateur]
            );

            const result = [];
            const today = new Date();
            for (let i = joursInt - 1; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const found = rows.find(r => {
                    const rDate = new Date(r.date).toISOString().split('T')[0];
                    return rDate === dateStr;
                });
                result.push({
                    date: dateStr,
                    montant: found ? parseFloat(found.montant) : 0,
                    nb_commandes: found ? parseInt(found.nb_commandes) : 0
                });
            }
            return result;
        } catch (error) {
            console.error('❌ Erreur getVentesChart:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * ✅ TOP PRODUITS VENDUS (avec unités de vente)
     * ============================================================
     */
    static async getTopProduits(limit = 5, jours = 30, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getTopProduits');

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));
            const joursInt = Math.max(1, Math.min(365, parseInt(jours, 10) || 30));

            const [rows] = await pool.query(
                `SELECT
                    p.id_produit,
                    p.nom as produit_nom,
                    p.id_unite,
                    u.nom as unite_nom,
                    u.symbole as unite_symbole,
                    m.nom as marque_nom,
                    SUM(lcv.quantite_totale_base) as total_vendu_base,
                    SUM(lcv.montant_total) as chiffre_affaires
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
                   AND cv.statut != 'annulee'
                   AND cv.id_utilisateur = ?
                 GROUP BY p.id_produit, p.nom, p.id_unite, u.nom, u.symbole, m.nom
                 ORDER BY total_vendu_base DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur]
            );

            if (rows.length === 0) return [];

            // ✅ Charger toutes les unités de vente des produits
            const produitIds = rows.map(r => r.id_produit);
            const placeholders = produitIds.map(() => '?').join(',');

            const [allUnites] = await pool.query(
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
                const totalBase = parseFloat(r.total_vendu_base) || 0;
                return {
                    id_produit: r.id_produit,
                    produit_nom: r.produit_nom,
                    marque_nom: r.marque_nom,
                    unite_nom: r.unite_nom,
                    unite_symbole: r.unite_symbole,
                    total_vendu: totalBase,
                    total_vendu_base: totalBase,
                    chiffre_affaires: parseFloat(r.chiffre_affaires) || 0,
                    unites_vente: unitesParProduit[r.id_produit] || [],
                };
            });
        } catch (error) {
            console.error('❌ Erreur getTopProduits:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * ✅ ALERTES DE STOCK (avec unités de vente)
     * ============================================================
     */
    static async getAlertes(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getAlertes');

        try {
            const [rupture] = await pool.execute(
                `SELECT p.id_produit, p.nom, p.quantite_stock, p.quantite_minimale,
                        u.nom AS unite_nom, u.symbole AS unite_symbole
                 FROM produits p
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 WHERE (p.statut = 'rupture' OR p.quantite_stock <= 0) AND p.id_utilisateur = ?
                 ORDER BY p.nom ASC`,
                [id_utilisateur]
            );

            const [stockBas] = await pool.execute(
                `SELECT p.id_produit, p.nom, p.quantite_stock, p.quantite_minimale,
                        u.nom AS unite_nom, u.symbole AS unite_symbole
                 FROM produits p
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 WHERE p.quantite_stock > 0 AND p.quantite_stock <= p.quantite_minimale
                   AND p.id_utilisateur = ?
                 ORDER BY p.quantite_stock ASC`,
                [id_utilisateur]
            );

            // ✅ Charger les unités de vente pour toutes les alertes
            const allIds = [
                ...rupture.map(r => r.id_produit),
                ...stockBas.map(r => r.id_produit),
            ];
            const uniqueIds = [...new Set(allIds)];

            let unitesParProduit = {};
            if (uniqueIds.length > 0) {
                const placeholders = uniqueIds.map(() => '?').join(',');
                const [allUnites] = await pool.query(
                    `SELECT id_unite_vente, id_produit, nom, quantite_base,
                            prix_vente, prix_achat, est_principal
                     FROM unites_vente
                     WHERE id_produit IN (${placeholders}) AND actif = TRUE
                     ORDER BY est_principal DESC, quantite_base ASC`,
                    uniqueIds
                );

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
            }

            const mapFn = (arr) => arr.map(r => ({
                id_produit: r.id_produit,
                produit_nom: r.nom,
                quantite_stock: parseFloat(r.quantite_stock) || 0,
                quantite_minimale: parseFloat(r.quantite_minimale) || 0,
                unite_nom: r.unite_nom,
                unite_symbole: r.unite_symbole,
                unites_vente: unitesParProduit[r.id_produit] || [],
            }));

            return {
                rupture: mapFn(rupture),
                stock_bas: mapFn(stockBas),
                total_rupture: rupture.length,
                total_stock_bas: stockBas.length
            };
        } catch (error) {
            console.error('❌ Erreur getAlertes:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * DERNIERS MOUVEMENTS (avec unités de vente)
     * ============================================================
     */
    static async getDerniersMouvements(limit = 5, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getDerniersMouvements');

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

            const [rows] = await pool.query(
                `SELECT
                    m.id_mouvement, m.type_mouvement, m.quantite,
                    m.ancienne_quantite, m.nouvelle_quantite,
                    m.type_reference, m.id_reference, m.notes, m.date_mouvement,
                    p.id_produit,
                    p.nom as produit_nom, ma.nom as marque_nom,
                    u.nom as unite_nom, u.symbole as unite_symbole,
                    ut.fullname as utilisateur_nom,
                    DATE_FORMAT(m.date_mouvement, '%d/%m/%Y %H:%i') as date_formatee
                 FROM mouvements_stock m
                 LEFT JOIN produits p ON m.id_produit = p.id_produit
                 LEFT JOIN marques ma ON p.id_marque = ma.id_marque
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 LEFT JOIN utilisateurs ut ON m.id_utilisateur = ut.id_utilisateur
                 WHERE m.id_utilisateur = ?
                 ORDER BY m.date_mouvement DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur]
            );

            if (rows.length === 0) return [];

            // ✅ Charger les unités de vente des produits concernés
            const produitIds = [...new Set(rows.map(r => r.id_produit).filter(Boolean))];
            const placeholders = produitIds.map(() => '?').join(',');

            let unitesParProduit = {};
            if (produitIds.length > 0) {
                const [allUnites] = await pool.query(
                    `SELECT id_unite_vente, id_produit, nom, quantite_base,
                            prix_vente, prix_achat, est_principal
                     FROM unites_vente
                     WHERE id_produit IN (${placeholders}) AND actif = TRUE
                     ORDER BY est_principal DESC, quantite_base ASC`,
                    produitIds
                );

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
            }

            return rows.map(r => ({
                id_mouvement: r.id_mouvement,
                type_mouvement: r.type_mouvement,
                quantite: parseFloat(r.quantite) || 0,
                ancienne_quantite: parseFloat(r.ancienne_quantite) || 0,
                nouvelle_quantite: parseFloat(r.nouvelle_quantite) || 0,
                type_reference: r.type_reference,
                id_reference: r.id_reference,
                notes: r.notes,
                date_mouvement: r.date_mouvement,
                date_formatee: r.date_formatee,
                id_produit: r.id_produit,
                produit_nom: r.produit_nom,
                marque_nom: r.marque_nom,
                unite_nom: r.unite_nom,
                unite_symbole: r.unite_symbole,
                utilisateur_nom: r.utilisateur_nom,
                unites_vente: unitesParProduit[r.id_produit] || [],
            }));
        } catch (error) {
            console.error('❌ Erreur getDerniersMouvements:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * DERNIÈRES FACTURES
     * ============================================================
     */
    static async getDernieresFactures(limit = 5, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getDernieresFactures');

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

            const [rows] = await pool.query(
                `SELECT
                    fv.id_facture, fv.numero_facture, fv.date_facture, fv.date_echeance,
                    fv.montant_total, fv.statut, fv.mode_paiement,
                    cv.nomclient, cv.telephone,
                    DATE_FORMAT(fv.date_facture, '%d/%m/%Y') as date_facture_formatee
                 FROM factures_vente fv
                 LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
                 WHERE fv.id_utilisateur = ?
                 ORDER BY fv.date_facture DESC, fv.id_facture DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur]
            );

            return rows.map(r => ({
                id_facture: r.id_facture,
                numero_facture: r.numero_facture,
                date_facture: r.date_facture,
                date_facture_formatee: r.date_facture_formatee,
                date_echeance: r.date_echeance,
                montant_total: parseFloat(r.montant_total) || 0,
                statut: r.statut,
                mode_paiement: r.mode_paiement,
                nomclient: r.nomclient,
                telephone: r.telephone
            }));
        } catch (error) {
            console.error('❌ Erreur getDernieresFactures:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * DERNIÈRES COMMANDES
     * ============================================================
     */
    static async getDernieresCommandes(limit = 5, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getDernieresCommandes');

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

            const [rows] = await pool.query(
                `SELECT
                    cv.id_commande, cv.numero_commande, cv.date_commande,
                    cv.nomclient, cv.telephone, cv.montant_total, cv.statut,
                    DATE_FORMAT(cv.date_commande, '%d/%m/%Y') as date_formatee
                 FROM commandes_vente cv
                 WHERE cv.id_utilisateur = ?
                 ORDER BY cv.date_commande DESC, cv.id_commande DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur]
            );

            return rows.map(r => ({
                id_commande: r.id_commande,
                numero_commande: r.numero_commande,
                date_commande: r.date_commande,
                date_formatee: r.date_formatee,
                nomclient: r.nomclient,
                telephone: r.telephone,
                montant_total: parseFloat(r.montant_total) || 0,
                statut: r.statut
            }));
        } catch (error) {
            console.error('❌ Erreur getDernieresCommandes:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * STATISTIQUES COMPLÈTES
     * ============================================================
     */
    static async getStatsCompletes(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getStatsCompletes');

        try {
            const [
                kpis,
                ventesChart,
                beneficesJour,
                ventesJourChart,
                ventesSemaine,
                topProduits,
                alertes,
                derniersMouvements,
                dernieresFactures,
                dernieresCommandes
            ] = await Promise.all([
                this.getKPIs(id_utilisateur),
                this.getVentesChart(30, id_utilisateur),
                this.getBeneficesParJour(30, id_utilisateur),
                this.getVentesJourChart(id_utilisateur),
                this.getVentesParSemaine(4, id_utilisateur),
                this.getTopProduits(5, 30, id_utilisateur),
                this.getAlertes(id_utilisateur),
                this.getDerniersMouvements(5, id_utilisateur),
                this.getDernieresFactures(5, id_utilisateur),
                this.getDernieresCommandes(5, id_utilisateur)
            ]);

            return {
                kpis,
                ventes_chart: ventesChart,
                benefices_chart: beneficesJour,
                ventes_jour_chart: ventesJourChart,
                ventes_semaine: ventesSemaine,
                top_produits: topProduits,
                alertes,
                derniers_mouvements: derniersMouvements,
                dernieres_factures: dernieresFactures,
                dernieres_commandes: dernieresCommandes
            };
        } catch (error) {
            console.error('❌ Erreur getStatsCompletes:', error);
            throw error;
        }
    }
}

export default Dashboard;