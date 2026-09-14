// models/RetourFournisseur.js
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';

class RetourFournisseur {
    /**
     * ============================================================
     * Générer un numéro de retour unique PAR WORKSPACE
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
            `SELECT COUNT(*) as count FROM retours_fournisseurs
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `RET-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * Créer un nouveau retour fournisseur
     * ============================================================
     */
    static async create(data) {
        const {
            id_fournisseur,
            id_commande_achat,
            id_reception,
            date_retour,
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
            // 1. VALIDATIONS
            // ============================================================
            if (!id_fournisseur) throw new Error('Le fournisseur est obligatoire');
            if (!date_retour)    throw new Error('La date de retour est obligatoire');
            if (!motif_retour)   throw new Error('Le motif de retour est obligatoire');
            if (lignes.length === 0) throw new Error('Au moins un produit est requis');

            // ============================================================
            // 2. VÉRIFICATION DU FOURNISSEUR (workspace)
            // ============================================================
            const [fournisseurRows] = await connection.execute(
                `SELECT id_fournisseur, nom FROM fournisseurs
                 WHERE id_fournisseur = ?
                   AND id_utilisateur = ?
                   AND actif = 1`,
                [id_fournisseur, id_utilisateur]
            );

            if (fournisseurRows.length === 0) {
                throw new Error('Fournisseur non trouvé ou inactif');
            }

            // ============================================================
            // 3. VÉRIFICATION DES PRODUITS (workspace)
            // ============================================================
            for (const ligne of lignes) {
                const { id_produit, quantite } = ligne;

                const [produitRows] = await connection.execute(
                    `SELECT id_produit, nom, quantite_stock, prix_achat
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

                const stockDisponible = parseFloat(produitRows[0].quantite_stock) || 0;
                if (parseFloat(quantite) > stockDisponible) {
                    throw new Error(
                        `Stock insuffisant pour ${produitRows[0].nom}. ` +
                        `Disponible: ${stockDisponible}, Demandé: ${quantite}`
                    );
                }
            }

            // ============================================================
            // 4. GÉNÉRATION DU NUMÉRO
            // ============================================================
            const numero_retour = await this.genererNumero(id_utilisateur);

            // ============================================================
            // 5. CRÉATION DE L'EN-TÊTE
            // ============================================================
            const [result] = await connection.execute(
                `INSERT INTO retours_fournisseurs (
                    id_utilisateur, numero_retour, date_retour,
                    id_fournisseur, id_commande_achat, id_reception,
                    motif_retour, statut, montant_total, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur,
                    numero_retour,
                    date_retour,
                    id_fournisseur,
                    id_commande_achat || null,
                    id_reception || null,
                    motif_retour,
                    notes || null
                ]
            );

            const id_retour = result.insertId;

            // ============================================================
            // 6. TRAITEMENT DES LIGNES
            // ============================================================
            let montant_total = 0;

            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_ligne_achat = null,
                    quantite,
                    prix_achat = 0,
                    remise = 0,
                    motif_retour: motifLigne,
                    etat_produit = 'neuf',
                    notes_ligne = null
                } = ligne;

                let prixUnitaire = prix_achat;
                if (!prixUnitaire || prixUnitaire === 0) {
                    const [produitRows] = await connection.execute(
                        `SELECT prix_achat FROM produits
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [id_produit, id_utilisateur]
                    );
                    prixUnitaire = parseFloat(produitRows[0]?.prix_achat) || 0;
                }

                // Insérer la ligne de retour
                await connection.execute(
                    `INSERT INTO retour_lignes (
                        id_retour, id_produit, id_ligne_achat,
                        quantite, prix_achat, remise,
                        motif_retour, etat_produit, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id_retour,
                        id_produit,
                        id_ligne_achat,
                        quantite,
                        prixUnitaire,
                        remise || 0,
                        motifLigne || motif_retour,
                        etat_produit,
                        notes_ligne
                    ]
                );

                // ✅ Mouvement de stock centralisé (met à jour le stock + statut)
                await MouvementStock.enregistrer({
                    id_produit,
                    type_mouvement: 'sortie',
                    quantite,
                    id_reference: id_retour,
                    type_reference: 'retour_fournisseur',
                    notes: `Retour fournisseur ${numero_retour} - ${motifLigne || motif_retour}`
                }, connection, id_utilisateur);

                // Enregistrer la sortie de stock (historique dédié)
                const ref_sortie = `SORTIE-RET-${Date.now()}-${id_produit}`;
                await connection.execute(
                    `INSERT INTO sorties_stock (
                        id_utilisateur, reference, date_sortie, id_produit,
                        quantite, type_sortie, notes
                    ) VALUES (?, ?, ?, ?, ?, 'retour_fournisseur', ?)`,
                    [
                        id_utilisateur,
                        ref_sortie,
                        date_retour,
                        id_produit,
                        quantite,
                        notes_ligne || `Retour fournisseur ${numero_retour}`
                    ]
                );

                montant_total += parseFloat(quantite) * prixUnitaire * (1 - (remise || 0) / 100);
            }

            // ============================================================
            // 7. MISE À JOUR DU MONTANT TOTAL
            // ============================================================
            await connection.execute(
                `UPDATE retours_fournisseurs SET montant_total = ?
                 WHERE id_retour = ? AND id_utilisateur = ?`,
                [montant_total, id_retour, id_utilisateur]
            );

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
     * Récupérer un retour par ID
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*,
                        f.nom as fournisseur_nom,
                        f.telephone as fournisseur_telephone,
                        f.email as fournisseur_email,
                        ca.numero_commande,
                        rec.numero_reception,
                        u.fullname as utilisateur_nom
                 FROM retours_fournisseurs r
                 LEFT JOIN fournisseurs f ON r.id_fournisseur = f.id_fournisseur
                 LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                 LEFT JOIN receptions rec ON r.id_reception = rec.id_reception
                 LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                 WHERE r.id_retour = ?
                   AND r.id_utilisateur = ?`,        // ✅ ISOLATION
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const retour = rows[0];

            const [lignes] = await pool.execute(
                `SELECT rl.*,
                        p.nom as produit_nom,
                        p.id_marque,
                        m.nom as marque_nom,
                        p.id_unite,
                        u.symbole as unite_symbole
                 FROM retour_lignes rl
                 LEFT JOIN produits p ON rl.id_produit = p.id_produit
                 LEFT JOIN marques m ON p.id_marque = m.id_marque
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 WHERE rl.id_retour = ?`,
                [id]
            );

            retour.lignes = lignes;
            return retour;

        } catch (error) {
            console.error('❌ Error finding retour by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer tous les retours (par workspace)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT r.*,
                       f.nom as fournisseur_nom,
                       ca.numero_commande,
                       u.fullname as utilisateur_nom
                FROM retours_fournisseurs r
                LEFT JOIN fournisseurs f ON r.id_fournisseur = f.id_fournisseur
                LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                WHERE r.id_utilisateur = ?              -- ✅ ISOLATION
            `;
            const params = [id_utilisateur];

            if (filters.search) {
                query += ` AND (r.numero_retour LIKE ?
                            OR f.nom LIKE ?
                            OR r.notes LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s);
            }
            if (filters.id_fournisseur) {
                query += ' AND r.id_fournisseur = ?';
                params.push(filters.id_fournisseur);
            }
            if (filters.statut) {
                query += ' AND r.statut = ?';
                params.push(filters.statut);
            }
            if (filters.motif_retour) {
                query += ' AND r.motif_retour = ?';
                params.push(filters.motif_retour);
            }
            if (filters.date_debut) {
                query += ' AND r.date_retour >= ?';
                params.push(filters.date_debut);
            }
            if (filters.date_fin) {
                query += ' AND r.date_retour <= ?';
                params.push(filters.date_fin);
            }

            query += ' ORDER BY r.date_retour DESC, r.id_retour DESC';

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
            console.error('❌ Error finding retours:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les retours par statut
     * ============================================================
     */
    static async findByStatut(statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*, f.nom as fournisseur_nom
                 FROM retours_fournisseurs r
                 LEFT JOIN fournisseurs f ON r.id_fournisseur = f.id_fournisseur
                 WHERE r.statut = ?
                   AND r.id_utilisateur = ?             -- ✅ ISOLATION
                 ORDER BY r.date_retour DESC`,
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
     * Récupérer les retours d'un fournisseur
     * ============================================================
     */
    static async findByFournisseur(id_fournisseur, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByFournisseur');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*, u.fullname as utilisateur_nom
                 FROM retours_fournisseurs r
                 LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                 WHERE r.id_fournisseur = ?
                   AND r.id_utilisateur = ?             -- ✅ ISOLATION
                 ORDER BY r.date_retour DESC`,
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
     * Mettre à jour le statut (✅ pool, pas connection)
     * ============================================================
     */
    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatut');
        }

        try {
            const statutsValides = ['en_attente', 'envoye', 'recu_par_fournisseur', 'traite', 'annule'];
            if (!statutsValides.includes(statut)) {
                throw new Error('Statut invalide');
            }

            const dateTraitement = statut === 'traite' ? new Date() : null;

            // ✅ Utilise pool (pas connection)
            const [result] = await pool.execute(
                `UPDATE retours_fournisseurs
                 SET statut = ?, date_traitement = ?
                 WHERE id_retour = ? AND id_utilisateur = ?`,   // ✅ ISOLATION
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
     * Statistiques des retours fournisseurs (par workspace)
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
                    SUM(CASE WHEN statut = 'en_attente'           THEN 1 ELSE 0 END) as en_attente,
                    SUM(CASE WHEN statut = 'envoye'               THEN 1 ELSE 0 END) as envoye,
                    SUM(CASE WHEN statut = 'recu_par_fournisseur' THEN 1 ELSE 0 END) as recu_par_fournisseur,
                    SUM(CASE WHEN statut = 'traite'               THEN 1 ELSE 0 END) as traite,
                    SUM(CASE WHEN statut = 'annule'               THEN 1 ELSE 0 END) as annule,
                    COALESCE(SUM(montant_total), 0) as total_montant,
                    COALESCE(AVG(montant_total), 0) as moyenne_montant
                 FROM retours_fournisseurs
                 WHERE id_utilisateur = ?`,             // ✅ ISOLATION
                [id_utilisateur]
            );

            const stats = rows[0];
            return {
                total: parseInt(stats.total) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                envoye: parseInt(stats.envoye) || 0,
                recu_par_fournisseur: parseInt(stats.recu_par_fournisseur) || 0,
                traite: parseInt(stats.traite) || 0,
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
     * Annuler un retour (réintègre le stock)
     * ============================================================
     */
    static async annuler(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour annuler');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Vérifier le retour
            const [rows] = await connection.execute(
                `SELECT statut FROM retours_fournisseurs
                 WHERE id_retour = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Retour non trouvé');
            }
            if (rows[0].statut === 'traite') {
                throw new Error('Un retour traité ne peut pas être annulé');
            }
            if (rows[0].statut === 'annule') {
                throw new Error('Ce retour est déjà annulé');
            }

            // Réintégrer le stock (mouvement inverse)
            const [lignes] = await connection.execute(
                `SELECT id_produit, quantite FROM retour_lignes
                 WHERE id_retour = ?`,
                [id]
            );

            for (const ligne of lignes) {
                // ✅ Mouvement d'entrée (réintégration)
                await MouvementStock.enregistrer({
                    id_produit: ligne.id_produit,
                    type_mouvement: 'entree',
                    quantite: ligne.quantite,
                    id_reference: id,
                    type_reference: 'annulation_retour_fournisseur',
                    notes: `Annulation retour fournisseur #${id}`
                }, connection, id_utilisateur);
            }

            // Mettre à jour le statut
            await connection.execute(
                `UPDATE retours_fournisseurs SET statut = 'annule'
                 WHERE id_retour = ? AND id_utilisateur = ?`,
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
     * Supprimer un retour (seulement si en attente)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT statut FROM retours_fournisseurs
                 WHERE id_retour = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Retour non trouvé');
            }
            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer un retour ${rows[0].statut}`);
            }

            const [result] = await pool.execute(
                `DELETE FROM retours_fournisseurs
                 WHERE id_retour = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            return result.affectedRows > 0;

        } catch (error) {
            console.error('❌ Error deleting retour:', error);
            throw error;
        }
    }
}

export default RetourFournisseur;