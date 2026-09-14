// models/Dashboard.js
import { pool } from '../config/db.js';

class Dashboard {
    /**
     * ============================================================
     * KPIs GLOBAUX (par workspace)
     * ============================================================
     */
    static async getKPIs(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getKPIs');
        }

        try {
            const [produits] = await pool.execute(
                `SELECT COUNT(*) as total
                 FROM produits
                 WHERE id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [clients] = await pool.execute(
                `SELECT COUNT(DISTINCT telephone) as total
                 FROM commandes_vente
                 WHERE telephone IS NOT NULL
                   AND telephone <> ''
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [commandesEnAttente] = await pool.execute(
                `SELECT COUNT(*) as total
                 FROM commandes_vente
                 WHERE statut IN ('en_attente', 'confirmee', 'en_preparation')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [ventesMois] = await pool.execute(
                `SELECT COALESCE(SUM(montant_total), 0) as total
                 FROM commandes_vente
                 WHERE YEAR(date_commande) = YEAR(CURDATE())
                   AND MONTH(date_commande) = MONTH(CURDATE())
                   AND statut IN ('livree', 'expediee')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [ventesJour] = await pool.execute(
                `SELECT COALESCE(SUM(montant_total), 0) as total
                 FROM commandes_vente
                 WHERE DATE(date_commande) = CURDATE()
                   AND statut IN ('livree', 'expediee')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [facturesImpayees] = await pool.execute(
                `SELECT COUNT(*) as total
                 FROM factures_vente
                 WHERE statut IN ('en_attente', 'partiellement_payee', 'en_retard')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [montantImpaye] = await pool.execute(
                `SELECT COALESCE(SUM(montant_total), 0) as total
                 FROM factures_vente
                 WHERE statut IN ('en_attente', 'partiellement_payee', 'en_retard')
                   AND id_utilisateur = ?`,
                [id_utilisateur]
            );

            const [benefices] = await pool.execute(
                `SELECT COALESCE(SUM(
                    lcv.montant_total - (lcv.quantite * p.prix_achat)
                 ), 0) as total
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE YEAR(cv.date_commande) = YEAR(CURDATE())
                   AND MONTH(cv.date_commande) = MONTH(CURDATE())
                   AND cv.statut IN ('livree', 'expediee')
                   AND cv.id_utilisateur = ?`,
                [id_utilisateur]
            );

            return {
                total_produits: parseInt(produits[0].total) || 0,
                total_clients: parseInt(clients[0].total) || 0,
                commandes_en_attente: parseInt(commandesEnAttente[0].total) || 0,
                ventes_mois: parseFloat(ventesMois[0].total) || 0,
                ventes_jour: parseFloat(ventesJour[0].total) || 0,
                factures_impayees: parseInt(facturesImpayees[0].total) || 0,
                montant_impaye: parseFloat(montantImpaye[0].total) || 0,
                benefices_mois: parseFloat(benefices[0].total) || 0
            };
        } catch (error) {
            console.error('❌ Erreur getKPIs:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * VENTES PAR SEMAINE (4 dernières semaines, par workspace)
     * ============================================================
     */
    static async getVentesParSemaine(semaines = 4, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getVentesParSemaine');
        }

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
                   AND statut IN ('livree', 'expediee')
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
 * GRAPHIQUE DES VENTES DU JOUR (heure par heure, par workspace)
 * Utilise date_creation pour l'heure (DATETIME)
 * ============================================================
 */
static async getVentesJourChart(id_utilisateur) {
    if (!id_utilisateur) {
        throw new Error('id_utilisateur requis pour getVentesJourChart');
    }

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

        // Construire 24 points (0h → 23h) en remplissant les trous avec 0
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
     * GRAPHIQUE DES VENTES (30 derniers jours, par workspace)
     * ============================================================
     */
    static async getVentesChart(jours = 30, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getVentesChart');
        }

        try {
            const joursInt = Math.max(1, Math.min(365, parseInt(jours, 10) || 30));

            const [rows] = await pool.query(
                `SELECT
                    DATE(date_commande) as date,
                    COALESCE(SUM(montant_total), 0) as montant,
                    COUNT(*) as nb_commandes
                 FROM commandes_vente
                 WHERE date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
                   AND statut IN ('livree', 'expediee')
                   AND id_utilisateur = ?
                 GROUP BY DATE(date_commande)
                 ORDER BY date ASC`,
                [id_utilisateur]
            );

            // Remplir les jours manquants avec 0
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
     * TOP 5 PRODUITS VENDUS (30 derniers jours, par workspace)
     * ============================================================
     */
    static async getTopProduits(limit = 5, jours = 30, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopProduits');
        }

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));
            const joursInt = Math.max(1, Math.min(365, parseInt(jours, 10) || 30));

            const [rows] = await pool.query(
                `SELECT
                    p.id_produit,
                    p.nom as produit_nom,
                    m.nom as marque_nom,
                    SUM(lcv.quantite) as total_vendu,
                    SUM(lcv.montant_total) as chiffre_affaires
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
                   AND cv.statut IN ('livree', 'expediee')
                   AND cv.id_utilisateur = ?
                 GROUP BY p.id_produit, p.nom, m.nom
                 ORDER BY total_vendu DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur]
            );

            return rows.map(r => ({
                id_produit: r.id_produit,
                produit_nom: r.produit_nom,
                marque_nom: r.marque_nom,
                total_vendu: parseFloat(r.total_vendu) || 0,
                chiffre_affaires: parseFloat(r.chiffre_affaires) || 0
            }));
        } catch (error) {
            console.error('❌ Erreur getTopProduits:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * ALERTES DE STOCK (par workspace)
     * ============================================================
     */
    static async getAlertes(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getAlertes');
        }

        try {
            const [rupture] = await pool.execute(
                `SELECT id_produit, nom, quantite_stock, quantite_minimale
                 FROM produits
                 WHERE (statut = 'rupture' OR quantite_stock <= 0)
                   AND id_utilisateur = ?
                 ORDER BY nom ASC`,
                [id_utilisateur]
            );

            const [stockBas] = await pool.execute(
                `SELECT id_produit, nom, quantite_stock, quantite_minimale
                 FROM produits
                 WHERE quantite_stock > 0
                   AND quantite_stock <= quantite_minimale
                   AND id_utilisateur = ?
                 ORDER BY quantite_stock ASC`,
                [id_utilisateur]
            );

            return {
                rupture: rupture.map(r => ({
                    id_produit: r.id_produit,
                    produit_nom: r.nom,
                    quantite_stock: parseFloat(r.quantite_stock) || 0,
                    quantite_minimale: parseFloat(r.quantite_minimale) || 0
                })),
                stock_bas: stockBas.map(r => ({
                    id_produit: r.id_produit,
                    produit_nom: r.nom,
                    quantite_stock: parseFloat(r.quantite_stock) || 0,
                    quantite_minimale: parseFloat(r.quantite_minimale) || 0
                })),
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
     * DERNIERS MOUVEMENTS DE STOCK (par workspace)
     * ============================================================
     */
    static async getDerniersMouvements(limit = 5, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getDerniersMouvements');
        }

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

            const [rows] = await pool.query(
                `SELECT
                    m.id_mouvement,
                    m.type_mouvement,
                    m.quantite,
                    m.ancienne_quantite,
                    m.nouvelle_quantite,
                    m.type_reference,
                    m.id_reference,
                    m.notes,
                    m.date_mouvement,
                    p.nom as produit_nom,
                    ma.nom as marque_nom,
                    u.symbole as unite_symbole,
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
                produit_nom: r.produit_nom,
                marque_nom: r.marque_nom,
                unite_symbole: r.unite_symbole,
                utilisateur_nom: r.utilisateur_nom
            }));
        } catch (error) {
            console.error('❌ Erreur getDerniersMouvements:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * DERNIÈRES FACTURES (par workspace)
     * ============================================================
     */
    static async getDernieresFactures(limit = 5, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getDernieresFactures');
        }

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

            const [rows] = await pool.query(
                `SELECT
                    fv.id_facture,
                    fv.numero_facture,
                    fv.date_facture,
                    fv.date_echeance,
                    fv.montant_total,
                    fv.statut,
                    fv.mode_paiement,
                    cv.nomclient,
                    cv.telephone,
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
     * DERNIÈRES COMMANDES (par workspace)
     * ============================================================
     */
    static async getDernieresCommandes(limit = 5, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getDernieresCommandes');
        }

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

            const [rows] = await pool.query(
                `SELECT
                    cv.id_commande,
                    cv.numero_commande,
                    cv.date_commande,
                    cv.nomclient,
                    cv.telephone,
                    cv.montant_total,
                    cv.statut,
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
     * STATISTIQUES COMPLÈTES (tout en un, par workspace)
     * ============================================================
     */
static async getStatsCompletes(id_utilisateur) {
    if (!id_utilisateur) {
        throw new Error('id_utilisateur requis pour getStatsCompletes');
    }

    try {
        const [
            kpis,
            ventesChart,
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