// models/Marque.js
import { pool } from '../config/db.js';

class Marque {
    /**
     * ============================================================
     * MARQUES PAR DÉFAUT POUR PIÈCES DÉTACHÉES MOTO
     * ============================================================
     * Ces marques sont insérées automatiquement à l'inscription
     * d'un nouveau propriétaire (workspace).
     */
    static MARQUES_DEFAUT = [
        // ============ MARQUES DE MOTO ============
        { nom: 'Honda',           description: 'Marque japonaise' },
        { nom: 'Yamaha',          description: 'Marque japonaise' },
        { nom: 'Suzuki',          description: 'Marque japonaise' },
        { nom: 'Kawasaki',        description: 'Marque japonaise' },
        { nom: 'KTM',             description: 'Marque autrichienne' },
        { nom: 'BMW',             description: 'Marque allemande' },
        { nom: 'Ducati',          description: 'Marque italienne' },
        { nom: 'Aprilia',         description: 'Marque italienne' },
        { nom: 'Triumph',         description: 'Marque britannique' },
        { nom: 'Harley-Davidson', description: 'Marque américaine' },
        { nom: 'Royal Enfield',   description: 'Marque indienne' },
        { nom: 'Bajaj',           description: 'Marque indienne' },
        { nom: 'TVS',             description: 'Marque indienne' },
        { nom: 'Hero',            description: 'Marque indienne' },
        { nom: 'Haojue',          description: 'Marque chinoise' },
        { nom: 'Lifan',           description: 'Marque chinoise' },
        { nom: 'Zongshen',        description: 'Marque chinoise' },

        // ============ FABRICANTS DE PIÈCES ============
        { nom: 'NGK',             description: 'Bougies et allumage' },
        { nom: 'Denso',           description: 'Bougies et pièces électriques' },
        { nom: 'Bosch',           description: 'Pièces électriques et injection' },
        { nom: 'Michelin',        description: 'Pneus' },
        { nom: 'Pirelli',         description: 'Pneus' },
        { nom: 'Bridgestone',     description: 'Pneus' },
        { nom: 'Castrol',         description: 'Huiles et lubrifiants' },
        { nom: 'Motul',           description: 'Huiles et lubrifiants' },
        { nom: 'Total',           description: 'Huiles et lubrifiants' },
        { nom: 'Brembo',          description: 'Freinage' },
        { nom: 'Ferodo',          description: 'Plaquettes de frein' },
        { nom: 'Yuasa',           description: 'Batteries' },
        { nom: 'Varta',           description: 'Batteries' },
        { nom: 'DID',             description: 'Chaînes de transmission' },
        { nom: 'RK',              description: 'Chaînes de transmission' },
        { nom: 'Regina',          description: 'Chaînes de transmission' },
        { nom: 'Gates',           description: 'Courroies' },
        { nom: 'SKF',             description: 'Roulements et joints' },
        { nom: 'NSK',             description: 'Roulements' },
    ];

    /**
     * ============================================================
     * SEED — Insérer les marques par défaut pour un utilisateur
     * ============================================================
     */
    static async seedDefaultMarques(id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour seedDefaultMarques');
        }

        const conn = connection || pool;
        let count = 0;

