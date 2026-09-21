// models/Reception.js
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';

class Reception {
    /**
     * ============================================================
     * Générer un numéro de réception unique PAR WORKSPACE
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
            `SELECT COUNT(*) as count FROM receptions
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `REC-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

/**
 * ============================================================
 * ✅ Créer une nouvelle réception
 *    - ACCEPTE les réceptions partielles (écart > 0)
 *    - ACCEPTE les surplus (écart < 0)
 *    - ⚠️ Recalcule côté serveur les quantités déjà reçues
 *    - Met à jour le stock avec quantite_recue RÉELLE
 *    - Recalcule le statut de la commande
 * ============================================================
 */
static async create(data) {
    const {
        id_commande_achat = null,
        date_reception,
        notes = null,
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
        // 1. VALIDATIONS DE BASE
        // ============================================================
        if (!date_reception) {
            throw new Error('La date de réception est obligatoire');
        }
        if (!Array.isArray(lignes) || lignes.length === 0) {
            throw new Error('Au moins un produit est requis pour une réception');
        }

        // ============================================================
        // 2. VÉRIFICATION DE LA COMMANDE
        // ============================================================
        if (id_commande_achat) {
            const [commandeCheck] = await connection.execute(
                `SELECT ca.*, f.nom AS fournisseur_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE ca.id_commande_achat = ?
                   AND ca.id_utilisateur = ?`,
                [id_commande_achat, id_utilisateur]
            );

            if (commandeCheck.length === 0) {
                throw new Error('Commande d\'achat non trouvée');
            }

            const commande = commandeCheck[0];

            if (commande.statut === 'recue') {
                throw new Error(`La commande ${commande.numero_commande} a déjà été entièrement reçue`);
            }
            if (commande.statut === 'annulee') {
                throw new Error(`La commande ${commande.numero_commande} est annulée`);
            }
        }

        // ============================================================
        // 3. VÉRIFICATION DES LIGNES + CALCUL SERVEUR
        //    ⚠️ On ne fait plus confiance à quantite_commandee envoyé par le front :
        //    on recalcule le reste à recevoir en interrogeant la base.
        // ============================================================
        const lignesCalculees = [];

        for (const ligne of lignes) {
            const {
                id_produit,
                id_ligne_achat = null,
                id_unite_vente = null,
                nom_unite_vente = 'Unité',
                quantite_base = 1,
                quantite_recue,
                quantite_totale_base = null,
                prix_achat_unite_vente = null,
                prix_achat_base = null,
                etat_marchandise = 'bon',
                num_lot = null,
                date_peremption = null,
                notes_ligne = null
            } = ligne;

            // --- Vérifier le produit ---
            const [produitRows] = await connection.execute(
                `SELECT id_produit, nom, prix_achat, prix_vente, quantite_stock
                 FROM produits
                 WHERE id_produit = ? AND id_utilisateur = ?`,
                [id_produit, id_utilisateur]
            );

            if (produitRows.length === 0) {
                throw new Error(`Produit ID ${id_produit} non trouvé`);
            }

            if (!quantite_recue || parseFloat(quantite_recue) <= 0) {
                throw new Error(`La quantité reçue pour ${produitRows[0].nom} doit être positive`);
            }

            // --- Déterminer quantite_base ---
            let qteBase = parseFloat(quantite_base) || 1;
            if (id_unite_vente) {
                const [uvRows] = await connection.execute(
                    `SELECT quantite_base FROM unites_vente
                     WHERE id_unite_vente = ? AND id_produit = ?`,
                    [id_unite_vente, id_produit]
                );
                if (uvRows.length > 0) {
                    qteBase = parseFloat(uvRows[0].quantite_base) || 1;
                }
            }

            // --- Quantité totale reçue (unité de base) ---
            const qteTotaleBase = quantite_totale_base !== null
                ? parseFloat(quantite_totale_base)
                : parseFloat(quantite_recue) * qteBase;

            // ============================================================
            // ✅ RECALCUL CÔTÉ SERVEUR : reste à recevoir AVANT cette réception
            // ============================================================
            let quantiteCommandeeUV = 0;      // en unité de vente
            let quantiteCommandeeBase = 0;    // en unité de base
            let dejaRecueBase = 0;
            let resteAvantBase = 0;
            let ecart = 0;

            if (id_ligne_achat) {
                const [ligneCmd] = await connection.execute(
                    `SELECT quantite, quantite_base, quantite_totale_base
                     FROM ligne_commande_achat
                     WHERE id_ligne_achat = ?
                       AND id_commande_achat = ?`,
                    [id_ligne_achat, id_commande_achat]
                );

                if (ligneCmd.length === 0) {
                    throw new Error(`Ligne de commande ID ${id_ligne_achat} non trouvée`);
                }

                const qteBaseLigne = parseFloat(ligneCmd[0].quantite_base) || qteBase;
                quantiteCommandeeUV = parseFloat(ligneCmd[0].quantite) || 0;
                quantiteCommandeeBase = parseFloat(ligneCmd[0].quantite_totale_base)
                    || (quantiteCommandeeUV * qteBaseLigne);

                // Total déjà reçu (hors annulées)
                const [recuRows] = await connection.execute(
                    `SELECT COALESCE(SUM(rl.quantite_totale_base), 0) AS total
                     FROM reception_lignes rl
                     INNER JOIN receptions r ON rl.id_reception = r.id_reception
                     WHERE rl.id_ligne_achat = ?
                       AND r.statut != 'annulee'
                       AND r.id_utilisateur = ?`,
                    [id_ligne_achat, id_utilisateur]
                );

                dejaRecueBase = parseFloat(recuRows[0].total) || 0;
                resteAvantBase = Math.max(0, quantiteCommandeeBase - dejaRecueBase);

                // ✅ Écart = reste AVANT - reçu MAINTENANT
                //    >0 → manquant, <0 → surplus, 0 → conforme
                ecart = (resteAvantBase - qteTotaleBase) / (qteBase || 1);

                // On retranscrit quantite_commandee en unité de vente (le RESTE)
                quantiteCommandeeUV = qteBase > 0 ? resteAvantBase / qteBase : 0;
            } else {
                // Réception libre (sans commande) : pas de comparaison
                quantiteCommandeeUV = parseFloat(quantite_recue) || 0;
                quantiteCommandeeBase = qteTotaleBase;
                dejaRecueBase = 0;
                resteAvantBase = qteTotaleBase;
                ecart = 0;
            }

            // ============================================================
            // ✅ SURPLUS : log seulement
            // ============================================================
            if (ecart < 0) {
                console.log(
                    `⚠️ Surplus détecté pour "${produitRows[0].nom}" : ` +
                    `reste avant = ${resteAvantBase} base, ` +
                    `reçu = ${qteTotaleBase} base`
                );
            }

            // --- Prix d'achat unité de vente ---
            let prixAchatUV = null;
            if (
                prix_achat_unite_vente !== null &&
                prix_achat_unite_vente !== undefined &&
                prix_achat_unite_vente !== ''
            ) {
                const parsed = parseFloat(prix_achat_unite_vente);
                if (!isNaN(parsed) && parsed > 0) {
                    prixAchatUV = parsed;
                }
            }

            // --- Prix d'achat unité de base (auto-calcul si absent) ---
            let prixAchatBase = null;
            if (
                prix_achat_base !== null &&
                prix_achat_base !== undefined &&
                prix_achat_base !== ''
            ) {
                const parsed = parseFloat(prix_achat_base);
                if (!isNaN(parsed) && parsed > 0) {
                    prixAchatBase = parsed;
                }
            } else if (prixAchatUV !== null && qteBase > 0) {
                // ✅ Déduire automatiquement le prix base
                prixAchatBase = prixAchatUV / qteBase;
            }

            lignesCalculees.push({
                id_produit,
                id_ligne_achat,
                id_unite_vente,
                nom_unite_vente,
                quantite_base: qteBase,
                quantite_commandee: quantiteCommandeeUV,     // reste avant
                quantite_recue: parseFloat(quantite_recue),
                quantite_totale_base: qteTotaleBase,
                ecart: ecart,                                 // en unité de vente
                prix_achat_unite_vente: prixAchatUV,
                prix_achat_base: prixAchatBase,
                etat_marchandise,
                num_lot,
                date_peremption,
                notes_ligne
            });
        }

        // ============================================================
        // 4. GÉNÉRATION DU NUMÉRO
        // ============================================================
        const numero_reception = await this.genererNumero(id_utilisateur);

        // ============================================================
        // 5. CRÉATION DE L'EN-TÊTE
        // ============================================================
        const [result] = await connection.execute(
            `INSERT INTO receptions (
                id_utilisateur, numero_reception, date_reception,
                id_commande_achat, statut, montant_total, notes
            ) VALUES (?, ?, ?, ?, 'en_attente', 0.00, ?)`,
            [
                id_utilisateur,
                numero_reception,
                date_reception,
                id_commande_achat,
                notes
            ]
        );

        const id_reception = result.insertId;

        // ============================================================
        // 6. TRAITEMENT DES LIGNES
        // ============================================================
        let montant_total = 0;
        let statut_reception = 'complete';

        for (const lc of lignesCalculees) {
            // ✅ Si écart > 0 (manquant) → réception partielle
            if (lc.ecart > 0 && statut_reception === 'complete') {
                statut_reception = 'partielle';
            }
            // Surplus (écart < 0) → reste 'complete'

            // Montant ligne
            const montantLigne = lc.prix_achat_unite_vente
                ? lc.quantite_recue * lc.prix_achat_unite_vente
                : null;
            if (montantLigne !== null) {
                montant_total += montantLigne;
            }

            // --- Insérer la ligne de réception ---
            await connection.execute(
                `INSERT INTO reception_lignes (
                    id_reception, id_produit, id_ligne_achat,
                    id_unite_vente, nom_unite_vente, quantite_base, quantite_totale_base,
                    quantite_commandee, quantite_recue, ecart,
                    prix_achat_unite_vente, prix_achat_base, montant_total,
                    etat_marchandise, num_lot, date_peremption, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id_reception,
                    lc.id_produit,
                    lc.id_ligne_achat,
                    lc.id_unite_vente,
                    lc.nom_unite_vente,
                    lc.quantite_base,
                    lc.quantite_totale_base,
                    lc.quantite_commandee,
                    lc.quantite_recue,
                    lc.ecart,
                    lc.prix_achat_unite_vente,
                    lc.prix_achat_base,
                    montantLigne,
                    lc.etat_marchandise,
                    lc.num_lot,
                    lc.date_peremption,
                    lc.notes_ligne
                ]
            );

            // ============================================================
            // ✅ SEUL ENDROIT QUI MODIFIE LE STOCK
            // ============================================================
            const [stockRows] = await connection.execute(
                `SELECT quantite_stock FROM produits
                 WHERE id_produit = ? AND id_utilisateur = ?`,
                [lc.id_produit, id_utilisateur]
            );
            const ancienne_qte = parseFloat(stockRows[0]?.quantite_stock) || 0;
            const nouvelle_qte = ancienne_qte + lc.quantite_totale_base;

            await connection.execute(
                `UPDATE produits SET quantite_stock = ?
                 WHERE id_produit = ? AND id_utilisateur = ?`,
                [nouvelle_qte, lc.id_produit, id_utilisateur]
            );

            const nouveauStatut = nouvelle_qte <= 0 ? 'rupture' : 'disponible';
            await connection.execute(
                `UPDATE produits SET statut = ?
                 WHERE id_produit = ? AND id_utilisateur = ?`,
                [nouveauStatut, lc.id_produit, id_utilisateur]
            );

            // ============================================================
            // MISE À JOUR DES PRIX D'ACHAT
            // ============================================================
            if (lc.prix_achat_unite_vente && lc.prix_achat_unite_vente > 0) {
                if (lc.id_unite_vente) {
                    await connection.execute(
                        `UPDATE unites_vente SET prix_achat = ?
                         WHERE id_unite_vente = ?`,
                        [lc.prix_achat_unite_vente, lc.id_unite_vente]
                    );
                }

                if (lc.prix_achat_base && lc.prix_achat_base > 0) {
                    await connection.execute(
                        `UPDATE produits SET prix_achat = ?
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [lc.prix_achat_base, lc.id_produit, id_utilisateur]
                    );
                }

                if (lc.id_ligne_achat) {
                    await connection.execute(
                        `UPDATE ligne_commande_achat SET prix_achat = ?
                         WHERE id_ligne_achat = ?
                           AND (prix_achat IS NULL OR prix_achat = 0)`,
                        [lc.prix_achat_unite_vente, lc.id_ligne_achat]
                    );
                }
            }

            // --- Entrée stock (traçabilité) ---
            const ref_entree = `ENT-${Date.now()}-${lc.id_produit}-${Math.random().toString(36).slice(2, 7)}`;
            await connection.execute(
                `INSERT INTO entrees_stock (
                    id_utilisateur, reference, id_produit, id_reception,
                    id_unite_vente, nom_unite_vente, quantite_base,
                    quantite, quantite_totale_base,
                    num_lot, date_peremption, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id_utilisateur,
                    ref_entree,
                    lc.id_produit,
                    id_reception,
                    lc.id_unite_vente,
                    lc.nom_unite_vente,
                    lc.quantite_base,
                    lc.quantite_recue,
                    lc.quantite_totale_base,
                    lc.num_lot,
                    lc.date_peremption,
                    lc.notes_ligne || 'Entrée par réception'
                ]
            );

            // --- Mouvement de stock (traçabilité) ---
            await MouvementStock.enregistrer({
                id_produit: lc.id_produit,
                type_mouvement: 'entree',
                quantite: lc.quantite_totale_base,
                id_reference: id_reception,
                type_reference: 'reception',
                notes: `Réception ${numero_reception} - ${lc.quantite_recue} ${lc.nom_unite_vente}`
            }, connection, id_utilisateur);
        }

        // ============================================================
        // 7. MISE À JOUR EN-TÊTE RÉCEPTION
        // ============================================================
        await connection.execute(
            `UPDATE receptions
             SET statut = ?, montant_total = ?
             WHERE id_reception = ? AND id_utilisateur = ?`,
            [statut_reception, montant_total, id_reception, id_utilisateur]
        );

        // ============================================================
        // 8. MISE À JOUR COMMANDE D'ACHAT
        //    ✅ Calcul fiable : on compare ligne par ligne
        // ============================================================
        if (id_commande_achat) {
            const [commandeLignes] = await connection.execute(
                `SELECT id_ligne_achat, quantite_totale_base
                 FROM ligne_commande_achat
                 WHERE id_commande_achat = ?`,
                [id_commande_achat]
            );

            let toutesRecues = true;
            for (const cl of commandeLignes) {
                const qteCommandeeBase = parseFloat(cl.quantite_totale_base) || 0;

                // ✅ Si la ligne commande est à 0, on la considère non reçue
                if (qteCommandeeBase <= 0) {
                    toutesRecues = false;
                    break;
                }

                const [recu] = await connection.execute(
                    `SELECT COALESCE(SUM(rl.quantite_totale_base), 0) AS total_recu
                     FROM reception_lignes rl
                     INNER JOIN receptions r ON rl.id_reception = r.id_reception
                     WHERE rl.id_ligne_achat = ?
                       AND r.statut != 'annulee'`,
                    [cl.id_ligne_achat]
                );

                const totalRecu = parseFloat(recu[0].total_recu) || 0;
                if (totalRecu < qteCommandeeBase) {
                    toutesRecues = false;
                    break;
                }
            }

            const nouveauStatut = toutesRecues ? 'recue' : 'partiellement_recue';

            // Recalcul du montant_total = somme des montants réellement reçus
            const [tot] = await connection.execute(
                `SELECT COALESCE(SUM(rl.montant_total), 0) AS total
                 FROM reception_lignes rl
                 INNER JOIN receptions r ON rl.id_reception = r.id_reception
                 WHERE r.id_commande_achat = ?
                   AND r.statut != 'annulee'`,
                [id_commande_achat]
            );
            const nouveauMontant = parseFloat(tot[0].total) || 0;

            await connection.execute(
                `UPDATE commandes_achat SET statut = ?, montant_total = ?
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [nouveauStatut, nouveauMontant, id_commande_achat, id_utilisateur]
            );
        }

