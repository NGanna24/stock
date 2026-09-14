// models/Paiement.js
import { pool } from '../config/db.js';

class Paiement {
    /**
     * ============================================================
     * Récupérer tous les paiements (par workspace)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT p.*,
                       fv.numero_facture,
                       fv.id_commande,
                       cv.numero_commande,
                       cv.nomclient,
                       cv.telephone,
                       u.fullname as utilisateur_nom,
                       DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                FROM paiements p
                LEFT JOIN factures_vente fv ON p.id_facture = fv.id_facture
                LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
                LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                WHERE p.id_utilisateur = ?              -- ✅ ISOLATION
            `;
            const params = [id_utilisateur];

            if (filters.search) {
                query += ` AND (cv.nomclient LIKE ?
                            OR cv.telephone LIKE ?
                            OR cv.numero_commande LIKE ?
                            OR fv.numero_facture LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s, s);
            }

            if (filters.id_facture) {
                query += ' AND p.id_facture = ?';
                params.push(filters.id_facture);
            }

            if (filters.id_commande) {
                query += ' AND cv.id_commande = ?';
                params.push(filters.id_commande);
            }

            if (filters.mode_paiement) {
                query += ' AND p.mode_paiement = ?';
                params.push(filters.mode_paiement);
            }

            if (filters.date_debut) {
                query += ' AND p.date_paiement >= ?';
                params.push(filters.date_debut);
            }

            if (filters.date_fin) {
                query += ' AND p.date_paiement <= ?';
                params.push(filters.date_fin);
            }

            if (filters.montant_min) {
                query += ' AND p.montant >= ?';
                params.push(filters.montant_min);
            }

            if (filters.montant_max) {
                query += ' AND p.montant <= ?';
                params.push(filters.montant_max);
            }

            query += ' ORDER BY p.date_paiement DESC, p.id_paiement DESC';

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
            console.error('❌ Error finding paiements:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer un paiement par ID (workspace)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT p.*,
                        fv.numero_facture,
                        fv.id_commande,
                        cv.numero_commande,
                        cv.nomclient,
                        cv.telephone,
                        u.fullname as utilisateur_nom,
                        DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                 FROM paiements p
                 LEFT JOIN factures_vente fv ON p.id_facture = fv.id_facture
                 LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
                 LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                 WHERE p.id_paiement = ?
                   AND p.id_utilisateur = ?`,          // ✅ ISOLATION
                [id, id_utilisateur]
            );
            return rows[0];
        } catch (error) {
            console.error('❌ Error finding paiement by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les paiements d'une facture (workspace)
     * ============================================================
     */
    static async findByFacture(idFacture, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByFacture');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT p.*,
                        u.fullname as utilisateur_nom,
                        DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                 FROM paiements p
                 LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                 WHERE p.id_facture = ?
                   AND p.id_utilisateur = ?             -- ✅ ISOLATION
                 ORDER BY p.date_paiement DESC`,
                [idFacture, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by facture:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les paiements d'une commande (workspace)
     * ============================================================
     */
    static async findByCommande(idCommande, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCommande');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT p.*,
                        fv.numero_facture,
                        u.fullname as utilisateur_nom,
                        DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                 FROM paiements p
                 LEFT JOIN factures_vente fv ON p.id_facture = fv.id_facture
                 LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                 WHERE fv.id_commande = ?
                   AND p.id_utilisateur = ?             -- ✅ ISOLATION
                 ORDER BY p.date_paiement DESC`,
                [idCommande, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by commande:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les paiements par mode (workspace)
     * ============================================================
     */
    static async findByMode(modePaiement, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByMode');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT p.*,
                        fv.numero_facture,
                        cv.numero_commande,
                        cv.nomclient,
                        u.fullname as utilisateur_nom,
                        DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                 FROM paiements p
                 LEFT JOIN factures_vente fv ON p.id_facture = fv.id_facture
                 LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
                 LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                 WHERE p.mode_paiement = ?
                   AND p.id_utilisateur = ?             -- ✅ ISOLATION
                 ORDER BY p.date_paiement DESC`,
                [modePaiement, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by mode:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Créer un nouveau paiement
     * ============================================================
     */
    static async create(data) {
        const {
            id_facture,
            date_paiement,
            montant,
            mode_paiement,
            note,
            reference,
            id_utilisateur
        } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }
        if (!id_facture) {
            throw new Error('id_facture requis');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // ✅ Vérifier la facture DANS le workspace
            const [factureRows] = await connection.execute(
                `SELECT id_facture, montant_total, statut
                 FROM factures_vente
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [id_facture, id_utilisateur]
            );

            if (factureRows.length === 0) {
                throw new Error('Facture non trouvée');
            }

            const facture = factureRows[0];
            const montantFacture = parseFloat(facture.montant_total) || 0;

            // Total déjà payé (dans le workspace)
            const [paiementsRows] = await connection.execute(
                `SELECT SUM(montant) as total_paye
                 FROM paiements
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [id_facture, id_utilisateur]
            );
            const totalPaye = parseFloat(paiementsRows[0].total_paye) || 0;

            // Vérifier que le paiement ne dépasse pas le montant dû
            const montantDu = montantFacture - totalPaye;
            const montantNum = parseFloat(montant);

            if (montantNum <= 0) {
                throw new Error('Le montant doit être supérieur à 0');
            }
            if (montantNum > montantDu) {
                throw new Error(`Le montant (${montant}) dépasse le montant dû (${montantDu})`);
            }

            // Insérer le paiement
            const [result] = await connection.execute(
                `INSERT INTO paiements (
                    id_utilisateur, id_facture, date_paiement, montant,
                    mode_paiement, note, reference
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    id_utilisateur,
                    id_facture,
                    date_paiement,
                    montant,
                    mode_paiement || 'especes',
                    note || null,
                    reference || null
                ]
            );

            const id_paiement = result.insertId;

            // Mettre à jour le statut de la facture
            const nouveauTotalPaye = totalPaye + montantNum;
            let nouveauStatut = 'en_attente';
            if (nouveauTotalPaye >= montantFacture) {
                nouveauStatut = 'payee';
            } else if (nouveauTotalPaye > 0) {
                nouveauStatut = 'partiellement_payee';
            }

            await connection.execute(
                `UPDATE factures_vente SET statut = ?
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [nouveauStatut, id_facture, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(id_paiement, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Supprimer un paiement (et recalculer le statut facture)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // ✅ Récupérer le paiement DANS le workspace
            const [paiementRows] = await connection.execute(
                `SELECT id_facture, montant
                 FROM paiements
                 WHERE id_paiement = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (paiementRows.length === 0) {
                throw new Error('Paiement non trouvé');
            }

            const id_facture = paiementRows[0].id_facture;

            // Supprimer le paiement
            const [result] = await connection.execute(
                `DELETE FROM paiements
                 WHERE id_paiement = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            // Recalculer le total payé
            const [paiementsRestants] = await connection.execute(
                `SELECT SUM(montant) as total_paye
                 FROM paiements
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [id_facture, id_utilisateur]
            );
            const totalPaye = parseFloat(paiementsRestants[0].total_paye) || 0;

            // Récupérer le montant total de la facture
            const [factureRows] = await connection.execute(
                `SELECT montant_total FROM factures_vente
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [id_facture, id_utilisateur]
            );
            const montantFacture = parseFloat(factureRows[0].montant_total) || 0;

            let nouveauStatut = 'en_attente';
            if (totalPaye >= montantFacture) {
                nouveauStatut = 'payee';
            } else if (totalPaye > 0) {
                nouveauStatut = 'partiellement_payee';
            }

            await connection.execute(
                `UPDATE factures_vente SET statut = ?
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [nouveauStatut, id_facture, id_utilisateur]
            );

            await connection.commit();
            return result.affectedRows > 0;

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Statistiques des paiements (par workspace)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) as total_paiements,
                    COALESCE(SUM(montant), 0) as total_montant,
                    COALESCE(SUM(CASE WHEN mode_paiement = 'especes'  THEN montant ELSE 0 END), 0) as especes,
                    COALESCE(SUM(CASE WHEN mode_paiement = 'carte'    THEN montant ELSE 0 END), 0) as carte,
                    COALESCE(SUM(CASE WHEN mode_paiement = 'virement' THEN montant ELSE 0 END), 0) as virement,
                    COALESCE(SUM(CASE WHEN mode_paiement = 'cheque'   THEN montant ELSE 0 END), 0) as cheque,
                    COALESCE(SUM(CASE WHEN mode_paiement = 'autre'    THEN montant ELSE 0 END), 0) as autre,
                    COALESCE(SUM(CASE WHEN DATE(date_paiement) = CURDATE() THEN montant ELSE 0 END), 0) as montant_aujourdhui,
                    COUNT(CASE WHEN DATE(date_paiement) = CURDATE() THEN 1 END) as paiements_aujourdhui
                 FROM paiements
                 WHERE id_utilisateur = ?`,             // ✅ ISOLATION
                [id_utilisateur]
            );

            const stats = rows[0];
            return {
                total_paiements: parseInt(stats.total_paiements) || 0,
                total_montant: parseFloat(stats.total_montant) || 0,
                especes: parseFloat(stats.especes) || 0,
                carte: parseFloat(stats.carte) || 0,
                virement: parseFloat(stats.virement) || 0,
                cheque: parseFloat(stats.cheque) || 0,
                autre: parseFloat(stats.autre) || 0,
                montant_aujourdhui: parseFloat(stats.montant_aujourdhui) || 0,
                paiements_aujourdhui: parseInt(stats.paiements_aujourdhui) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Exporter les paiements (par workspace)
     * ============================================================
     */
    static async export(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour export');
        }

        try {
            const paiements = await this.findAll(filters, id_utilisateur);
            return paiements.map(p => ({
                id: p.id_paiement,
                date: p.date_paiement_formatee || p.date_paiement,
                client: p.nomclient || '-',
                telephone: p.telephone || '-',
                commande: p.numero_commande || '-',
                facture: p.numero_facture || '-',
                montant: parseFloat(p.montant) || 0,
                mode: p.mode_paiement,
                reference: p.reference || '-',
                note: p.note || '-',
                utilisateur: p.utilisateur_nom || '-'
            }));
        } catch (error) {
            console.error('❌ Error exporting paiements:', error);
            throw error;
        }
    }
}

export default Paiement;