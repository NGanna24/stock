// models/Client.js
import { pool } from '../config/db.js';

class Client {
    /**
     * ============================================================
     * RÉCUPÉRER TOUS LES CLIENTS du workspace
     * ============================================================
     * Les clients sont regroupés depuis commandes_vente par téléphone,
     * filtrés par id_utilisateur.
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT
                    cv.telephone,
                    MAX(cv.nomclient) as nomclient,
                    COUNT(DISTINCT cv.id_commande) as nb_commandes,
                    COALESCE(SUM(cv.montant_total), 0) as total_achats,
                    COALESCE(AVG(cv.montant_total), 0) as panier_moyen,
                    MIN(cv.date_commande) as premiere_commande,
                    MAX(cv.date_commande) as derniere_commande,
                    MAX(cv.statut) as dernier_statut,
                    COUNT(DISTINCT fv.id_facture) as nb_factures,
                    COALESCE(SUM(CASE WHEN fv.statut IN ('en_attente', 'partiellement_payee', 'en_retard')
                                     THEN fv.montant_total ELSE 0 END), 0) as montant_impaye
                FROM commandes_vente cv
                LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                WHERE cv.telephone IS NOT NULL
                  AND cv.telephone <> ''
                  AND cv.id_utilisateur = ?              
            `;
            const params = [id_utilisateur];

            if (filters.search) {
                query += ` AND (cv.nomclient LIKE ? OR cv.telephone LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s);
            }

            if (filters.date_debut) {
                query += ` AND cv.date_commande >= ?`;
                params.push(filters.date_debut);
            }

            if (filters.date_fin) {
                query += ` AND cv.date_commande <= ?`;
                params.push(filters.date_fin);
            }

            query += ` GROUP BY cv.telephone`;

            // Tri sécurisé
            const orderBy = filters.order_by || 'derniere_commande';
            const orderDir = (filters.order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const allowedOrders = ['derniere_commande', 'premiere_commande', 'nb_commandes', 'total_achats', 'nomclient'];
            const safeOrder = allowedOrders.includes(orderBy) ? orderBy : 'derniere_commande';
            query += ` ORDER BY ${safeOrder} ${orderDir}`;

            if (filters.limit) {
                const limitInt = Math.max(1, Math.min(500, parseInt(filters.limit, 10) || 50));
                query += ` LIMIT ${limitInt}`;
                if (filters.offset) {
                    const offsetInt = Math.max(0, parseInt(filters.offset, 10) || 0);
                    query += ` OFFSET ${offsetInt}`;
                }
            }

            const [rows] = await pool.query(query, params);

            return rows.map(r => ({
                telephone: r.telephone,
                nomclient: r.nomclient,
                nb_commandes: parseInt(r.nb_commandes) || 0,
                total_achats: parseFloat(r.total_achats) || 0,
                panier_moyen: parseFloat(r.panier_moyen) || 0,
                nb_factures: parseInt(r.nb_factures) || 0,
                montant_impaye: parseFloat(r.montant_impaye) || 0,
                premiere_commande: r.premiere_commande,
                derniere_commande: r.derniere_commande,
                dernier_statut: r.dernier_statut
            }));
        } catch (error) {
            console.error('❌ Erreur Client.findAll:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER UN CLIENT PAR TÉLÉPHONE (fiche complète)
     * ============================================================
     */
    static async findByTelephone(telephone, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByTelephone');
        }
        if (!telephone) return null;

