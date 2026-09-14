// models/CommandeVente.js
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';

class CommandeVente {
    /**
     * ============================================================
     * Générer un numéro de commande unique PAR WORKSPACE
     * ============================================================
     */
    static async genererNumero(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour genererNumero');
        }

        const date = new Date();
        const annee = date.getFullYear();
        const mois = String(date.getMonth() + 1).padStart(2, '0');

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM commandes_vente
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `CV-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * Générer un numéro de facture unique PAR WORKSPACE
     * ============================================================
     */
    static async genererNumeroFacture(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour genererNumeroFacture');
        }

        const date = new Date();
        const annee = date.getFullYear();
        const mois = String(date.getMonth() + 1).padStart(2, '0');

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM factures_vente
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `FV-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * ✅ Créer une nouvelle commande client + facture (unités de vente)
     * ============================================================
     * Règles :
     *  - quantite est en UNITÉ DE VENTE (ex: 1 carton)
     *  - quantite_base est le multiplicateur (ex: 12)
     *  - quantite_totale_base = quantite × quantite_base (ex: 12 bidons)
     *  - Le stock est TOUJOURS décrémenté en UNITÉ DE BASE
     *  - prix_vente est le prix de l'unité de vente (ex: 30000 F le carton)
     */
    static async create(data) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const {
                nomclient = null,
                telephone = null,
                date_commande,
                notes,
                id_utilisateur,
                mode_paiement = 'especes',
                date_echeance,
                lignes = []
            } = data;

            if (!id_utilisateur) {
                throw new Error('id_utilisateur requis');
            }
            if (!date_commande) {
                throw new Error('La date de commande est obligatoire');
            }
            if (lignes.length === 0) {
                throw new Error('Au moins un produit est requis');
            }

