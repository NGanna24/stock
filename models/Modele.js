// models/Modele.js
import { pool } from '../config/db.js';

class Modele {
    /**
     * ============================================================
     * Récupérer tous les modèles de l'utilisateur
     * ============================================================
     */
    static async findAll(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM modeles
             WHERE id_utilisateur = ?
             ORDER BY nom ASC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer un modèle par ID (vérifié dans le workspace)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM modeles
             WHERE id_modele = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * Récupérer un modèle par son nom (dans le workspace)
     * ============================================================
     */
    static async findByNom(nom, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByNom');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM modeles
             WHERE nom = ? AND id_utilisateur = ?`,
            [nom, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * Rechercher des modèles par mot-clé
     * ============================================================
     */
    static async search(keyword, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM modeles
             WHERE id_utilisateur = ?
               AND nom LIKE ?
             ORDER BY nom ASC`,
            [id_utilisateur, `%${keyword}%`]
        );
        return rows;
    }

    /**
     * ============================================================
     * Créer un nouveau modèle dans le workspace
     * ============================================================
     */
    static async create(data, id_utilisateur) {
        const { nom } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }
        if (!nom || nom.trim() === '') {
            throw new Error('Le nom est obligatoire');
        }

        const [result] = await pool.execute(
            `INSERT INTO modeles (id_utilisateur, nom)
             VALUES (?, ?)`,
            [id_utilisateur, nom.trim()]
        );
        return result.insertId;
    }

    /**
     * ============================================================
     * Mettre à jour un modèle
     * ============================================================
     */
    static async update(id, data, id_utilisateur) {
        const { nom } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const [result] = await pool.execute(
            `UPDATE modeles
             SET nom = ?
             WHERE id_modele = ? AND id_utilisateur = ?`,
            [nom, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Supprimer un modèle
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const [result] = await pool.execute(
            `DELETE FROM modeles
             WHERE id_modele = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Vérifier si un modèle existe dans le workspace
     * ============================================================
     */
    static async exists(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM modeles
             WHERE id_modele = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Vérifier si un nom existe déjà (dans le workspace)
     * ============================================================
     */
    static async nomExists(nom, id_utilisateur, excludeId = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour nomExists');
        }

        let query = `SELECT COUNT(*) as count
                     FROM modeles
                     WHERE nom = ? AND id_utilisateur = ?`;
        const params = [nom, id_utilisateur];

        if (excludeId) {
            query += ' AND id_modele != ?';
            params.push(excludeId);
        }

        const [rows] = await pool.execute(query, params);
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Statistiques des modèles (par utilisateur)
     * ============================================================
     * ⚠️ Note : la table `modeles` n'a PAS de colonne `actif`
     * dans le schéma actuel. On retire donc les stats actifs/inactifs.
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM modeles
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        return {
            total: parseInt(rows[0].total) || 0
        };
    }

    /**
     * ============================================================
     * Compter les modèles
     * ============================================================
     */
    static async count(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour count');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM modeles
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );
        return parseInt(rows[0].total) || 0;
    }

    /**
     * ============================================================
     * Pagination
     * ============================================================
     */
    static async findPaginated(limit, offset, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findPaginated');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
        const offsetInt = Math.max(0, parseInt(offset, 10) || 0);

        const [rows] = await pool.query(
            `SELECT *
             FROM modeles
             WHERE id_utilisateur = ?
             ORDER BY nom ASC
             LIMIT ${limitInt} OFFSET ${offsetInt}`,
            [id_utilisateur]
        );
        return rows;
    }
}

export default Modele;