        try {
            // --- Infos générales ---
            const [rows] = await pool.execute(
                `SELECT
                    cv.telephone,
                    MAX(cv.nomclient) as nomclient,
                    COUNT(DISTINCT cv.id_commande) as nb_commandes,
                    COALESCE(SUM(cv.montant_total), 0) as total_achats,
                    COALESCE(AVG(cv.montant_total), 0) as panier_moyen,
                    MIN(cv.date_commande) as premiere_commande,
                    MAX(cv.date_commande) as derniere_commande
                 FROM commandes_vente cv
                 WHERE cv.telephone = ?
                   AND cv.id_utilisateur = ?                
                 GROUP BY cv.telephone`,
                [telephone, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const client = rows[0];

            // --- Historique des commandes ---
            const [commandes] = await pool.execute(
                `SELECT
                    cv.id_commande,
                    cv.numero_commande,
                    cv.date_commande,
                    DATE_FORMAT(cv.date_commande, '%d/%m/%Y') as date_formatee,
                    cv.montant_total,
                    cv.statut,
                    cv.notes,
                    fv.id_facture,
                    fv.numero_facture,
                    fv.statut as statut_facture,
                    fv.montant_total as montant_facture
                 FROM commandes_vente cv
                 LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                 WHERE cv.telephone = ?
                   AND cv.id_utilisateur = ?                
                 ORDER BY cv.date_commande DESC`,
                [telephone, id_utilisateur]
            );

            // --- Statistiques de paiement ---
            const [paiementStats] = await pool.execute(
                `SELECT
                    COUNT(*) as total_paiements,
                    COALESCE(SUM(p.montant), 0) as total_paye,
                    MAX(p.date_paiement) as dernier_paiement
                 FROM paiements p
                 JOIN factures_vente fv ON p.id_facture = fv.id_facture
                 JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
                 WHERE cv.telephone = ?
                   AND cv.id_utilisateur = ?`,           
                [telephone, id_utilisateur]
            );

            // --- Produits achetés (top 10) ---
            const [produits] = await pool.execute(
                `SELECT
                    p.id_produit,
                    p.nom as produit_nom,
                    m.nom as marque_nom,
                    u.symbole as unite_symbole,
                    SUM(lcv.quantite) as total_quantite,
                    SUM(lcv.montant_total) as total_montant,
                    COUNT(DISTINCT lcv.id_commande) as nb_fois
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE cv.telephone = ?
                   AND cv.id_utilisateur = ?                
                 GROUP BY p.id_produit
                 ORDER BY total_quantite DESC
                 LIMIT 10`,
                [telephone, id_utilisateur]
            );

            return {
                telephone: client.telephone,
                nomclient: client.nomclient,
                nb_commandes: parseInt(client.nb_commandes) || 0,
                total_achats: parseFloat(client.total_achats) || 0,
                panier_moyen: parseFloat(client.panier_moyen) || 0,
                premiere_commande: client.premiere_commande,
                derniere_commande: client.derniere_commande,
                total_paiements: parseInt(paiementStats[0].total_paiements) || 0,
                total_paye: parseFloat(paiementStats[0].total_paye) || 0,
                dernier_paiement: paiementStats[0].dernier_paiement,
                commandes: commandes.map(c => ({
                    id_commande: c.id_commande,
                    numero_commande: c.numero_commande,
                    date_commande: c.date_commande,
                    date_formatee: c.date_formatee,
                    montant_total: parseFloat(c.montant_total) || 0,
                    statut: c.statut,
                    notes: c.notes,
                    id_facture: c.id_facture,
                    numero_facture: c.numero_facture,
                    statut_facture: c.statut_facture,
                    montant_facture: parseFloat(c.montant_facture) || 0
                })),
                produits_frequents: produits.map(p => ({
                    id_produit: p.id_produit,
                    produit_nom: p.produit_nom,
                    marque_nom: p.marque_nom,
                    unite_symbole: p.unite_symbole,
                    total_quantite: parseFloat(p.total_quantite) || 0,
                    total_montant: parseFloat(p.total_montant) || 0,
                    nb_fois: parseInt(p.nb_fois) || 0
                }))
            };
        } catch (error) {
            console.error('❌ Erreur Client.findByTelephone:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * STATISTIQUES GLOBALES DES CLIENTS DU WORKSPACE
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(DISTINCT telephone) as total_clients,
                    COUNT(DISTINCT CASE
                        WHEN date_commande >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                        THEN telephone END) as clients_actifs_30j,
                    COUNT(DISTINCT CASE
                        WHEN date_commande >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                        THEN telephone END) as clients_actifs_7j,
                    COUNT(DISTINCT CASE
                        WHEN date_commande >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
                        THEN telephone END) as clients_actifs_24h
                 FROM commandes_vente
                 WHERE telephone IS NOT NULL
                   AND telephone <> ''
                   AND id_utilisateur = ?`,              
                [id_utilisateur]
            );

            // Panier moyen global
            const [panierRows] = await pool.execute(
                `SELECT COALESCE(AVG(montant_total), 0) as panier_moyen
                 FROM commandes_vente
                 WHERE telephone IS NOT NULL
                   AND telephone <> ''
                   AND statut IN ('livree', 'expediee')
                   AND id_utilisateur = ?`,              
                [id_utilisateur]
            );

            // Nouveaux clients ce mois
            const [nouveauxRows] = await pool.execute(
                `SELECT COUNT(*) as nouveaux
                 FROM (
                    SELECT telephone, MIN(date_commande) as premiere
                    FROM commandes_vente
                    WHERE telephone IS NOT NULL
                      AND telephone <> ''
                      AND id_utilisateur = ?              
                    GROUP BY telephone
                    HAVING YEAR(premiere) = YEAR(CURDATE())
                       AND MONTH(premiere) = MONTH(CURDATE())
                 ) as sub`,
                [id_utilisateur]
            );

            const s = rows[0];
            return {
                total_clients: parseInt(s.total_clients) || 0,
                clients_actifs_30j: parseInt(s.clients_actifs_30j) || 0,
                clients_actifs_7j: parseInt(s.clients_actifs_7j) || 0,
                clients_actifs_24h: parseInt(s.clients_actifs_24h) || 0,
                panier_moyen: parseFloat(panierRows[0].panier_moyen) || 0,
                nouveaux_clients_mois: parseInt(nouveauxRows[0].nouveaux) || 0
            };
        } catch (error) {
            console.error('❌ Erreur Client.getStats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * TOP CLIENTS (par chiffre d'affaires)
     * ============================================================
     */
    static async getTopClients(limit = 10, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopClients');
        }

        try {
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

            const [rows] = await pool.query(
                `SELECT
                    cv.telephone,
                    MAX(cv.nomclient) as nomclient,
                    COUNT(DISTINCT cv.id_commande) as nb_commandes,
                    COALESCE(SUM(cv.montant_total), 0) as total_achats,
                    COALESCE(AVG(cv.montant_total), 0) as panier_moyen,
                    MAX(cv.date_commande) as derniere_commande
                 FROM commandes_vente cv
                 WHERE cv.telephone IS NOT NULL
                   AND cv.telephone <> ''
                   AND cv.statut IN ('livree', 'expediee')
                   AND cv.id_utilisateur = ?
                 GROUP BY cv.telephone
                 ORDER BY total_achats DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur]
            );

            return rows.map(r => ({
                telephone: r.telephone,
                nomclient: r.nomclient,
                nb_commandes: parseInt(r.nb_commandes) || 0,
                total_achats: parseFloat(r.total_achats) || 0,
                panier_moyen: parseFloat(r.panier_moyen) || 0,
                derniere_commande: r.derniere_commande
            }));
        } catch (error) {
            console.error('❌ Erreur Client.getTopClients:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * RECHERCHE DE CLIENTS (autocomplete)
     * ============================================================
     */
    static async search(keyword, limit = 10, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }
        if (!keyword || keyword.trim() === '') return [];

        try {
            const limitInt = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
            const search = `%${keyword.trim()}%`;

            const [rows] = await pool.query(
                `SELECT
                    cv.telephone,
                    MAX(cv.nomclient) as nomclient,
                    COUNT(DISTINCT cv.id_commande) as nb_commandes,
                    MAX(cv.date_commande) as derniere_commande
                 FROM commandes_vente cv
                 WHERE cv.telephone IS NOT NULL
                   AND cv.telephone <> ''
                   AND (cv.nomclient LIKE ? OR cv.telephone LIKE ?)
                   AND cv.id_utilisateur = ?
                 GROUP BY cv.telephone
                 ORDER BY derniere_commande DESC
                 LIMIT ${limitInt}`,
                [search, search, id_utilisateur]
            );

            return rows.map(r => ({
                telephone: r.telephone,
                nomclient: r.nomclient,
                nb_commandes: parseInt(r.nb_commandes) || 0,
                derniere_commande: r.derniere_commande
            }));
        } catch (error) {
            console.error('❌ Erreur Client.search:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * EXPORT CSV
     * ============================================================
     */
    static async export(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour export');
        }

        try {
            const clients = await this.findAll(filters, id_utilisateur);
            return clients.map(c => ({
                nomclient: c.nomclient || '',
                telephone: c.telephone || '',
                nb_commandes: c.nb_commandes || 0,
                total_achats: c.total_achats || 0,
                panier_moyen: c.panier_moyen || 0,
                nb_factures: c.nb_factures || 0,
                montant_impaye: c.montant_impaye || 0,
                premiere_commande: c.premiere_commande
                    ? new Date(c.premiere_commande).toLocaleDateString('fr-FR') : '',
                derniere_commande: c.derniere_commande
                    ? new Date(c.derniere_commande).toLocaleDateString('fr-FR') : ''
            }));
        } catch (error) {
            console.error('❌ Erreur Client.export:', error);
            throw error;
        }
    }
}

export default Client;