        await connection.commit();
        return await this.findById(id_reception, id_utilisateur);

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

    /**
     * ============================================================
     * Récupérer une réception par ID
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*,
                        ca.numero_commande,
                        f.nom AS fournisseur_nom,
                        f.telephone AS fournisseur_telephone,
                        u.fullname AS utilisateur_nom
                 FROM receptions r
                 LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                 WHERE r.id_reception = ?
                   AND r.id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const reception = rows[0];

            const [lignes] = await pool.execute(
                `SELECT rl.*,
                        p.nom AS produit_nom,
                        p.id_marque,
                        m.nom AS marque_nom,
                        p.id_unite,
                        u.symbole AS unite_symbole,
                        uv.nom AS unite_vente_nom,
                        uv.quantite_base AS unite_vente_quantite_base
                 FROM reception_lignes rl
                 LEFT JOIN produits p ON rl.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 LEFT JOIN unites_vente uv ON rl.id_unite_vente = uv.id_unite_vente
                 WHERE rl.id_reception = ?`,
                [id]
            );

            reception.lignes = lignes.map(l => ({
                ...l,
                nom_unite_vente: l.nom_unite_vente || l.unite_vente_nom || 'Unité',
                quantite_base: parseFloat(l.quantite_base) || 1,
                quantite_totale_base: parseFloat(l.quantite_totale_base)
                    || (parseFloat(l.quantite_recue) * (parseFloat(l.quantite_base) || 1)),
                prix_achat_unite_vente: l.prix_achat_unite_vente !== null
                    ? parseFloat(l.prix_achat_unite_vente)
                    : null,
                prix_achat_base: l.prix_achat_base !== null
                    ? parseFloat(l.prix_achat_base)
                    : null,
                montant_total: l.montant_total !== null
                    ? parseFloat(l.montant_total)
                    : null
            }));

            return reception;

        } catch (error) {
            console.error('❌ Error finding reception by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer toutes les réceptions
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT r.*,
                       ca.numero_commande,
                       f.nom AS fournisseur_nom,
                       u.fullname AS utilisateur_nom
                FROM receptions r
                LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                WHERE r.id_utilisateur = ?
            `;
            const params = [id_utilisateur];

            if (filters.numero_reception) {
                query += ' AND r.numero_reception LIKE ?';
                params.push(`%${filters.numero_reception}%`);
            }
            if (filters.id_commande_achat) {
                query += ' AND r.id_commande_achat = ?';
                params.push(filters.id_commande_achat);
            }
            if (filters.statut) {
                query += ' AND r.statut = ?';
                params.push(filters.statut);
            }
            if (filters.date_debut) {
                query += ' AND r.date_reception >= ?';
                params.push(filters.date_debut);
            }
            if (filters.date_fin) {
                query += ' AND r.date_reception <= ?';
                params.push(filters.date_fin);
            }
            if (filters.search) {
                query += ` AND (r.numero_reception LIKE ?
                            OR f.nom LIKE ?
                            OR ca.numero_commande LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s);
            }

            query += ' ORDER BY r.date_reception DESC, r.id_reception DESC';

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
            console.error('❌ Error finding receptions:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les réceptions d'une commande
     * ============================================================
     */
    static async findByCommande(id_commande_achat, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCommande');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*, u.fullname AS utilisateur_nom
                 FROM receptions r
                 LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                 WHERE r.id_commande_achat = ?
                   AND r.id_utilisateur = ?
                 ORDER BY r.date_reception DESC`,
                [id_commande_achat, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by commande:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les réceptions par statut
     * ============================================================
     */
    static async findByStatut(statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*, f.nom AS fournisseur_nom
                 FROM receptions r
                 LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE r.statut = ?
                   AND r.id_utilisateur = ?
                 ORDER BY r.date_reception DESC`,
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
     * Mettre à jour le statut
     * ============================================================
     */
    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatut');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE receptions SET statut = ?
                 WHERE id_reception = ? AND id_utilisateur = ?`,
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
     * Supprimer une réception (seulement si 'en_attente')
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT statut FROM receptions
                 WHERE id_reception = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Réception non trouvée');
            }
            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer une réception ${rows[0].statut}`);
            }

            const [result] = await pool.execute(
                `DELETE FROM receptions
                 WHERE id_reception = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            return result.affectedRows > 0;

        } catch (error) {
            console.error('❌ Error deleting reception:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Statistiques des réceptions
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) AS en_attente,
                    SUM(CASE WHEN statut = 'partielle'  THEN 1 ELSE 0 END) AS partielle,
                    SUM(CASE WHEN statut = 'complete'   THEN 1 ELSE 0 END) AS complete,
                    SUM(CASE WHEN statut = 'annulee'    THEN 1 ELSE 0 END) AS annulee,
                    COALESCE(SUM(montant_total), 0) AS total_montant,
                    COALESCE(AVG(montant_total), 0) AS moyenne_montant
                 FROM receptions
                 WHERE id_utilisateur = ?`,
                [id_utilisateur]
            );

            const stats = rows[0];
            return {
                total: parseInt(stats.total) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                partielle: parseInt(stats.partielle) || 0,
                complete: parseInt(stats.complete) || 0,
                annulee: parseInt(stats.annulee) || 0,
                total_montant: parseFloat(stats.total_montant) || 0,
                moyenne_montant: parseFloat(stats.moyenne_montant) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }
}

export default Reception; 