            // ============================================================
            // 1. VÉRIFICATIONS PRODUITS + CALCUL QUANTITÉS DE BASE
            // ============================================================
            const lignesCalculees = [];

            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_unite_vente = null,
                    nom_unite_vente = 'Unité',
                    quantite_base = 1,
                    quantite,
                    quantite_totale_base = null,
                    prix_vente = 0,
                    remise = 0
                } = ligne;

                // --- Vérifier le produit (workspace) ---
                const [produitRows] = await connection.execute(
                    `SELECT id_produit, nom, quantite_stock, prix_vente
                     FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [id_produit, id_utilisateur]
                );

                if (produitRows.length === 0) {
                    throw new Error(`Produit ID ${id_produit} non trouvé`);
                }

                if (!quantite || parseFloat(quantite) <= 0) {
                    throw new Error(`La quantité pour ${produitRows[0].nom} doit être positive`);
                }

                // --- Récupérer quantite_base + prix depuis unites_vente ---
                let qteBase = parseFloat(quantite_base) || 1;
                let prixUnitaire = parseFloat(prix_vente) || 0;

                if (id_unite_vente) {
                    const [uvRows] = await connection.execute(
                        `SELECT quantite_base, prix_vente
                         FROM unites_vente
                         WHERE id_unite_vente = ? AND id_produit = ? AND actif = TRUE`,
                        [id_unite_vente, id_produit]
                    );
                    if (uvRows.length > 0) {
                        qteBase = parseFloat(uvRows[0].quantite_base) || 1;
                        // Utiliser le prix de l'unité de vente choisie si non fourni
                        if (!prixUnitaire || prixUnitaire === 0) {
                            prixUnitaire = parseFloat(uvRows[0].prix_vente) || 0;
                        }
                    }
                }

                // Si toujours pas de prix, fallback sur produits.prix_vente
                if (!prixUnitaire || prixUnitaire === 0) {
                    prixUnitaire = parseFloat(produitRows[0].prix_vente) || 0;
                }

                if (prixUnitaire <= 0) {
                    throw new Error(`Le prix de vente du produit "${produitRows[0].nom}" n'est pas défini`);
                }

                // --- Quantité totale en unité de base ---
                const qteTotaleBase = quantite_totale_base !== null
                    ? parseFloat(quantite_totale_base)
                    : parseFloat(quantite) * qteBase;

                // --- Vérifier le stock en UNITÉ DE BASE ---
                const stockDisponible = parseFloat(produitRows[0].quantite_stock) || 0;
                if (qteTotaleBase > stockDisponible) {
                    throw new Error(
                        `Stock insuffisant pour "${produitRows[0].nom}". ` +
                        `Disponible: ${stockDisponible} unités de base, Demandé: ${qteTotaleBase} unités de base`
                    );
                }

                lignesCalculees.push({
                    id_produit,
                    id_unite_vente,
                    nom_unite_vente,
                    quantite_base: qteBase,
                    quantite: parseFloat(quantite),
                    quantite_totale_base: qteTotaleBase,
                    prix_vente: prixUnitaire,
                    remise: parseFloat(remise) || 0
                });
            }

            // ============================================================
            // 2. GÉNÉRATION DES NUMÉROS
            // ============================================================
            const numero_commande = await this.genererNumero(id_utilisateur);
            const numero_facture = await this.genererNumeroFacture(id_utilisateur);

            // ============================================================
            // 3. CRÉATION DE LA COMMANDE
            // ============================================================
            const [result] = await connection.execute(
                `INSERT INTO commandes_vente (
                    id_utilisateur, numero_commande, date_commande,
                    nomclient, telephone, statut, montant_total, notes
                ) VALUES (?, ?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur,
                    numero_commande,
                    date_commande,
                    nomclient,
                    telephone,
                    notes || null
                ]
            );

            const id_commande = result.insertId;
            let montant_total = 0;

            // ============================================================
            // 4. TRAITEMENT DES LIGNES + SORTIE STOCK
            // ============================================================
            for (const lc of lignesCalculees) {
                // --- Insérer la ligne AVEC les infos d'unité ---
await connection.execute(
    `INSERT INTO ligne_commande_vente (
        id_commande, id_produit,
        id_unite_vente, nom_unite_vente, quantite_base,
        quantite, prix_vente, remise
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,  
    [
        id_commande,
        lc.id_produit,
        lc.id_unite_vente,
        lc.nom_unite_vente,
        lc.quantite_base,
        lc.quantite,
        lc.prix_vente,
        lc.remise
    ]
);

                const montant_ligne = lc.quantite * lc.prix_vente * (1 - lc.remise / 100);
                montant_total += montant_ligne;

                // --- Récupérer stock actuel ---
                const [stockRows] = await connection.execute(
                    `SELECT quantite_stock FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [lc.id_produit, id_utilisateur]
                );
                const ancienne_qte = parseFloat(stockRows[0]?.quantite_stock) || 0;

                // ✅ DÉCRÉMENTER EN UNITÉ DE BASE (12 bidons, pas 1 carton)
                const nouvelle_qte = ancienne_qte - lc.quantite_totale_base;

                await connection.execute(
                    `UPDATE produits SET quantite_stock = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [nouvelle_qte, lc.id_produit, id_utilisateur]
                );

                // --- Mise à jour statut produit ---
                const nouveauStatut = nouvelle_qte <= 0 ? 'rupture' : 'disponible';
                await connection.execute(
                    `UPDATE produits SET statut = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [nouveauStatut, lc.id_produit, id_utilisateur]
                );

                // --- Sortie stock AVEC unité ---
                const ref_sortie = `SORTIE-VENTE-${Date.now()}-${lc.id_produit}-${Math.random().toString(36).slice(2, 7)}`;
                await connection.execute(
                    `INSERT INTO sorties_stock (
                        id_utilisateur, reference, date_sortie, id_produit,
                        id_unite_vente, nom_unite_vente, quantite_base,
                        quantite, quantite_totale_base,
                        type_sortie, id_commande_vente, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'vente', ?, ?)`,
                    [
                        id_utilisateur,
                        ref_sortie,
                        date_commande,
                        lc.id_produit,
                        lc.id_unite_vente,
                        lc.nom_unite_vente,
                        lc.quantite_base,
                        lc.quantite,              // 1 carton
                        lc.quantite_totale_base,  // 12 bidons
                        id_commande,
                        `Vente ${numero_commande}`
                    ]
                );

                // --- Mouvement centralisé (en unité de base) ---
                await MouvementStock.enregistrer({
                    id_produit: lc.id_produit,
                    type_mouvement: 'sortie',
                    quantite: lc.quantite_totale_base,   // ✅ 12 bidons
                    id_reference: id_commande,
                    type_reference: 'vente',
                    id_utilisateur,
                    notes: `Vente ${numero_commande} - ${lc.quantite} ${lc.nom_unite_vente}`
                }, connection, id_utilisateur);
            }

            // ============================================================
            // 5. MISE À JOUR MONTANT TOTAL
            // ============================================================
            await connection.execute(
                `UPDATE commandes_vente SET montant_total = ?
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [montant_total, id_commande, id_utilisateur]
            );

            // ============================================================
            // 6. CRÉATION DE LA FACTURE
            // ============================================================
            const date_echeance_facture = date_echeance
                || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            await connection.execute(
                `INSERT INTO factures_vente (
                    id_utilisateur, numero_facture, date_facture, date_echeance,
                    id_commande, montant_total, statut, mode_paiement, notes
                ) VALUES (?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
                [
                    id_utilisateur,
                    numero_facture,
                    date_commande,
                    date_echeance_facture,
                    id_commande,
                    montant_total,
                    mode_paiement || 'especes',
                    notes || `Facture pour commande ${numero_commande}`
                ]
            );

            await connection.commit();
            return await this.findById(id_commande, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * ✅ Récupérer une commande par ID (avec unités de vente)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT cv.*,
                        u.fullname as utilisateur_nom,
                        fv.id_facture,
                        fv.numero_facture,
                        fv.date_facture,
                        fv.date_echeance,
                        fv.statut as statut_facture,
                        fv.mode_paiement,
                        fv.montant_total as montant_facture
                 FROM commandes_vente cv
                 LEFT JOIN utilisateurs u ON cv.id_utilisateur = u.id_utilisateur
                 LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                 WHERE cv.id_commande = ?
                   AND cv.id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const commande = rows[0];

            // ✅ Lignes avec unités de vente
            const [lignes] = await pool.execute(
                `SELECT lcv.*,
                        p.nom as produit_nom,
                        p.id_marque,
                        m.nom as marque_nom,
                        p.id_unite,
                        u.symbole as unite_symbole,
                        uv.nom as unite_vente_nom,
                        uv.quantite_base as unite_vente_quantite_base
                 FROM ligne_commande_vente lcv
                 LEFT JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 LEFT JOIN unites_vente uv ON lcv.id_unite_vente = uv.id_unite_vente
                 WHERE lcv.id_commande = ?`,
                [id]
            );

            // ✅ Enrichir avec fallback
            commande.lignes = lignes.map(l => ({
                ...l,
                nom_unite_vente: l.nom_unite_vente || l.unite_vente_nom || 'Unité',
                quantite_base: parseFloat(l.quantite_base) || 1,
                quantite_totale_base: parseFloat(l.quantite_totale_base)
                    || (parseFloat(l.quantite) * (parseFloat(l.quantite_base) || 1))
            }));

            // Paiements
            const [paiements] = await pool.execute(
                `SELECT p.*
                 FROM paiements p
                 INNER JOIN factures_vente fv ON p.id_facture = fv.id_facture
                 WHERE fv.id_commande = ? AND p.id_utilisateur = ?
                 ORDER BY p.date_paiement DESC`,
                [id, id_utilisateur]
            );

            commande.paiements = paiements;
            return commande;

        } catch (error) {
            console.error('❌ Error finding commande vente by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer toutes les commandes avec filtres (par workspace)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT cv.*,
                       u.fullname as utilisateur_nom,
                       fv.id_facture,
                       fv.numero_facture,
                       fv.statut as statut_facture,
                       fv.mode_paiement
                FROM commandes_vente cv
                LEFT JOIN utilisateurs u ON cv.id_utilisateur = u.id_utilisateur
                LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                WHERE cv.id_utilisateur = ?
            `;
            const params = [id_utilisateur];

            if (filters.search) {
                query += ` AND (cv.numero_commande LIKE ?
                            OR cv.nomclient LIKE ?
                            OR cv.telephone LIKE ?
                            OR fv.numero_facture LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s, s);
            }

            if (filters.statut) {
                query += ' AND cv.statut = ?';
                params.push(filters.statut);
            }

            if (filters.date_debut) {
                query += ' AND cv.date_commande >= ?';
                params.push(filters.date_debut);
            }

            if (filters.date_fin) {
                query += ' AND cv.date_commande <= ?';
                params.push(filters.date_fin);
            }

            query += ' ORDER BY cv.date_commande DESC, cv.id_commande DESC';

            if (filters.limit) {
                const limit = Math.min(parseInt(filters.limit) || 50, 500);
                query += ` LIMIT ${limit}`;
            }

            if (filters.offset) {
                const offset = Math.max(parseInt(filters.offset) || 0, 0);
                query += ` OFFSET ${offset}`;
            }

            const [rows] = await pool.query(query, params);
            return rows;

        } catch (error) {
            console.error('❌ Error finding commandes vente:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les commandes par statut
     * ============================================================
     */
    static async findByStatut(statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT cv.*
                 FROM commandes_vente cv
                 WHERE cv.statut = ?
                   AND cv.id_utilisateur = ?
                 ORDER BY cv.date_commande DESC`,
                [statut, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by statut:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les commandes d'un client par téléphone
     * ============================================================
     */
    static async findByTelephone(telephone, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByTelephone');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT cv.*, u.fullname as utilisateur_nom
                 FROM commandes_vente cv
                 LEFT JOIN utilisateurs u ON cv.id_utilisateur = u.id_utilisateur
                 WHERE cv.telephone = ?
                   AND cv.id_utilisateur = ?
                 ORDER BY cv.date_commande DESC`,
                [telephone, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by telephone:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une commande
     * ============================================================
     */
    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatut');
        }

        const statutsValides = ['en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee'];
        if (!statutsValides.includes(statut)) {
            throw new Error('Statut invalide');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE commandes_vente SET statut = ?
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [statut, id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating statut:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une facture
     * ============================================================
     */
    static async updateFactureStatut(id_commande, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateFactureStatut');
        }

        const statutsValides = ['en_attente', 'payee', 'partiellement_payee', 'en_retard', 'annulee'];
        if (!statutsValides.includes(statut)) {
            throw new Error('Statut de facture invalide');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE factures_vente SET statut = ?
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [statut, id_commande, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating facture statut:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Ajouter un paiement sur une facture existante
     * ============================================================
     */
    static async addPaiement(idCommande, paiementData, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour addPaiement');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const {
                id_facture,
                date_paiement,
                montant,
                mode_paiement,
                note,
                reference
            } = paiementData;

            // Vérifier la commande
            const [commandeRows] = await connection.execute(
                `SELECT id_commande, numero_commande
                 FROM commandes_vente
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [idCommande, id_utilisateur]
            );
            if (commandeRows.length === 0) {
                throw new Error('Commande non trouvée');
            }

            // Récupérer la facture
            let factureId = id_facture;
            if (!factureId) {
                const [factureRows] = await connection.execute(
                    `SELECT id_facture, montant_total, statut
                     FROM factures_vente
                     WHERE id_commande = ? AND id_utilisateur = ?
                     ORDER BY date_creation DESC LIMIT 1`,
                    [idCommande, id_utilisateur]
                );
                if (factureRows.length === 0) {
                    throw new Error('Aucune facture trouvée pour cette commande.');
                }
                factureId = factureRows[0].id_facture;
                if (factureRows[0].statut === 'payee') {
                    throw new Error('Cette facture est déjà payée');
                }
            }

            const [factureRows] = await connection.execute(
                `SELECT id_facture, montant_total, statut
                 FROM factures_vente
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [factureId, id_utilisateur]
            );
            if (factureRows.length === 0) {
                throw new Error('Facture non trouvée');
            }
            const montantFacture = parseFloat(factureRows[0].montant_total) || 0;

            const [paiementRows] = await connection.execute(
                `SELECT COALESCE(SUM(montant), 0) as total_paye
                 FROM paiements
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [factureId, id_utilisateur]
            );
            const totalPaye = parseFloat(paiementRows[0].total_paye) || 0;
            const soldeRestant = montantFacture - totalPaye;

            if (parseFloat(montant) <= 0) {
                throw new Error('Le montant du paiement doit être supérieur à 0');
            }
            if (parseFloat(montant) > soldeRestant) {
                throw new Error(`Le paiement (${montant}) dépasse le solde restant (${soldeRestant})`);
            }

            const [result] = await connection.execute(
                `INSERT INTO paiements (
                    id_utilisateur, id_facture, date_paiement, montant,
                    mode_paiement, note, reference
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    id_utilisateur,
                    factureId,
                    date_paiement,
                    montant,
                    mode_paiement || 'especes',
                    note || null,
                    reference || null
                ]
            );

            const id_paiement = result.insertId;

            const nouveauTotalPaye = totalPaye + parseFloat(montant);
            let nouveauStatut = 'en_attente';
            if (nouveauTotalPaye >= montantFacture) {
                nouveauStatut = 'payee';
            } else if (nouveauTotalPaye > 0) {
                nouveauStatut = 'partiellement_payee';
            }

            await connection.execute(
                `UPDATE factures_vente SET statut = ?
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [nouveauStatut, factureId, id_utilisateur]
            );

            await connection.commit();

            // Récupérer le paiement inséré (via pool, plus sûr)
            const [paiement] = await pool.execute(
                `SELECT p.*, u.fullname as utilisateur_nom,
                        DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                 FROM paiements p
                 LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                 WHERE p.id_paiement = ?`,
                [id_paiement]
            );

            return paiement[0];

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Statistiques des ventes (par workspace)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) as total_commandes,
                    SUM(CASE WHEN statut = 'en_attente'     THEN 1 ELSE 0 END) as en_attente,
                    SUM(CASE WHEN statut = 'confirmee'      THEN 1 ELSE 0 END) as confirmee,
                    SUM(CASE WHEN statut = 'en_preparation' THEN 1 ELSE 0 END) as en_preparation,
                    SUM(CASE WHEN statut = 'expediee'       THEN 1 ELSE 0 END) as expediee,
                    SUM(CASE WHEN statut = 'livree'         THEN 1 ELSE 0 END) as livree,
                    SUM(CASE WHEN statut = 'annulee'        THEN 1 ELSE 0 END) as annulee,
                    COALESCE(SUM(montant_total), 0) as total_chiffre_affaires,
                    COALESCE(AVG(montant_total), 0) as panier_moyen
                 FROM commandes_vente
                 WHERE id_utilisateur = ?`,
                [id_utilisateur]
            );

            const stats = rows[0];
            return {
                total_commandes: parseInt(stats.total_commandes) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                confirmee: parseInt(stats.confirmee) || 0,
                en_preparation: parseInt(stats.en_preparation) || 0,
                expediee: parseInt(stats.expediee) || 0,
                livree: parseInt(stats.livree) || 0,
                annulee: parseInt(stats.annulee) || 0,
                total_chiffre_affaires: parseFloat(stats.total_chiffre_affaires) || 0,
                panier_moyen: parseFloat(stats.panier_moyen) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * ✅ Annuler une commande + réintégrer le stock (unités de base)
     * ============================================================
     */
    static async annuler(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour annuler');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Vérifier la commande
            const [rows] = await connection.execute(
                `SELECT statut FROM commandes_vente
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Commande non trouvée');
            }
            if (rows[0].statut === 'livree') {
                throw new Error('Une commande livrée ne peut pas être annulée');
            }
            if (rows[0].statut === 'annulee') {
                throw new Error('Cette commande est déjà annulée');
            }

            // ✅ Récupérer les lignes avec quantite_totale_base
            const [lignes] = await connection.execute(
                `SELECT id_produit, quantite, quantite_totale_base, id_unite_vente, nom_unite_vente
                 FROM ligne_commande_vente
                 WHERE id_commande = ?`,
                [id]
            );

            for (const ligne of lignes) {
                // ✅ Réintégrer la quantité en UNITÉ DE BASE
                const qteBase = parseFloat(ligne.quantite_totale_base)
                    || parseFloat(ligne.quantite)
                    || 0;

                const [stockRows] = await connection.execute(
                    `SELECT quantite_stock FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [ligne.id_produit, id_utilisateur]
                );
                const ancienne = parseFloat(stockRows[0]?.quantite_stock) || 0;
                const nouvelle = ancienne + qteBase;

                await connection.execute(
                    `UPDATE produits SET quantite_stock = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [nouvelle, ligne.id_produit, id_utilisateur]
                );

                // Mise à jour statut produit
                const nouveauStatut = nouvelle <= 0 ? 'rupture' : 'disponible';
                await connection.execute(
                    `UPDATE produits SET statut = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [nouveauStatut, ligne.id_produit, id_utilisateur]
                );

                // Mouvement d'entrée (en unité de base)
                await MouvementStock.enregistrer({
                    id_produit: ligne.id_produit,
                    type_mouvement: 'entree',
                    quantite: qteBase,   // ✅ 12 bidons
                    id_reference: id,
                    type_reference: 'vente_annulee',
                    id_utilisateur,
                    notes: `Annulation commande ${id}`
                }, connection, id_utilisateur);
            }

            // Mettre à jour statut commande
            await connection.execute(
                `UPDATE commandes_vente SET statut = 'annulee'
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            // Mettre à jour statut facture
            await connection.execute(
                `UPDATE factures_vente SET statut = 'annulee'
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            await connection.commit();
            return true;

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Supprimer une commande (seulement si en attente)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT statut FROM commandes_vente
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Commande non trouvée');
            }
            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer une commande ${rows[0].statut}`);
            }

            const [result] = await pool.execute(
                `DELETE FROM commandes_vente
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            return result.affectedRows > 0;

        } catch (error) {
            console.error('❌ Error deleting commande:', error);
            throw error;
        }
    }
}

export default CommandeVente;