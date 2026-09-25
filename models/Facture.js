// models/Facture.js
import { pool } from '../config/db.js';

class Facture {
    /**
     * ============================================================
     * Générer un numéro de facture unique PAR WORKSPACE
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
     * Récupérer toutes les factures avec filtres (par workspace)
     * ✅ Le statut est calculé dynamiquement (statut_effectif)
     * ✅ Supporte le filtre spécial "impayees"
     * ✅ Utilise une sous-requête externe pour éviter les collisions
     *    de placeholders dans le CASE
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            // ✅ Sous-requête interne : calcule le statut_effectif UNE fois
            let query = `
                SELECT * FROM (
                    SELECT
                        f.*,
                        cv.numero_commande,
                        cv.nomclient,
                        cv.telephone,
                        cv.date_commande,
                        u.fullname as utilisateur_nom,
                        COALESCE(p.total_paye, 0) AS total_paye,
                        (f.montant_total - COALESCE(p.total_paye, 0)) AS reste_a_payer,
                        DATE_FORMAT(f.date_facture, '%d/%m/%Y') AS date_facture_formatee,
                        DATE_FORMAT(f.date_echeance, '%d/%m/%Y') AS date_echeance_formatee,
                        CASE
                            WHEN f.statut = 'annulee' THEN 'annulee'
                            WHEN (f.montant_total - COALESCE(p.total_paye, 0)) <= 0 AND f.montant_total > 0 THEN 'payee'
                            WHEN COALESCE(p.total_paye, 0) > 0
                                 AND (f.montant_total - COALESCE(p.total_paye, 0)) > 0 THEN 'partiellement_payee'
                            WHEN f.date_echeance IS NOT NULL
                                 AND f.date_echeance < CURDATE()
                                 AND (f.montant_total - COALESCE(p.total_paye, 0)) > 0 THEN 'en_retard'
                            ELSE COALESCE(f.statut, 'en_attente')
                        END AS statut_effectif
                    FROM factures_vente f
                    LEFT JOIN commandes_vente cv ON f.id_commande = cv.id_commande
                    LEFT JOIN utilisateurs u ON f.id_utilisateur = u.id_utilisateur
                    LEFT JOIN (
                        SELECT id_facture, SUM(montant) AS total_paye
                        FROM paiements
                        WHERE id_utilisateur = ?
                        GROUP BY id_facture
                    ) p ON p.id_facture = f.id_facture
                    WHERE f.id_utilisateur = ?
                ) AS factures_calc
                WHERE 1=1
            `;

            const params = [id_utilisateur, id_utilisateur];

            // ✅ Recherche texte
            if (filters.search) {
                query += ` AND (numero_facture LIKE ?
                            OR nomclient LIKE ?
                            OR telephone LIKE ?
                            OR numero_commande LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s, s);
            }

            // ✅ Filtrage par statut (avec cas spécial "impayees")
            if (filters.statut) {
                if (filters.statut === 'impayees') {
                    // Toutes les factures non annulées avec reste à payer
                    query += ` AND statut != 'annulee' AND reste_a_payer > 0`;
                } else {
                    query += ` AND statut_effectif = ?`;
                    params.push(filters.statut);
                }
            }

            if (filters.id_commande) {
                query += ' AND id_commande = ?';
                params.push(filters.id_commande);
            }

            if (filters.date_debut) {
                query += ' AND date_facture >= ?';
                params.push(filters.date_debut);
            }

            if (filters.date_fin) {
                query += ' AND date_facture <= ?';
                params.push(filters.date_fin);
            }

            if (filters.montant_min) {
                query += ' AND montant_total >= ?';
                params.push(filters.montant_min);
            }

            if (filters.montant_max) {
                query += ' AND montant_total <= ?';
                params.push(filters.montant_max);
            }

            query += ' ORDER BY date_facture DESC, id_facture DESC';

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
            console.error('❌ Error finding factures:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer une facture par ID (avec lignes + paiements)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            // En-tête de la facture
            const [rows] = await pool.execute(
                `SELECT f.*,
                        cv.numero_commande,
                        cv.nomclient,
                        cv.telephone,
                        cv.date_commande,
                        cv.notes as commande_notes,
                        u.fullname as utilisateur_nom,
                        (SELECT COALESCE(SUM(montant), 0)
                         FROM paiements
                         WHERE id_facture = f.id_facture
                           AND id_utilisateur = ?) as total_paye,
                        (f.montant_total - (SELECT COALESCE(SUM(montant), 0)
                                            FROM paiements
                                            WHERE id_facture = f.id_facture
                                              AND id_utilisateur = ?)) as reste_a_payer,
                        DATE_FORMAT(f.date_facture, '%d/%m/%Y') as date_facture_formatee,
                        DATE_FORMAT(f.date_echeance, '%d/%m/%Y') as date_echeance_formatee
                 FROM factures_vente f
                 LEFT JOIN commandes_vente cv ON f.id_commande = cv.id_commande
                 LEFT JOIN utilisateurs u ON f.id_utilisateur = u.id_utilisateur
                 WHERE f.id_facture = ?
                   AND f.id_utilisateur = ?`,
                [id_utilisateur, id_utilisateur, id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const facture = rows[0];

            // Récupérer les lignes de commande liées
            if (facture.id_commande) {
                const [lignes] = await pool.execute(
                    `SELECT lcv.*,
                            p.nom as produit_nom,
                            p.id_marque,
                            m.nom as marque_nom,
                            p.id_modele,
                            md.nom as modele_nom,
                            p.id_unite,
                            u.symbole as unite_symbole
                     FROM ligne_commande_vente lcv
                     LEFT JOIN produits p ON lcv.id_produit = p.id_produit
                     LEFT JOIN marques m ON p.id_marque = m.id_marque
                     LEFT JOIN modeles md ON p.id_modele = md.id_modele
                     LEFT JOIN unites u ON p.id_unite = u.id_unite
                     WHERE lcv.id_commande = ?`,
                    [facture.id_commande]
                );
                facture.lignes = lignes;
            } else {
                facture.lignes = [];
            }

            // Récupérer les paiements
            const [paiements] = await pool.execute(
                `SELECT p.*,
                        u.fullname as utilisateur_nom,
                        DATE_FORMAT(p.date_paiement, '%d/%m/%Y') as date_paiement_formatee
                 FROM paiements p
                 LEFT JOIN utilisateurs u ON p.id_utilisateur = u.id_utilisateur
                 WHERE p.id_facture = ?
                   AND p.id_utilisateur = ?
                 ORDER BY p.date_paiement DESC`,
                [id, id_utilisateur]
            );
            facture.paiements = paiements;

            return facture;

        } catch (error) {
            console.error('❌ Error finding facture by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les factures par statut (par workspace)
     * ============================================================
     */
    static async findByStatut(statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT f.*,
                        cv.numero_commande,
                        cv.nomclient,
                        u.fullname as utilisateur_nom,
                        (SELECT COALESCE(SUM(montant), 0)
                         FROM paiements
                         WHERE id_facture = f.id_facture
                           AND id_utilisateur = ?) as total_paye,
                        DATE_FORMAT(f.date_facture, '%d/%m/%Y') as date_facture_formatee
                 FROM factures_vente f
                 LEFT JOIN commandes_vente cv ON f.id_commande = cv.id_commande
                 LEFT JOIN utilisateurs u ON f.id_utilisateur = u.id_utilisateur
                 WHERE f.statut = ?
                   AND f.id_utilisateur = ?
                 ORDER BY f.date_facture DESC`,
                [id_utilisateur, statut, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by statut:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les factures d'une commande
     * ============================================================
     */
    static async findByCommande(idCommande, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCommande');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT f.*,
                        u.fullname as utilisateur_nom,
                        (SELECT COALESCE(SUM(montant), 0)
                         FROM paiements
                         WHERE id_facture = f.id_facture
                           AND id_utilisateur = ?) as total_paye,
                        DATE_FORMAT(f.date_facture, '%d/%m/%Y') as date_facture_formatee
                 FROM factures_vente f
                 LEFT JOIN utilisateurs u ON f.id_utilisateur = u.id_utilisateur
                 WHERE f.id_commande = ?
                   AND f.id_utilisateur = ?
                 ORDER BY f.date_facture DESC`,
                [id_utilisateur, idCommande, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by commande:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Créer une nouvelle facture
     * ============================================================
     */
    static async create(data) {
        const {
            id_commande,
            date_facture,
            date_echeance,
            montant_total,
            mode_paiement,
            notes,
            id_utilisateur
        } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // ✅ Générer le numéro DANS le workspace
            const numero_facture = await this.genererNumero(id_utilisateur);

            const [result] = await connection.execute(
                `INSERT INTO factures_vente (
                    id_utilisateur, numero_facture, date_facture, date_echeance,
                    id_commande, montant_total, statut, mode_paiement, notes
                ) VALUES (?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
                [
                    id_utilisateur,
                    numero_facture,
                    date_facture,
                    date_echeance,
                    id_commande || null,
                    montant_total,
                    mode_paiement || 'especes',
                    notes || null
                ]
            );

            const id_facture = result.insertId;

            await connection.commit();
            return await this.findById(id_facture, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une facture
     * ============================================================
     */
    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatut');
        }

        const statutsValides = ['en_attente', 'payee', 'partiellement_payee', 'en_retard', 'annulee'];
        if (!statutsValides.includes(statut)) {
            throw new Error('Statut invalide');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE factures_vente SET statut = ?
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [statut, id, id_utilisateur]
            );

            console.log(`📊 Statut facture ${id} mis à jour: ${statut}, affectedRows: ${result.affectedRows}`);
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating statut:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour la date d'échéance
     * ============================================================
     */
    static async updateEcheance(id, date_echeance, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateEcheance');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE factures_vente SET date_echeance = ?
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [date_echeance, id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating echeance:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * ✅ Statistiques des factures (avec statut effectif calculé)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            // ✅ Stats de base
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) as total_factures,
                    COALESCE(SUM(montant_total), 0) as total_montant,
                    COALESCE(AVG(montant_total), 0) as montant_moyen
                 FROM factures_vente
                 WHERE id_utilisateur = ?`,
                [id_utilisateur]
            );

            // ✅ Stats par statut effectif calculé
            const [statsEffectifs] = await pool.execute(
                `SELECT
                    -- Payées
                    SUM(CASE
                        WHEN f.statut != 'annulee'
                             AND (f.montant_total - COALESCE(p.total_paye, 0)) <= 0
                             AND f.montant_total > 0
                        THEN 1 ELSE 0
                    END) as payee,

                    -- Partiellement payées
                    SUM(CASE
                        WHEN f.statut != 'annulee'
                             AND COALESCE(p.total_paye, 0) > 0
                             AND (f.montant_total - COALESCE(p.total_paye, 0)) > 0
                        THEN 1 ELSE 0
                    END) as partiellement_payee,

                    -- En attente
                    SUM(CASE
                        WHEN f.statut != 'annulee'
                             AND COALESCE(p.total_paye, 0) = 0
                             AND (f.date_echeance IS NULL OR f.date_echeance >= CURDATE())
                        THEN 1 ELSE 0
                    END) as en_attente,

                    -- En retard
                    SUM(CASE
                        WHEN f.statut != 'annulee'
                             AND f.date_echeance IS NOT NULL
                             AND f.date_echeance < CURDATE()
                             AND (f.montant_total - COALESCE(p.total_paye, 0)) > 0
                        THEN 1 ELSE 0
                    END) as en_retard,

                    -- Annulées
                    SUM(CASE WHEN f.statut = 'annulee' THEN 1 ELSE 0 END) as annulee,

                    -- Montant impayé
                    COALESCE(SUM(CASE
                        WHEN f.statut != 'annulee'
                        THEN GREATEST(0, f.montant_total - COALESCE(p.total_paye, 0))
                        ELSE 0
                    END), 0) as montant_impaye,

                    -- Nombre de factures impayées
                    SUM(CASE
                        WHEN f.statut != 'annulee'
                             AND (f.montant_total - COALESCE(p.total_paye, 0)) > 0
                        THEN 1 ELSE 0
                    END) as total_impayees
                 FROM factures_vente f
                 LEFT JOIN (
                    SELECT id_facture, SUM(montant) as total_paye
                    FROM paiements
                    WHERE id_utilisateur = ?
                    GROUP BY id_facture
                 ) p ON p.id_facture = f.id_facture
                 WHERE f.id_utilisateur = ?`,
                [id_utilisateur, id_utilisateur]
            );

            const stats = rows[0];
            const eff = statsEffectifs[0];

            return {
                total_factures: parseInt(stats.total_factures) || 0,
                total_montant: parseFloat(stats.total_montant) || 0,
                en_attente: parseInt(eff.en_attente) || 0,
                payee: parseInt(eff.payee) || 0,
                partiellement_payee: parseInt(eff.partiellement_payee) || 0,
                en_retard: parseInt(eff.en_retard) || 0,
                annulee: parseInt(eff.annulee) || 0,
                total_impayees: parseInt(eff.total_impayees) || 0,
                montant_impaye: parseFloat(eff.montant_impaye) || 0,
                montant_moyen: parseFloat(stats.montant_moyen) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Supprimer une facture (vérifie qu'elle n'a pas de paiements)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            // ✅ Vérifier les paiements DANS le workspace
            const [paiements] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM paiements
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (paiements[0].count > 0) {
                throw new Error('Impossible de supprimer une facture qui a des paiements');
            }

            const [result] = await pool.execute(
                `DELETE FROM factures_vente
                 WHERE id_facture = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error deleting facture:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Exporter les factures en objet structuré
     * ============================================================
     */
    static async export(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour export');
        }

        try {
            const factures = await this.findAll(filters, id_utilisateur);
            return factures.map(f => ({
                id: f.id_facture,
                numero: f.numero_facture,
                date: f.date_facture_formatee || f.date_facture,
                echeance: f.date_echeance_formatee || f.date_echeance,
                client: f.nomclient || '-',
                telephone: f.telephone || '-',
                commande: f.numero_commande || '-',
                montant: parseFloat(f.montant_total) || 0,
                paye: parseFloat(f.total_paye) || 0,
                reste: parseFloat(f.reste_a_payer) || 0,
                statut: f.statut_effectif || f.statut,
                mode: f.mode_paiement,
                notes: f.notes || '-',
                utilisateur: f.utilisateur_nom || '-'
            }));
        } catch (error) {
            console.error('❌ Error exporting factures:', error);
            throw error;
        }
    }
}

export default Facture;