        for (const marque of this.MARQUES_DEFAUT) {
            try {
                const [result] = await conn.execute(
                    `INSERT IGNORE INTO marques (id_utilisateur, nom, description, actif)
                     VALUES (?, ?, ?, TRUE)`,
                    [id_utilisateur, marque.nom, marque.description]
                );
                if (result.affectedRows > 0) count++;
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') {
                    console.error(`⚠️ Erreur insertion marque "${marque.nom}":`, error.message);
                }
            }
        }

        console.log(`✅ ${count} marques par défaut insérées pour l'utilisateur ${id_utilisateur}`);
        return count;
    }

    /**
     * ============================================================
     * Vérifier si l'utilisateur a déjà des marques
     * ============================================================
     */
    static async utilisateurADesMarques(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total FROM marques WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );
        return parseInt(rows[0].total) > 0;
    }

    /**
     * ============================================================
     * SEED INTELLIGENT — Insère seulement si l'utilisateur n'a rien
     * ============================================================
     */
    static async seedIfEmpty(id_utilisateur, connection = null) {
        const deja = await this.utilisateurADesMarques(id_utilisateur);
        if (deja) {
            console.log(`ℹ️ L'utilisateur ${id_utilisateur} a déjà des marques — seed ignoré`);
            return 0;
        }
        return await this.seedDefaultMarques(id_utilisateur, connection);
    }

    /**
     * ============================================================
     * Récupérer toutes les marques du workspace
     * ============================================================
     */
    static async findAll(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        const [rows] = await pool.execute(
            `SELECT * FROM marques
             WHERE id_utilisateur = ?
             ORDER BY nom ASC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer les marques actives
     * ============================================================
     */
    static async findActive(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findActive');
        }

        const [rows] = await pool.execute(
            `SELECT * FROM marques
             WHERE actif = 1 AND id_utilisateur = ?
             ORDER BY nom ASC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Récupérer une marque par ID (workspace)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT * FROM marques
             WHERE id_marque = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * Récupérer une marque par nom (workspace)
     * ============================================================
     */
    static async findByNom(nom, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByNom');
        }

        const [rows] = await pool.execute(
            `SELECT * FROM marques
             WHERE nom = ? AND id_utilisateur = ?`,
            [nom, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * Rechercher des marques
     * ============================================================
     */
    static async search(keyword, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }

        const [rows] = await pool.execute(
            `SELECT * FROM marques
             WHERE id_utilisateur = ?
               AND (nom LIKE ? OR description LIKE ?)
             ORDER BY nom ASC`,
            [id_utilisateur, `%${keyword}%`, `%${keyword}%`]
        );
        return rows;
    }

    /**
     * ============================================================
     * Créer une nouvelle marque
     * ============================================================
     */
    static async create(data, id_utilisateur) {
        const { nom, description = null } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }
        if (!nom || nom.trim() === '') {
            throw new Error('Le nom est obligatoire');
        }

        const [result] = await pool.execute(
            `INSERT INTO marques (id_utilisateur, nom, description)
             VALUES (?, ?, ?)`,
            [id_utilisateur, nom.trim(), description]
        );
        return result.insertId;
    }

    /**
     * ============================================================
     * Mettre à jour une marque
     * ============================================================
     */
    static async update(id, data, id_utilisateur) {
        const { nom, description = null } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const [result] = await pool.execute(
            `UPDATE marques
             SET nom = ?, description = ?
             WHERE id_marque = ? AND id_utilisateur = ?`,
            [nom, description, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Mettre à jour le statut
     * ============================================================
     */
    static async updateStatus(id, actif, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatus');
        }

        const [result] = await pool.execute(
            `UPDATE marques SET actif = ?
             WHERE id_marque = ? AND id_utilisateur = ?`,
            [actif ? 1 : 0, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Supprimer une marque
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const [result] = await pool.execute(
            `DELETE FROM marques
             WHERE id_marque = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Vérifier si une marque existe
     * ============================================================
     */
    static async exists(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM marques
             WHERE id_marque = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Vérifier si un nom existe déjà (workspace)
     * ============================================================
     */
    static async nomExists(nom, id_utilisateur, excludeId = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour nomExists');
        }

        let query = `SELECT COUNT(*) as count FROM marques
                     WHERE nom = ? AND id_utilisateur = ?`;
        const params = [nom, id_utilisateur];

        if (excludeId) {
            query += ' AND id_marque != ?';
            params.push(excludeId);
        }

        const [rows] = await pool.execute(query, params);
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Statistiques des marques (workspace)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN actif = 1 THEN 1 ELSE 0 END) as actifs,
                SUM(CASE WHEN actif = 0 THEN 1 ELSE 0 END) as inactifs
             FROM marques
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            actifs: parseInt(s.actifs) || 0,
            inactifs: parseInt(s.inactifs) || 0
        };
    }

    /**
     * ============================================================
     * Compter les marques (workspace)
     * ============================================================
     */
    static async count(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour count');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total FROM marques WHERE id_utilisateur = ?`,
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
            `SELECT * FROM marques
             WHERE id_utilisateur = ?
             ORDER BY nom ASC
             LIMIT ${limitInt} OFFSET ${offsetInt}`,
            [id_utilisateur]
        );
        return rows;
    }
}

export default Marque;