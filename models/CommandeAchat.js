// models/CommandeAchat.js
import { pool } from '../config/db.js';

class CommandeAchat {
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
             FROM commandes_achat
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `CA-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * ✅ Créer une nouvelle commande d'achat (NIVEAU 3)
     * ============================================================
     * Règles métier :
     *  - Le prix d'achat est OPTIONNEL (NULL par défaut)
     *  - Il sera renseigné plus tard, à la RÉCEPTION (facture fournisseur)
     *  - Le montant_total de la commande reste à 0 tant qu'aucun prix n'est connu
     *    → il sera recalculé automatiquement à la réception
     */
    static async create(data) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const {
                id_fournisseur,
                date_commande,
                notes,
                id_utilisateur,
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

            const numero_commande = await this.genererNumero(id_utilisateur);

            // ============================================================
            // 1. Créer l'en-tête (montant_total = 0)
            // ============================================================
            const [result] = await connection.execute(
                `INSERT INTO commandes_achat (
                    id_utilisateur, numero_commande, date_commande,
                    id_fournisseur, statut, montant_total, notes
                ) VALUES (?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur,
                    numero_commande,
                    date_commande,
                    id_fournisseur,
                    notes || null
                ]
            );

            const id_commande_achat = result.insertId;

            // ============================================================
            // 2. Ajouter les lignes (prix OPTIONNEL)
            // ============================================================
            let montant_total = 0;

            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_unite_vente = null,
                    nom_unite_vente = 'Unité',
                    quantite_base = 1,
                    quantite,
                    quantite_totale_base = null,
                    prix_achat = null,      // ✅ Optionnel : peut être null
                    remise = 0
                } = ligne;

                // --- Vérifier le produit (workspace) ---
                const [produitRows] = await connection.execute(
                    `SELECT id_produit FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [id_produit, id_utilisateur]
                );
                if (produitRows.length === 0) {
                    throw new Error(`Produit ID ${id_produit} non trouvé`);
                }

                if (!quantite || parseFloat(quantite) <= 0) {
                    throw new Error(`La quantité pour le produit ID ${id_produit} doit être positive`);
                }

                // --- Déterminer quantite_base ---
                let qteBase = parseFloat(quantite_base) || 1;
                if (id_unite_vente) {
                    const [uniteRows] = await connection.execute(
                        `SELECT quantite_base FROM unites_vente
                         WHERE id_unite_vente = ? AND id_produit = ?`,
                        [id_unite_vente, id_produit]
                    );
                    if (uniteRows.length > 0) {
                        qteBase = parseFloat(uniteRows[0].quantite_base) || 1;
                    }
                }

                // --- Quantité totale en unité de base ---
                const qteTotaleBase = quantite_totale_base !== null
                    ? parseFloat(quantite_totale_base)
                    : parseFloat(quantite) * qteBase;

                // --- ✅ Prix d'achat : null si non fourni ou <= 0 ---
                let prixAchatFinal = null;
                if (prix_achat !== null && prix_achat !== undefined && prix_achat !== '') {
                    const parsed = parseFloat(prix_achat);
                    if (!isNaN(parsed) && parsed > 0) {
                        prixAchatFinal = parsed;
                    }
                }

                // --- Insérer la ligne (prix nullable) ---
                await connection.execute(
                    `INSERT INTO ligne_commande_achat (
                        id_commande_achat, id_produit,
                        id_unite_vente, nom_unite_vente, quantite_base,
                        quantite, prix_achat, remise
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id_commande_achat,
                        id_produit,
                        id_unite_vente || null,
                        nom_unite_vente || 'Unité',
                        qteBase,
                        quantite,
                        prixAchatFinal,   // ✅ peut être null
                        remise
                    ]
                );

                // --- Calcul du montant ligne (0 si prix non connu) ---
                if (prixAchatFinal !== null) {
                    const montant_ligne = parseFloat(quantite)
                        * prixAchatFinal
                        * (1 - remise / 100);
                    montant_total += montant_ligne;
                }
            }

            // ============================================================
            // 3. Mettre à jour le montant total (0 si aucun prix connu)
            // ============================================================
            await connection.execute(
                `UPDATE commandes_achat
                 SET montant_total = ?
                 WHERE id_commande_achat = ?`,
                [montant_total, id_commande_achat]
            );

            await connection.commit();
            return await this.findById(id_commande_achat, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * ✅ Récupérer une commande par ID avec ses lignes
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            // En-tête
            const [rows] = await pool.execute(
                `SELECT ca.*,
                        f.nom as fournisseur_nom,
                        f.telephone as fournisseur_telephone,
                        f.email as fournisseur_email,
                        f.ville as fournisseur_ville,
                        f.pays as fournisseur_pays,
                        u.fullname as utilisateur_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur
                 WHERE ca.id_commande_achat = ?
                   AND ca.id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const commande = rows[0];

            // Lignes
            const [lignes] = await pool.execute(
                `SELECT lca.*,
                        p.nom as produit_nom,
                        p.id_marque,
                        m.nom as marque_nom,
                        p.id_modele,
                        md.nom as modele_nom,
                        p.id_unite,
                        u.symbole as unite_symbole,
                        uv.nom as unite_vente_nom,
                        uv.quantite_base as unite_vente_quantite_base
                 FROM ligne_commande_achat lca
                 LEFT JOIN produits p ON lca.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN modeles md ON p.id_modele = md.id_modele
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 LEFT JOIN unites_vente uv ON lca.id_unite_vente = uv.id_unite_vente
                 WHERE lca.id_commande_achat = ?`,
                [id]
            );

            // ✅ Enrichir (avec prix nullable)
            commande.lignes = lignes.map(l => ({
                ...l,
                nom_unite_vente: l.nom_unite_vente || l.unite_vente_nom || 'Unité',
                quantite_base: parseFloat(l.quantite_base) || 1,
                quantite_totale_base: parseFloat(l.quantite_totale_base)
                    || (parseFloat(l.quantite) * (parseFloat(l.quantite_base) || 1)),
                prix_achat: l.prix_achat !== null ? parseFloat(l.prix_achat) : null,
                montant_total: l.montant_total !== null ? parseFloat(l.montant_total) : null
            }));

            return commande;

        } catch (error) {
            console.error('❌ Error finding commande by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer toutes les commandes avec filtres
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT ca.*,
                       f.nom as fournisseur_nom,
                       u.fullname as utilisateur_nom,
                       (SELECT COUNT(*)
                        FROM ligne_commande_achat lca
                        WHERE lca.id_commande_achat = ca.id_commande_achat) AS nb_lignes
                FROM commandes_achat ca
                LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur
                WHERE ca.id_utilisateur = ?
            `;
            const params = [id_utilisateur];

            if (filters.numero_commande) {
                query += ' AND ca.numero_commande LIKE ?';
                params.push(`%${filters.numero_commande}%`);
            }
            if (filters.id_fournisseur) {
                query += ' AND ca.id_fournisseur = ?';
                params.push(filters.id_fournisseur);
            }
            if (filters.statut) {
                query += ' AND ca.statut = ?';
                params.push(filters.statut);
            }
            if (filters.date_debut) {
                query += ' AND ca.date_commande >= ?';
                params.push(filters.date_debut);
            }
            if (filters.date_fin) {
                query += ' AND ca.date_commande <= ?';
                params.push(filters.date_fin);
            }
            if (filters.montant_min) {
                query += ' AND ca.montant_total >= ?';
                params.push(filters.montant_min);
            }
            if (filters.montant_max) {
                query += ' AND ca.montant_total <= ?';
                params.push(filters.montant_max);
            }
            if (filters.search) {
                query += ` AND (ca.numero_commande LIKE ?
                            OR f.nom LIKE ?
                            OR ca.notes LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s);
            }

            query += ' ORDER BY ca.date_commande DESC, ca.id_commande_achat DESC';

            if (filters.limit !== undefined && filters.limit !== null) {
                const limit = parseInt(filters.limit);
                if (!isNaN(limit) && limit > 0) {
                    query += ` LIMIT ${Math.min(limit, 500)}`;
                }
            }
            if (filters.offset !== undefined && filters.offset !== null) {
                const offset = parseInt(filters.offset);
                if (!isNaN(offset) && offset >= 0) {
                    query += ` OFFSET ${offset}`;
                }
            }

            const [rows] = await pool.query(query, params);
            return rows;

        } catch (error) {
            console.error('❌ Error finding commandes:', error);
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
                `SELECT ca.*, f.nom as fournisseur_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE ca.statut = ?
                   AND ca.id_utilisateur = ?
                 ORDER BY ca.date_commande DESC`,
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
     * Récupérer les commandes d'un fournisseur
     * ============================================================
     */
    static async findByFournisseur(id_fournisseur, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByFournisseur');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT ca.*, u.fullname as utilisateur_nom
                 FROM commandes_achat ca
                 LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur
                 WHERE ca.id_fournisseur = ?
                   AND ca.id_utilisateur = ?
                 ORDER BY ca.date_commande DESC`,
                [id_fournisseur, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by fournisseur:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les commandes du mois en cours
     * ============================================================
     */
    static async getCurrentMonth(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getCurrentMonth');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT ca.*, f.nom as fournisseur_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE ca.id_utilisateur = ?
                   AND MONTH(ca.date_commande) = MONTH(CURRENT_DATE())
                   AND YEAR(ca.date_commande) = YEAR(CURRENT_DATE())
                 ORDER BY ca.date_commande DESC`,
                [id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error getting current month:', error);
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

        try {
            const [result] = await pool.execute(
                `UPDATE commandes_achat
                 SET statut = ?
                 WHERE id_commande_achat = ?
                   AND id_utilisateur = ?`,
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
     * ✅ Mettre à jour une commande complète (Niveau 3)
     * ============================================================
     */
    static async update(id, data, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { date_commande, id_fournisseur, notes, lignes } = data;

            const [commandeRows] = await connection.execute(
                `SELECT statut FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (commandeRows.length === 0) {
                throw new Error('Commande non trouvée');
            }

            const statutActuel = commandeRows[0].statut;
            if (['recue', 'annulee'].includes(statutActuel)) {
                throw new Error(`Impossible de modifier une commande ${statutActuel}`);
            }

            // Mise à jour en-tête
            if (date_commande || id_fournisseur || notes !== undefined) {
                const updates = [];
                const values = [];

                if (date_commande) {
                    updates.push('date_commande = ?');
                    values.push(date_commande);
                }
                if (id_fournisseur) {
                    updates.push('id_fournisseur = ?');
                    values.push(id_fournisseur);
                }
                if (notes !== undefined) {
                    updates.push('notes = ?');
                    values.push(notes || null);
                }

                if (updates.length > 0) {
                    values.push(id);
                    values.push(id_utilisateur);
                    await connection.execute(
                        `UPDATE commandes_achat
                         SET ${updates.join(', ')}
                         WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                        values
                    );
                }
            }

            // Remplacer les lignes
            if (lignes && lignes.length > 0) {
                await connection.execute(
                    'DELETE FROM ligne_commande_achat WHERE id_commande_achat = ?',
                    [id]
                );

                let montant_total = 0;
                for (const ligne of lignes) {
                    const {
                        id_produit,
                        id_unite_vente = null,
                        nom_unite_vente = 'Unité',
                        quantite_base = 1,
                        quantite,
                        quantite_totale_base = null,
                        prix_achat = null,
                        remise = 0
                    } = ligne;

                    const [produitRows] = await connection.execute(
                        `SELECT id_produit FROM produits
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [id_produit, id_utilisateur]
                    );
                    if (produitRows.length === 0) {
                        throw new Error(`Produit ID ${id_produit} non trouvé`);
                    }

                    if (!quantite || parseFloat(quantite) <= 0) {
                        throw new Error(`La quantité doit être positive`);
                    }

                    let qteBase = parseFloat(quantite_base) || 1;
                    if (id_unite_vente) {
                        const [uniteRows] = await connection.execute(
                            `SELECT quantite_base FROM unites_vente
                             WHERE id_unite_vente = ? AND id_produit = ?`,
                            [id_unite_vente, id_produit]
                        );
                        if (uniteRows.length > 0) {
                            qteBase = parseFloat(uniteRows[0].quantite_base) || 1;
                        }
                    }

                    const qteTotaleBase = quantite_totale_base !== null
                        ? parseFloat(quantite_totale_base)
                        : parseFloat(quantite) * qteBase;

                    // ✅ Prix nullable
                    let prixAchatFinal = null;
                    if (prix_achat !== null && prix_achat !== undefined && prix_achat !== '') {
                        const parsed = parseFloat(prix_achat);
                        if (!isNaN(parsed) && parsed > 0) {
                            prixAchatFinal = parsed;
                        }
                    }

                    await connection.execute(
                        `INSERT INTO ligne_commande_achat (
                            id_commande_achat, id_produit,
                            id_unite_vente, nom_unite_vente, quantite_base,
                            quantite, prix_achat, remise
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            id,
                            id_produit,
                            id_unite_vente || null,
                            nom_unite_vente || 'Unité',
                            qteBase,
                            quantite,
                            prixAchatFinal,
                            remise
                        ]
                    );

                    if (prixAchatFinal !== null) {
                        const montant_ligne = parseFloat(quantite)
                            * prixAchatFinal
                            * (1 - remise / 100);
                        montant_total += montant_ligne;
                    }
                }

                await connection.execute(
                    `UPDATE commandes_achat
                     SET montant_total = ?
                     WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                    [montant_total, id, id_utilisateur]
                );
            }

            await connection.commit();
            return await this.findById(id, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * ✅ Ajouter des lignes à une commande existante (Niveau 3)
     * ============================================================
     */
    static async addLignes(id_commande_achat, lignes, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour addLignes');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [commandeRows] = await connection.execute(
                `SELECT statut, montant_total FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id_commande_achat, id_utilisateur]
            );

            if (commandeRows.length === 0) {
                throw new Error('Commande non trouvée');
            }

            if (commandeRows[0].statut !== 'en_attente') {
                throw new Error('Impossible d\'ajouter des produits à une commande qui n\'est pas en attente');
            }

            let montant_total = parseFloat(commandeRows[0].montant_total) || 0;

            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_unite_vente = null,
                    nom_unite_vente = 'Unité',
                    quantite_base = 1,
                    quantite,
                    quantite_totale_base = null,
                    prix_achat = null,
                    remise = 0
                } = ligne;

                const [produitRows] = await connection.execute(
                    `SELECT id_produit FROM produits
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [id_produit, id_utilisateur]
                );
                if (produitRows.length === 0) {
                    throw new Error(`Produit ID ${id_produit} non trouvé`);
                }

                if (!quantite || parseFloat(quantite) <= 0) {
                    throw new Error(`La quantité doit être positive`);
                }

                let qteBase = parseFloat(quantite_base) || 1;
                if (id_unite_vente) {
                    const [uniteRows] = await connection.execute(
                        `SELECT quantite_base FROM unites_vente
                         WHERE id_unite_vente = ? AND id_produit = ?`,
                        [id_unite_vente, id_produit]
                    );
                    if (uniteRows.length > 0) {
                        qteBase = parseFloat(uniteRows[0].quantite_base) || 1;
                    }
                }

                // ✅ Prix nullable
                let prixAchatFinal = null;
                if (prix_achat !== null && prix_achat !== undefined && prix_achat !== '') {
                    const parsed = parseFloat(prix_achat);
                    if (!isNaN(parsed) && parsed > 0) {
                        prixAchatFinal = parsed;
                    }
                }

                await connection.execute(
                    `INSERT INTO ligne_commande_achat (
                        id_commande_achat, id_produit,
                        id_unite_vente, nom_unite_vente, quantite_base,
                        quantite, prix_achat, remise
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id_commande_achat,
                        id_produit,
                        id_unite_vente || null,
                        nom_unite_vente || 'Unité',
                        qteBase,
                        quantite,
                        prixAchatFinal,
                        remise
                    ]
                );

                if (prixAchatFinal !== null) {
                    const montant_ligne = parseFloat(quantite)
                        * prixAchatFinal
                        * (1 - remise / 100);
                    montant_total += montant_ligne;
                }
            }

            await connection.execute(
                `UPDATE commandes_achat
                 SET montant_total = ?
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [montant_total, id_commande_achat, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(id_commande_achat, id_utilisateur);

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
                `SELECT statut FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Commande non trouvée');
            }

            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer une commande ${rows[0].statut}`);
            }

            const [result] = await pool.execute(
                `DELETE FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            return result.affectedRows > 0;

        } catch (error) {
            console.error('❌ Error deleting commande:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Vérifier si une commande peut être annulée
     * ============================================================
     */
    static async canAnnuler(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour canAnnuler');
        }

        const [rows] = await pool.execute(
            `SELECT statut FROM commandes_achat
             WHERE id_commande_achat = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );

        if (rows.length === 0) return false;
        return !['recue', 'annulee'].includes(rows[0].statut);
    }

    /**
     * ============================================================
     * Statistiques des commandes d'achat
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
                    SUM(CASE WHEN statut = 'en_attente'         THEN 1 ELSE 0 END) as en_attente,
                    SUM(CASE WHEN statut = 'envoyee'            THEN 1 ELSE 0 END) as envoyee,
                    SUM(CASE WHEN statut = 'partiellement_recue' THEN 1 ELSE 0 END) as partiellement_recue,
                    SUM(CASE WHEN statut = 'recue'              THEN 1 ELSE 0 END) as recue,
                    SUM(CASE WHEN statut = 'annulee'            THEN 1 ELSE 0 END) as annulee,
                    COALESCE(SUM(montant_total), 0) as total_montant,
                    COALESCE(AVG(montant_total), 0) as moyenne_montant
                 FROM commandes_achat
                 WHERE id_utilisateur = ?`,
                [id_utilisateur]
            );

            const stats = rows[0];
            return {
                total: parseInt(stats.total) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                envoyee: parseInt(stats.envoyee) || 0,
                partiellement_recue: parseInt(stats.partiellement_recue) || 0,
                recue: parseInt(stats.recue) || 0,
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

export default CommandeAchat;