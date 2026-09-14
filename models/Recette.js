// models/Recette.js
import { pool } from '../config/db.js';

class Recette {
    /**
     * ============================================================
     * RÉCUPÉRER TOUTES LES RECETTES (Paiements reçus)
     * ============================================================
     */
    static async findAll(id_utilisateur, filters = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        let conditions = ['pa.id_utilisateur = ?'];
        let params = [id_utilisateur];

        if (filters.dateDebut) {
            conditions.push('pa.date_paiement >= ?');
            params.push(filters.dateDebut);
        }

        if (filters.dateFin) {
            conditions.push('pa.date_paiement <= ?');
            params.push(filters.dateFin);
        }

        if (filters.modePaiement) {
            conditions.push('pa.mode_paiement = ?');
            params.push(filters.modePaiement);
        }

        if (filters.search) {
            conditions.push(`(
                fv.numero_facture LIKE ? OR
                cv.numero_commande LIKE ? OR
                cv.nomclient LIKE ?
            )`);
            const term = `%${filters.search}%`;
            params.push(term, term, term);
        }

        const whereClause = conditions.join(' AND ');

        const [rows] = await pool.execute(
            `SELECT
                pa.id_paiement,
                pa.date_paiement,
                pa.montant,
                pa.mode_paiement,
                pa.note,
                pa.reference,
                pa.date_creation,
                fv.id_facture,
                fv.numero_facture,
                fv.statut AS statut_facture,
                fv.montant_total AS montant_facture,
                cv.id_commande,
                cv.numero_commande,
                cv.nomclient,
                cv.telephone,
                DATE_FORMAT(pa.date_paiement, '%d/%m/%Y') AS date_formatee,
                DATE_FORMAT(pa.date_creation, '%d/%m/%Y %H:%i') AS date_creation_formatee
             FROM paiements pa
             LEFT JOIN factures_vente fv ON pa.id_facture = fv.id_facture
             LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
             WHERE ${whereClause}
             ORDER BY pa.date_paiement DESC, pa.id_paiement DESC`,
            params
        );

        return rows.map(r => ({
            ...r,
            montant: parseFloat(r.montant) || 0,
            montant_facture: parseFloat(r.montant_facture) || 0
        }));
    }

