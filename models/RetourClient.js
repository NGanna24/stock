// models/RetourClient.js
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';

class RetourClient {
    /**
     * ============================================================
     * GÉNÉRER UN NUMÉRO DE RETOUR UNIQUE PAR WORKSPACE
     * Format : RT-YYYYMM-XXXX (ex: RT-202409-0001)
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
             FROM retours_clients
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `RT-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * ✅ RECHERCHER DES COMMANDES POUR RETOUR
     * Recherche par n° commande, n° facture ou téléphone
     * Exclut les commandes annulées et totalement retournées
     * ============================================================
     */
    static async searchCommandes(query, id_utilisateur, joursMax = 90) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour searchCommandes');
        }

        if (!query || query.trim().length < 2) {
            return [];
        }

        const q = query.trim();
        const pattern = `%${q}%`;
        const joursInt = Math.max(1, Math.min(365, parseInt(joursMax, 10) || 90));

        const [rows] = await pool.query(
            `SELECT
                cv.id_commande,
                cv.numero_commande,
                cv.date_commande,
                cv.nomclient,
                cv.telephone,
                cv.montant_total,
                cv.statut,
                fv.id_facture,
                fv.numero_facture,
                COUNT(DISTINCT lcv.id_ligne_vente) AS nb_lignes,
                COALESCE(SUM(lcv.quantite_totale_base), 0) AS total_unites_base,
                COALESCE(SUM(lcv.quantite_retournee_base), 0) AS total_retourne_base
             FROM commandes_vente cv
             LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
             LEFT JOIN ligne_commande_vente lcv ON cv.id_commande = lcv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.statut != 'annulee'
               AND cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
               AND (
                   cv.numero_commande LIKE ?
                   OR fv.numero_facture LIKE ?
                   OR cv.telephone LIKE ?
                   OR cv.nomclient LIKE ?
               )
             GROUP BY cv.id_commande, fv.id_facture
             HAVING total_retourne_base < total_unites_base
             ORDER BY cv.date_commande DESC
             LIMIT 20`,
            [id_utilisateur, pattern, pattern, pattern, pattern]
        );

        return rows.map(r => ({
            ...r,
            nb_lignes: parseInt(r.nb_lignes) || 0,
            total_unites_base: parseFloat(r.total_unites_base) || 0,
            total_retourne_base: parseFloat(r.total_retourne_base) || 0,
            reste_a_retourner: (parseFloat(r.total_unites_base) || 0) - (parseFloat(r.total_retourne_base) || 0),
            montant_total: parseFloat(r.montant_total) || 0
        }));
    }

    /**
     * ============================================================
     * ✅ CRÉER UN RETOUR CLIENT (avec validation complète)
     *
     * @param {Object} data
     * @param {number} data.id_commande_vente
     * @param {string} data.motif_retour
     * @param {string} data.type_resolution
     * @param {string} data.notes
     * @param {Array}  data.lignes - [{ id_produit, id_unite_vente, nom_unite_vente, quantite_base, quantite, etat_produit }]
     * @param {number} data.id_utilisateur
     * ============================================================
     */
    static async create(data) {
        const {
            id_commande_vente,
            motif_retour,
            type_resolution = 'remboursement_especes',
            notes,
            lignes = [],
            id_utilisateur
        } = data;

        if (!id_utilisateur) throw new Error('id_utilisateur requis');
        if (!id_commande_vente) throw new Error('La commande est obligatoire');
        if (!motif_retour) throw new Error('Le motif est obligatoire');
        if (!lignes.length) throw new Error('Au moins un produit est requis');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // ============================================================
            // 1. RÉCUPÉRER LA COMMANDE
            // ============================================================
            const [commandeRows] = await connection.execute(
                `SELECT cv.*, fv.id_facture, fv.numero_facture
                 FROM commandes_vente cv
                 LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                 WHERE cv.id_commande = ? AND cv.id_utilisateur = ?`,
                [id_commande_vente, id_utilisateur]
            );

            if (commandeRows.length === 0) {
                throw new Error('Commande non trouvée');
            }
            const commande = commandeRows[0];

            if (commande.statut === 'annulee') {
                throw new Error('Impossible de retourner une commande annulée');
            }

            // ============================================================
            // 2. RÉCUPÉRER LES LIGNES DE LA COMMANDE
            // ============================================================
            const [lignesCommande] = await connection.execute(
                `SELECT
                    lcv.id_ligne_vente,
                    lcv.id_produit,
                    lcv.id_unite_vente,
                    lcv.nom_unite_vente,
                    lcv.quantite_base,
                    lcv.quantite,
                    lcv.quantite_totale_base,
                    lcv.prix_vente,
                    lcv.quantite_retournee_base,
                    p.nom AS produit_nom,
                    p.quantite_stock
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 WHERE lcv.id_commande = ?`,
                [id_commande_vente]
            );

            if (lignesCommande.length === 0) {
                throw new Error('Aucune ligne dans la commande');
            }

            // ============================================================
            // 3. VALIDER CHAQUE LIGNE DE RETOUR
            // ============================================================
            const lignesValidees = [];

            for (const ligneRetour of lignes) {
                const ligneOrigine = lignesCommande.find(
                    l => l.id_produit === ligneRetour.id_produit
                );

                if (!ligneOrigine) {
                    throw new Error(
                        `Produit ID ${ligneRetour.id_produit} non trouvé dans la commande`
                    );
                }

                // Quantité retournée en unité de base
                const qteRetourBase =
                    parseFloat(ligneRetour.quantite) *
                    parseFloat(ligneRetour.quantite_base || 1);

                if (qteRetourBase <= 0) {
                    throw new Error(
                        `Quantité invalide pour "${ligneOrigine.produit_nom}"`
                    );
                }

                const dejaRetourne = parseFloat(ligneOrigine.quantite_retournee_base) || 0;
                const retournable = parseFloat(ligneOrigine.quantite_totale_base) - dejaRetourne;

                if (qteRetourBase > retournable) {
                    throw new Error(
                        `Retour impossible pour "${ligneOrigine.produit_nom}". ` +
                        `Retournable : ${retournable} unités, demandé : ${qteRetourBase} unités`
                    );
                }

                // ✅ Prix unitaire réel (prorata basé sur le prix d'achat d'origine)
                const prixUnitaireReel =
                    parseFloat(ligneOrigine.prix_vente) /
                    parseFloat(ligneOrigine.quantite_base || 1);

                const montantRembourse = qteRetourBase * prixUnitaireReel;

                lignesValidees.push({
                    id_produit: ligneOrigine.id_produit,
                    id_ligne_vente: ligneOrigine.id_ligne_vente,
                    id_unite_vente: ligneRetour.id_unite_vente || null,
                    nom_unite_vente: ligneRetour.nom_unite_vente || 'Unité',
                    quantite_base: parseFloat(ligneRetour.quantite_base) || 1,
                    quantite: parseFloat(ligneRetour.quantite),
                    quantite_totale_base: qteRetourBase,
                    prix_vente: parseFloat(ligneOrigine.prix_vente),
                    prix_unitaire_reel: prixUnitaireReel,
                    montant_rembourse: montantRembourse,
                    etat_produit: ligneRetour.etat_produit || 'neuf',
                    produit_nom: ligneOrigine.produit_nom
                });
            }

            // ============================================================
            // 4. CALCUL DU MONTANT TOTAL
            // ============================================================
            const montantTotal = lignesValidees.reduce(
                (sum, l) => sum + l.montant_rembourse,
                0
            );

            // ============================================================
            // 5. GÉNÉRER LE NUMÉRO DE RETOUR
            // ============================================================
            const numero_retour = await this.genererNumero(id_utilisateur);

            // ============================================================
            // 6. CRÉER LE RETOUR
            // ============================================================
            const [retourResult] = await connection.execute(
                `INSERT INTO retours_clients (
                    id_utilisateur, numero_retour, date_retour,
                    id_commande_vente, id_facture,
                    nomclient, telephone,
                    statut, motif_retour, type_resolution,
                    montant_total, notes
                ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'accepte', ?, ?, ?, ?)`,
                [
                    id_utilisateur,
                    numero_retour,
                    id_commande_vente,
                    commande.id_facture || null,
                    commande.nomclient,
                    commande.telephone,
                    motif_retour,
                    type_resolution,
                    montantTotal,
                    notes || null
                ]
            );

            const id_retour = retourResult.insertId;

            // ============================================================
            // 7. CRÉER LES LIGNES + RÉINTÉGRER LE STOCK
            // ============================================================
            for (const ligne of lignesValidees) {
                // 7a. Insérer la ligne de retour
                await connection.execute(
                    `INSERT INTO retour_client_lignes (
                        id_retour_client, id_produit, id_ligne_commande_vente,
                        id_unite_vente, nom_unite_vente,
                        quantite_base, quantite, quantite_totale_base,
                        prix_vente, prix_remboursement, remise,
                        motif_retour, etat_produit
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                    [
                        id_retour,
                        ligne.id_produit,
                        ligne.id_ligne_vente,
                        ligne.id_unite_vente,
                        ligne.nom_unite_vente,
                        ligne.quantite_base,
                        ligne.quantite,
                        ligne.quantite_totale_base,
                        ligne.prix_vente,
                        ligne.prix_unitaire_reel,
                        motif_retour,
                        ligne.etat_produit
                    ]
                );

                // 7b. Mettre à jour le compteur sur la ligne d'origine
                await connection.execute(
                    `UPDATE ligne_commande_vente
                     SET quantite_retournee_base = quantite_retournee_base + ?
                     WHERE id_ligne_vente = ?`,
                    [ligne.quantite_totale_base, ligne.id_ligne_vente]
                );

                // 7c. Réintégrer le stock SI le produit est neuf
                if (ligne.etat_produit === 'neuf') {
                    await connection.execute(
                        `UPDATE produits
                         SET quantite_stock = quantite_stock + ?
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [ligne.quantite_totale_base, ligne.id_produit, id_utilisateur]
                    );

                    // 7d. Enregistrer l'entrée de stock
                    const refEntree = `ENTREE-RETOUR-${numero_retour}-${ligne.id_produit}`;
                    await connection.execute(
                        `INSERT INTO entrees_stock (
                            id_utilisateur, reference, date_entree, id_produit,
                            id_unite_vente, nom_unite_vente, quantite_base,
                            quantite, quantite_totale_base, notes
                        ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            id_utilisateur,
                            refEntree,
                            ligne.id_produit,
                            ligne.id_unite_vente,
                            ligne.nom_unite_vente,
                            ligne.quantite_base,
                            ligne.quantite,
                            ligne.quantite_totale_base,
                            `Retour client ${numero_retour}`
                        ]
                    );

                    // 7e. Mouvement de stock centralisé
                    await MouvementStock.enregistrer({
                        id_produit: ligne.id_produit,
                        type_mouvement: 'entree',
                        quantite: ligne.quantite_totale_base,
                        id_reference: id_retour,
                        type_reference: 'retour_client',
                        id_utilisateur,
                        notes: `Retour ${numero_retour}`
                    }, connection, id_utilisateur);
                }
            }

            // ============================================================
            // 8. CRÉER LE REMBOURSEMENT (paiement négatif)
            // ============================================================
            if (type_resolution === 'remboursement_especes' && commande.id_facture) {
                await connection.execute(
                    `INSERT INTO paiements (
                        id_utilisateur, id_facture, date_paiement,
                        montant, mode_paiement, note, reference
                    ) VALUES (?, ?, CURDATE(), ?, 'especes', ?, ?)`,
                    [
                        id_utilisateur,
                        commande.id_facture,
                        -montantTotal,  // ⚠️ NÉGATIF
                        `Remboursement retour ${numero_retour}`,
                        numero_retour
                    ]
                );
            }

            await connection.commit();

            return await this.findById(id_retour, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * ✅ RÉCUPÉRER UN RETOUR COMPLET PAR ID
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        const [rows] = await pool.execute(
            `SELECT
                rc.*,
                cv.numero_commande,
                cv.date_commande,
                fv.numero_facture,
                fv.date_facture,
                fv.statut AS statut_facture,
                u.fullname AS utilisateur_nom
             FROM retours_clients rc
             LEFT JOIN commandes_vente cv ON rc.id_commande_vente = cv.id_commande
             LEFT JOIN factures_vente fv ON rc.id_facture = fv.id_facture
             LEFT JOIN utilisateurs u ON rc.id_utilisateur = u.id_utilisateur
             WHERE rc.id_retour_client = ? AND rc.id_utilisateur = ?`,
            [id, id_utilisateur]
        );

        if (rows.length === 0) return null;
        const retour = rows[0];

        // Lignes du retour
        const [lignes] = await pool.execute(
            `SELECT
                rcl.*,
                p.nom AS produit_nom,
                p.description AS produit_description,
                m.nom AS marque_nom,
                uv.nom AS unite_vente_nom
             FROM retour_client_lignes rcl
             LEFT JOIN produits p ON rcl.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites_vente uv ON rcl.id_unite_vente = uv.id_unite_vente
             WHERE rcl.id_retour_client = ?`,
            [id]
        );

        retour.lignes = lignes.map(l => ({
            ...l,
            quantite: parseFloat(l.quantite) || 0,
            quantite_base: parseFloat(l.quantite_base) || 1,
            quantite_totale_base: parseFloat(l.quantite_totale_base) || 0,
            prix_vente: parseFloat(l.prix_vente) || 0,
            prix_remboursement: parseFloat(l.prix_remboursement) || 0,
            montant_total: parseFloat(l.montant_total) || 0
        }));

        retour.montant_total = parseFloat(retour.montant_total) || 0;

        return retour;
    }

    /**
     * ============================================================
     * RÉCUPÉRER TOUS LES RETOURS (avec filtres)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        let query = `
            SELECT
                rc.*,
                cv.numero_commande,
                cv.date_commande,
                fv.numero_facture,
                u.fullname AS utilisateur_nom,
                (SELECT COUNT(*) FROM retour_client_lignes rcl
                 WHERE rcl.id_retour_client = rc.id_retour_client) AS nb_lignes
            FROM retours_clients rc
            LEFT JOIN commandes_vente cv ON rc.id_commande_vente = cv.id_commande
            LEFT JOIN factures_vente fv ON rc.id_facture = fv.id_facture
            LEFT JOIN utilisateurs u ON rc.id_utilisateur = u.id_utilisateur
            WHERE rc.id_utilisateur = ?
        `;
        const params = [id_utilisateur];

        if (filters.search) {
            query += ` AND (
                rc.numero_retour LIKE ?
                OR cv.numero_commande LIKE ?
                OR rc.nomclient LIKE ?
                OR rc.telephone LIKE ?
            )`;
            const s = `%${filters.search}%`;
            params.push(s, s, s, s);
        }

        if (filters.statut) {
            query += ' AND rc.statut = ?';
            params.push(filters.statut);
        }

        if (filters.type_resolution) {
            query += ' AND rc.type_resolution = ?';
            params.push(filters.type_resolution);
        }

        if (filters.date_debut) {
            query += ' AND rc.date_retour >= ?';
            params.push(filters.date_debut);
        }

        if (filters.date_fin) {
            query += ' AND rc.date_retour <= ?';
            params.push(filters.date_fin);
        }

        query += ' ORDER BY rc.date_retour DESC, rc.id_retour_client DESC';

        if (filters.limit) {
            const limit = Math.min(parseInt(filters.limit) || 50, 500);
            query += ` LIMIT ${limit}`;

            if (filters.offset) {
                const offset = Math.max(parseInt(filters.offset) || 0, 0);
                query += ` OFFSET ${offset}`;
            }
        }

        const [rows] = await pool.query(query, params);

        return rows.map(r => ({
            ...r,
            montant_total: parseFloat(r.montant_total) || 0,
            nb_lignes: parseInt(r.nb_lignes) || 0
        }));
    }

    /**
     * ============================================================
     * ANNULER UN RETOUR (réintégration inversée)
     * ============================================================
     */
    static async annuler(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [rows] = await connection.execute(
                `SELECT statut FROM retours_clients
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) throw new Error('Retour non trouvé');
            if (rows[0].statut === 'annule') throw new Error('Retour déjà annulé');

            const [lignes] = await connection.execute(
                `SELECT * FROM retour_client_lignes WHERE id_retour_client = ?`,
                [id]
            );

            for (const ligne of lignes) {
                const qteBase = parseFloat(ligne.quantite_totale_base) || 0;

                // Décrémenter le compteur sur la ligne d'origine
                if (ligne.id_ligne_commande_vente) {
                    await connection.execute(
                        `UPDATE ligne_commande_vente
                         SET quantite_retournee_base = quantite_retournee_base - ?
                         WHERE id_ligne_vente = ?`,
                        [qteBase, ligne.id_ligne_commande_vente]
                    );
                }

                // Retirer du stock (si réintégré)
                if (ligne.etat_produit === 'neuf') {
                    await connection.execute(
                        `UPDATE produits
                         SET quantite_stock = quantite_stock - ?
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [qteBase, ligne.id_produit, id_utilisateur]
                    );

                    await MouvementStock.enregistrer({
                        id_produit: ligne.id_produit,
                        type_mouvement: 'sortie',
                        quantite: qteBase,
                        id_reference: id,
                        type_reference: 'retour_client_annule',
                        id_utilisateur,
                        notes: `Annulation retour #${id}`
                    }, connection, id_utilisateur);
                }
            }

            await connection.execute(
                `UPDATE retours_clients
                 SET statut = 'annule', date_traitement = NOW()
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,
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
     * STATISTIQUES DES RETOURS
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) AS en_attente,
                SUM(CASE WHEN statut = 'accepte' THEN 1 ELSE 0 END) AS accepte,
                SUM(CASE WHEN statut = 'refuse' THEN 1 ELSE 0 END) AS refuse,
                SUM(CASE WHEN statut = 'rembourse' THEN 1 ELSE 0 END) AS rembourse,
                SUM(CASE WHEN statut = 'annule' THEN 1 ELSE 0 END) AS annule,
                COALESCE(SUM(montant_total), 0) AS montant_total
             FROM retours_clients
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            en_attente: parseInt(s.en_attente) || 0,
            accepte: parseInt(s.accepte) || 0,
            refuse: parseInt(s.refuse) || 0,
            rembourse: parseInt(s.rembourse) || 0,
            annule: parseInt(s.annule) || 0,
            montant_total: parseFloat(s.montant_total) || 0
        };
    }
}

export default RetourClient;