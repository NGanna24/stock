// models/RetourClient.js
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';

class RetourClient {

    /**
     * ============================================================
     * Rechercher une commande par numéro (workspace)
     * ============================================================
     */
    static async searchCommandeByNumero(numero_commande, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour searchCommandeByNumero');
        }
        if (!numero_commande || numero_commande.trim() === '') {
            throw new Error('Le numéro de commande est obligatoire');
        }

        try {
            const [commandeRows] = await pool.execute(
                `SELECT
                    cv.id_commande,
                    cv.numero_commande,
                    cv.date_commande,
                    cv.nomclient,
                    cv.telephone,
                    cv.statut,
                    cv.montant_total,
                    cv.notes,
                    fv.id_facture,
                    fv.numero_facture,
                    fv.statut AS statut_facture
                 FROM commandes_vente cv
                 LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                 WHERE cv.numero_commande = ?
                   AND cv.id_utilisateur = ?`,      // ✅ ISOLATION
                [numero_commande.trim(), id_utilisateur]
            );

            if (commandeRows.length === 0) {
                return null;
            }

            const commande = commandeRows[0];

            if (!['livree', 'expediee'].includes(commande.statut)) {
                throw new Error(
                    `Cette commande ne peut pas faire l'objet d'un retour. ` +
                    `Statut actuel : ${commande.statut}. ` +
                    `Seules les commandes livrées ou expédiées sont éligibles.`
                );
            }

            // Récupérer les lignes
            const [lignes] = await pool.execute(
                `SELECT
                    lcv.id_ligne_vente,
                    lcv.id_produit,
                    lcv.quantite,
                    lcv.prix_vente,
                    lcv.remise,
                    lcv.montant_total,
                    p.nom AS produit_nom,
                    p.id_marque,
                    m.nom AS marque_nom,
                    p.id_modele,
                    md.nom AS modele_nom,
                    p.id_unite,
                    u.symbole AS unite_symbole
                 FROM ligne_commande_vente lcv
                 LEFT JOIN produits p ON lcv.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN modeles md ON p.id_modele = md.id_modele
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 WHERE lcv.id_commande = ?
                 ORDER BY lcv.id_ligne_vente ASC`,
                [commande.id_commande]
            );

            // Calculer les quantités déjà retournées
            for (const ligne of lignes) {
                const [retoursExistants] = await pool.execute(
                    `SELECT COALESCE(SUM(rcl.quantite), 0) AS total_retourne
                     FROM retour_client_lignes rcl
                     INNER JOIN retours_clients rc ON rcl.id_retour_client = rc.id_retour_client
                     WHERE rcl.id_ligne_commande_vente = ?
                       AND rc.statut != 'annule'
                       AND rc.id_utilisateur = ?`,   // ✅ ISOLATION
                    [ligne.id_ligne_vente, id_utilisateur]
                );

                const dejaRetourne = parseFloat(retoursExistants[0].total_retourne) || 0;
                const quantiteAchetee = parseFloat(ligne.quantite) || 0;

                ligne.quantite_deja_retournee = dejaRetourne;
                ligne.quantite_max_retournable = Math.max(0, quantiteAchetee - dejaRetourne);
                ligne.peut_etre_retournee = ligne.quantite_max_retournable > 0;
            }

            commande.lignes = lignes;
            return commande;

        } catch (error) {
            console.error('❌ Error searching commande by numero:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Générer un numéro de retour client unique PAR WORKSPACE
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
            `SELECT COUNT(*) as count FROM retours_clients
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `RC-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * Créer un nouveau retour client
     * ============================================================
     */
    static async create(data) {
        const {
            id_commande_vente,
            id_facture,
            date_retour,
            email,
            adresse,
            motif_retour,
            notes,
            id_utilisateur,
            lignes = []
        } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // ============================================================
            // VALIDATION 1 : Commande obligatoire
            // ============================================================
            if (!id_commande_vente) {
                throw new Error('Une commande est obligatoire pour créer un retour');
            }

            // ============================================================
            // VALIDATION 2 : Vérifier la commande DANS le workspace
            // ============================================================
            const [commandeRows] = await connection.execute(
                `SELECT id_commande, statut, nomclient, telephone
                 FROM commandes_vente
                 WHERE id_commande = ? AND id_utilisateur = ?`,
                [id_commande_vente, id_utilisateur]
            );

            if (commandeRows.length === 0) {
                throw new Error('Commande non trouvée');
            }

            const commande = commandeRows[0];

            if (!['livree', 'expediee'].includes(commande.statut)) {
                throw new Error(
                    'Seules les commandes livrées ou expédiées peuvent faire l\'objet d\'un retour'
                );
            }

            const nomclientFinal = commande.nomclient;
            const telephoneFinal = commande.telephone;

            // ============================================================
            // VALIDATION 3 : Facture (si fournie)
            // ============================================================
            if (id_facture) {
                const [factureRows] = await connection.execute(
                    `SELECT id_facture FROM factures_vente
                     WHERE id_facture = ? AND id_utilisateur = ?`,
                    [id_facture, id_utilisateur]
                );
                if (factureRows.length === 0) {
                    throw new Error('Facture non trouvée');
                }
            }

            // ============================================================
            // VALIDATION 4 : Au moins une ligne
            // ============================================================
            if (!lignes || lignes.length === 0) {
                throw new Error('Au moins un produit doit être retourné');
            }

            // ============================================================
            // VALIDATION 5 : Vérifier chaque ligne
            // ============================================================
            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_ligne_commande_vente,
                    quantite
                } = ligne;

                if (!id_ligne_commande_vente) {
                    throw new Error(
                        'Chaque ligne doit référencer une ligne de commande'
                    );
                }

                const [ligneCommandeRows] = await connection.execute(
                    `SELECT id_ligne_vente, id_produit, quantite, prix_vente
                     FROM ligne_commande_vente
                     WHERE id_ligne_vente = ? AND id_commande = ?`,
                    [id_ligne_commande_vente, id_commande_vente]
                );

                if (ligneCommandeRows.length === 0) {
                    throw new Error(
                        `Ligne de commande ${id_ligne_commande_vente} invalide`
                    );
                }

                const ligneCommande = ligneCommandeRows[0];

                if (parseInt(id_produit) !== parseInt(ligneCommande.id_produit)) {
                    throw new Error('Le produit ne correspond pas à la ligne de commande');
                }

                if (!quantite || parseFloat(quantite) <= 0) {
                    throw new Error('La quantité doit être positive');
                }

                // ✅ Vérifier quantité max retournable DANS le workspace
                const [retoursExistants] = await connection.execute(
                    `SELECT COALESCE(SUM(rcl.quantite), 0) AS total_retourne
                     FROM retour_client_lignes rcl
                     INNER JOIN retours_clients rc ON rcl.id_retour_client = rc.id_retour_client
                     WHERE rcl.id_ligne_commande_vente = ?
                       AND rc.statut != 'annule'
                       AND rc.id_utilisateur = ?`,
                    [id_ligne_commande_vente, id_utilisateur]
                );

                const dejaRetourne = parseFloat(retoursExistants[0].total_retourne) || 0;
                const quantiteAchetee = parseFloat(ligneCommande.quantite) || 0;
                const quantiteMax = quantiteAchetee - dejaRetourne;

                if (parseFloat(quantite) > quantiteMax) {
                    throw new Error(
                        `Quantité trop élevée. Maximum retournable : ${quantiteMax} ` +
                        `(acheté: ${quantiteAchetee}, déjà retourné: ${dejaRetourne})`
                    );
                }
            }

            // ============================================================
            // GÉNÉRATION DU NUMÉRO
            // ============================================================
            const numero_retour = await this.genererNumero(id_utilisateur);

            // ============================================================
            // INSERTION DE L'EN-TÊTE
            // ============================================================
            const [result] = await connection.execute(
                `INSERT INTO retours_clients (
                    id_utilisateur, numero_retour, date_retour,
                    id_commande_vente, id_facture,
                    nomclient, telephone, email, adresse,
                    motif_retour, statut, montant_total, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur,
                    numero_retour,
                    date_retour,
                    id_commande_vente,
                    id_facture || null,
                    nomclientFinal,
                    telephoneFinal,
                    email || null,
                    adresse || null,
                    motif_retour,
                    notes || null
                ]
            );

            const id_retour_client = result.insertId;

            // ============================================================
            // INSERTION DES LIGNES + MISE À JOUR STOCK
            // ============================================================
            let montant_total = 0;

            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_ligne_commande_vente,
                    quantite,
                    remise = 0,
                    motif_retour: ligneMotif,
                    etat_produit = 'neuf',
                    notes_ligne
                } = ligne;

                // Prix sécurisé depuis la ligne de commande
                const [ligneCommandeRows] = await connection.execute(
                    'SELECT prix_vente FROM ligne_commande_vente WHERE id_ligne_vente = ?',
                    [id_ligne_commande_vente]
                );
                const prixVenteSecurise = parseFloat(ligneCommandeRows[0].prix_vente);

                // Stock actuel (workspace)
                const [produitRows] = await connection.execute(
                    `SELECT quantite_stock FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [id_produit, id_utilisateur]
                );
                const stockActuel = parseFloat(produitRows[0]?.quantite_stock) || 0;

                // Insérer la ligne
                await connection.execute(
                    `INSERT INTO retour_client_lignes (
                        id_retour_client, id_produit, id_ligne_commande_vente,
                        quantite, prix_vente, remise,
                        motif_retour, etat_produit, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id_retour_client,
                        id_produit,
                        id_ligne_commande_vente,
                        quantite,
                        prixVenteSecurise,
                        remise,
                        ligneMotif || motif_retour,
                        etat_produit,
                        notes_ligne || null
                    ]
                );

                // Calculer montant
                const montant_ligne = quantite * prixVenteSecurise * (1 - remise / 100);
                montant_total += montant_ligne;

                // ✅ Mise à jour stock (workspace)
                await connection.execute(
                    `UPDATE produits SET quantite_stock = quantite_stock + ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [quantite, id_produit, id_utilisateur]
                );

                // Statut produit
                const nouveauStock = stockActuel + parseFloat(quantite);
                const nouveauStatut = nouveauStock <= 0 ? 'rupture' : 'disponible';
                await connection.execute(
                    `UPDATE produits SET statut = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [nouveauStatut, id_produit, id_utilisateur]
                );

                // Entrée stock (workspace)
                await connection.execute(
                    `INSERT INTO entrees_stock (
                        id_utilisateur, reference, id_produit, quantite,
                        num_lot, notes
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        id_utilisateur,
                        `ENTREE-RC-${numero_retour}-${id_produit}`,
                        id_produit,
                        quantite,
                        `RETOUR_CLIENT_${numero_retour}`,
                        `Retour client - ${ligneMotif || motif_retour}`
                    ]
                );

                // ✅ Mouvement centralisé
                await MouvementStock.enregistrer({
                    id_produit,
                    type_mouvement: 'entree',
                    quantite,
                    id_reference: id_retour_client,
                    type_reference: 'retour_client',
                    notes: `Retour client ${numero_retour} - ${ligneMotif || motif_retour}`
                }, connection, id_utilisateur);
            }