    /**
     * ============================================================
     * TOTAUX ET STATISTIQUES DES RECETTES
     * ============================================================
     */
    static async getStats(id_utilisateur, filters = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        let conditions = ['pa.id_utilisateur = ?'];
        let params = [id_utilisateur];

        if (filters.dateDebut) {
            conditions.push('pa.date_paiement >= ?');
            params.push(filters.dateDebut);
        }

        if (filters.dateFin) {
            conditions.push('pa.date_paiement <= ?');
            params.push(filters.dateFin);
        }

        const whereClause = conditions.join(' AND ');

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS nombre_paiements,
                COALESCE(SUM(pa.montant), 0) AS total_recettes,
                COALESCE(AVG(pa.montant), 0) AS moyenne_paiement,
                COUNT(DISTINCT pa.id_facture) AS nombre_factures,
                SUM(CASE WHEN pa.mode_paiement = 'especes' THEN pa.montant ELSE 0 END) AS total_especes,
                SUM(CASE WHEN pa.mode_paiement = 'carte' THEN pa.montant ELSE 0 END) AS total_carte,
                SUM(CASE WHEN pa.mode_paiement = 'virement' THEN pa.montant ELSE 0 END) AS total_virement,
                SUM(CASE WHEN pa.mode_paiement = 'cheque' THEN pa.montant ELSE 0 END) AS total_cheque,
                SUM(CASE WHEN pa.mode_paiement = 'autre' THEN pa.montant ELSE 0 END) AS total_autre
             FROM paiements pa
             WHERE ${whereClause}`,
            params
        );

        const t = rows[0];
        return {
            nombre_paiements: parseInt(t.nombre_paiements) || 0,
            total_recettes: parseFloat(t.total_recettes) || 0,
            moyenne_paiement: parseFloat(t.moyenne_paiement) || 0,
            nombre_factures: parseInt(t.nombre_factures) || 0,
            par_mode: {
                especes: parseFloat(t.total_especes) || 0,
                carte: parseFloat(t.total_carte) || 0,
                virement: parseFloat(t.total_virement) || 0,
                cheque: parseFloat(t.total_cheque) || 0,
                autre: parseFloat(t.total_autre) || 0
            }
        };
    }

    /**
     * ============================================================
     * RECETTES PAR JOUR
     * ============================================================
     */
    static async getRecettesParJour(id_utilisateur, filters = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getRecettesParJour');
        }

        let conditions = ['pa.id_utilisateur = ?'];
        let params = [id_utilisateur];

        if (filters.dateDebut) {
            conditions.push('pa.date_paiement >= ?');
            params.push(filters.dateDebut);
        }

        if (filters.dateFin) {
            conditions.push('pa.date_paiement <= ?');
            params.push(filters.dateFin);
        }

        const whereClause = conditions.join(' AND ');

        const [rows] = await pool.execute(
            `SELECT
                DATE(pa.date_paiement) AS date,
                COUNT(*) AS nombre_paiements,
                COALESCE(SUM(pa.montant), 0) AS total
             FROM paiements pa
             WHERE ${whereClause}
             GROUP BY DATE(pa.date_paiement)
             ORDER BY date ASC`,
            params
        );

        return rows.map(r => ({
            date: r.date,
            nombre_paiements: parseInt(r.nombre_paiements) || 0,
            total: parseFloat(r.total) || 0
        }));
    }

    /**
     * ============================================================
     * RECETTES PAR MODE DE PAIEMENT
     * ============================================================
     */
    static async getRecettesParMode(id_utilisateur, filters = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getRecettesParMode');
        }

        let conditions = ['pa.id_utilisateur = ?'];
        let params = [id_utilisateur];

        if (filters.dateDebut) {
            conditions.push('pa.date_paiement >= ?');
            params.push(filters.dateDebut);
        }

        if (filters.dateFin) {
            conditions.push('pa.date_paiement <= ?');
            params.push(filters.dateFin);
        }

        const whereClause = conditions.join(' AND ');

        const [rows] = await pool.execute(
            `SELECT
                pa.mode_paiement,
                COUNT(*) AS nombre,
                COALESCE(SUM(pa.montant), 0) AS total
             FROM paiements pa
             WHERE ${whereClause}
             GROUP BY pa.mode_paiement
             ORDER BY total DESC`,
            params
        );

        return rows.map(r => ({
            mode_paiement: r.mode_paiement,
            nombre: parseInt(r.nombre) || 0,
            total: parseFloat(r.total) || 0
        }));
    }

    /**
     * ============================================================
     * TOP CLIENTS PAR RECETTES
     * ============================================================
     */
    static async getTopClients(id_utilisateur, filters = {}, limit = 10) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getTopClients');
        }

        let conditions = ['pa.id_utilisateur = ?'];
        let params = [id_utilisateur];

        if (filters.dateDebut) {
            conditions.push('pa.date_paiement >= ?');
            params.push(filters.dateDebut);
        }

        if (filters.dateFin) {
            conditions.push('pa.date_paiement <= ?');
            params.push(filters.dateFin);
        }

        const whereClause = conditions.join(' AND ');
        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

        const [rows] = await pool.execute(
            `SELECT
                cv.nomclient,
                cv.telephone,
                COUNT(DISTINCT pa.id_paiement) AS nombre_paiements,
                COUNT(DISTINCT pa.id_facture) AS nombre_factures,
                COALESCE(SUM(pa.montant), 0) AS total_recettes
             FROM paiements pa
             LEFT JOIN factures_vente fv ON pa.id_facture = fv.id_facture
             LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
             WHERE ${whereClause}
               AND cv.nomclient IS NOT NULL
             GROUP BY cv.nomclient, cv.telephone
             ORDER BY total_recettes DESC
             LIMIT ${limitInt}`,
            params
        );

        return rows.map(r => ({
            nomclient: r.nomclient,
            telephone: r.telephone,
            nombre_paiements: parseInt(r.nombre_paiements) || 0,
            nombre_factures: parseInt(r.nombre_factures) || 0,
            total_recettes: parseFloat(r.total_recettes) || 0
        }));
    }

    /**
     * ============================================================
     * CRÉER UNE RECETTE (paiement manuel)
     * ============================================================
     */
    static async create(data, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }

        const {
            id_facture,
            date_paiement,
            montant,
            mode_paiement,
            note,
            reference
        } = data;

        const [result] = await pool.execute(
            `INSERT INTO paiements (
                id_utilisateur, id_facture, date_paiement,
                montant, mode_paiement, note, reference
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

        return result.insertId;
    }

    /**
     * ============================================================
     * SUPPRIMER UNE RECETTE
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const [result] = await pool.execute(
            `DELETE FROM paiements
             WHERE id_paiement = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );

        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * VÉRIFIER SI UNE RECETTE EXISTE
     * ============================================================
     */
    static async exists(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM paiements
             WHERE id_paiement = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );

        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * FACTURES IMPAYÉES (pour créer une recette)
     * ============================================================
     */
    static async getFacturesImpayees(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getFacturesImpayees');
        }

        const [rows] = await pool.execute(
            `SELECT
                fv.id_facture,
                fv.numero_facture,
                fv.date_facture,
                fv.date_echeance,
                fv.montant_total,
                fv.statut,
                cv.numero_commande,
                cv.nomclient,
                cv.telephone,
                COALESCE(SUM(pa.montant), 0) AS montant_paye,
                (fv.montant_total - COALESCE(SUM(pa.montant), 0)) AS montant_restant
             FROM factures_vente fv
             LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
             LEFT JOIN paiements pa ON fv.id_facture = pa.id_facture
             WHERE fv.id_utilisateur = ?
               AND fv.statut IN ('en_attente', 'partiellement_payee', 'en_retard')
             GROUP BY fv.id_facture
             HAVING montant_restant > 0
             ORDER BY fv.date_echeance ASC`,
            [id_utilisateur]
        );

        return rows.map(r => ({
            ...r,
            montant_total: parseFloat(r.montant_total) || 0,
            montant_paye: parseFloat(r.montant_paye) || 0,
            montant_restant: parseFloat(r.montant_restant) || 0
        }));
    }
}

export default Recette;