            // ============================================================
            // MISE À JOUR DU MONTANT TOTAL
            // ============================================================
            await connection.execute(
                `UPDATE retours_clients SET montant_total = ?
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,
                [montant_total, id_retour_client, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(id_retour_client, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Récupérer un retour client par ID
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT rc.*,
                        cv.numero_commande,
                        fv.numero_facture,
                        u.fullname as utilisateur_nom
                 FROM retours_clients rc
                 LEFT JOIN commandes_vente cv ON rc.id_commande_vente = cv.id_commande
                 LEFT JOIN factures_vente fv ON rc.id_facture = fv.id_facture
                 LEFT JOIN utilisateurs u ON rc.id_utilisateur = u.id_utilisateur
                 WHERE rc.id_retour_client = ?
                   AND rc.id_utilisateur = ?`,       // ✅ ISOLATION
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const retour = rows[0];

            const [lignes] = await pool.execute(
                `SELECT rcl.*,
                        p.nom as produit_nom,
                        p.id_marque,
                        m.nom as marque_nom,
                        p.id_modele,
                        md.nom as modele_nom,
                        p.id_unite,
                        u.symbole as unite_symbole
                 FROM retour_client_lignes rcl
                 LEFT JOIN produits p ON rcl.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN modeles md ON p.id_modele = md.id_modele
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 WHERE rcl.id_retour_client = ?`,
                [id]
            );

            retour.lignes = lignes;
            return retour;

        } catch (error) {
            console.error('❌ Error finding retour client by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer tous les retours clients (par workspace)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT rc.*,
                       cv.numero_commande,
                       fv.numero_facture,
                       u.fullname as utilisateur_nom
                FROM retours_clients rc
                LEFT JOIN commandes_vente cv ON rc.id_commande_vente = cv.id_commande
                LEFT JOIN factures_vente fv ON rc.id_facture = fv.id_facture
                LEFT JOIN utilisateurs u ON rc.id_utilisateur = u.id_utilisateur
                WHERE rc.id_utilisateur = ?              -- ✅ ISOLATION
            `;
            const params = [id_utilisateur];

            if (filters.search) {
                query += ` AND (rc.numero_retour LIKE ?
                            OR rc.nomclient LIKE ?
                            OR rc.telephone LIKE ?
                            OR rc.email LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s, s);
            }
            if (filters.statut) {
                query += ' AND rc.statut = ?';
                params.push(filters.statut);
            }
            if (filters.motif_retour) {
                query += ' AND rc.motif_retour = ?';
                params.push(filters.motif_retour);
            }
            if (filters.date_debut) {
                query += ' AND rc.date_retour >= ?';
                params.push(filters.date_debut);
            }
            if (filters.date_fin) {
                query += ' AND rc.date_retour <= ?';
                params.push(filters.date_fin);
            }
            if (filters.id_commande_vente) {
                query += ' AND rc.id_commande_vente = ?';
                params.push(filters.id_commande_vente);
            }

            query += ' ORDER BY rc.date_retour DESC, rc.id_retour_client DESC';

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
            console.error('❌ Error finding retours clients:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'un retour
     * ============================================================
     */
    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatut');
        }

        try {
            const statutsValides = ['en_attente', 'recu', 'controle', 'accepte', 'refuse', 'rembourse', 'echange', 'annule'];
            if (!statutsValides.includes(statut)) {
                throw new Error('Statut invalide');
            }

            const dateTraitement = ['accepte', 'refuse', 'rembourse', 'echange'].includes(statut)
                ? new Date()
                : null;

            const [result] = await pool.execute(
                `UPDATE retours_clients SET statut = ?, date_traitement = ?
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,   // ✅ ISOLATION
                [statut, dateTraitement, id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating statut:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Statistiques des retours clients (par workspace)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as en_attente,
                    SUM(CASE WHEN statut = 'recu'       THEN 1 ELSE 0 END) as recu,
                    SUM(CASE WHEN statut = 'controle'   THEN 1 ELSE 0 END) as controle,
                    SUM(CASE WHEN statut = 'accepte'    THEN 1 ELSE 0 END) as accepte,
                    SUM(CASE WHEN statut = 'refuse'     THEN 1 ELSE 0 END) as refuse,
                    SUM(CASE WHEN statut = 'rembourse'  THEN 1 ELSE 0 END) as rembourse,
                    SUM(CASE WHEN statut = 'echange'    THEN 1 ELSE 0 END) as echange,
                    SUM(CASE WHEN statut = 'annule'     THEN 1 ELSE 0 END) as annule,
                    COALESCE(SUM(montant_total), 0) as total_montant,
                    COALESCE(AVG(montant_total), 0) as moyenne_montant
                 FROM retours_clients
                 WHERE id_utilisateur = ?`,             // ✅ ISOLATION
                [id_utilisateur]
            );

            const stats = rows[0];
            return {
                total: parseInt(stats.total) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                recu: parseInt(stats.recu) || 0,
                controle: parseInt(stats.controle) || 0,
                accepte: parseInt(stats.accepte) || 0,
                refuse: parseInt(stats.refuse) || 0,
                rembourse: parseInt(stats.rembourse) || 0,
                echange: parseInt(stats.echange) || 0,
                annule: parseInt(stats.annule) || 0,
                total_montant: parseFloat(stats.total_montant) || 0,
                moyenne_montant: parseFloat(stats.moyenne_montant) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Supprimer un retour client (avec remise en stock inverse)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // ✅ Vérifier statut DANS le workspace
            const [rows] = await connection.execute(
                `SELECT statut FROM retours_clients
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Retour client non trouvé');
            }
            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer un retour ${rows[0].statut}`);
            }

            // Récupérer les lignes
            const [lignes] = await connection.execute(
                `SELECT id_produit, quantite FROM retour_client_lignes
                 WHERE id_retour_client = ?`,
                [id]
            );

            // ✅ Retirer du stock (workspace)
            for (const ligne of lignes) {
                const [produitRows] = await connection.execute(
                    `SELECT quantite_stock FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [ligne.id_produit, id_utilisateur]
                );

                const stockActuel = parseFloat(produitRows[0]?.quantite_stock) || 0;
                const nouveauStock = Math.max(0, stockActuel - parseFloat(ligne.quantite));

                await connection.execute(
                    `UPDATE produits SET quantite_stock = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [nouveauStock, ligne.id_produit, id_utilisateur]
                );

                // ✅ Mouvement inverse centralisé
                await MouvementStock.enregistrer({
                    id_produit: ligne.id_produit,
                    type_mouvement: 'sortie',
                    quantite: ligne.quantite,
                    id_reference: id,
                    type_reference: 'annulation_retour_client',
                    notes: `Annulation retour client #${id}`
                }, connection, id_utilisateur);
            }

            const [result] = await connection.execute(
                `DELETE FROM retours_clients
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            await connection.commit();
            return result.affectedRows > 0;

        } catch (error) {
            await connection.rollback();
            console.error('❌ Error deleting retour client:', error);
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default RetourClient;