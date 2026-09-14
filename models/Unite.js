// models/Unite.js
import { pool } from '../config/db.js';

class Unite {
    /**
     * ============================================================
     * UNITÉS PAR DÉFAUT POUR PIÈCES DÉTACHÉES MOTO
     * ============================================================
     * Ces unités sont insérées automatiquement à l'inscription
     * d'un nouveau propriétaire (workspace).
     */
    static UNITES_DEFAUT = [
        // ============ COMPTAGE À L'UNITÉ ============
        { nom: 'Pièce',      symbole: 'pce', description: 'Pièce détachée individuelle (bougie, filtre, plaquette...)' },
        { nom: 'Unité',      symbole: 'u',   description: 'Unité individuelle' },
        { nom: 'Ensemble',   symbole: 'ens', description: 'Ensemble de pièces (kit chaîne, kit joint...)' },
        { nom: 'Kit',        symbole: 'kit', description: 'Kit complet (kit piston, kit chaîne, kit révision)' },
        { nom: 'Paire',      symbole: 'pr',  description: 'Paire (rétroviseurs, plaquettes, amortisseurs)' },

        // ============ LUBRIFIANTS ============
        { nom: 'Litre',      symbole: 'L',   description: "Litre d'huile ou liquide" },
        { nom: 'Millilitre', symbole: 'mL',  description: 'Millilitre de liquide' },
        { nom: 'Bidon',      symbole: 'bid', description: "Bidon d'huile (1L, 5L...)" },
        { nom: 'Bouteille',  symbole: 'btl', description: 'Bouteille de liquide (frein, refroidissement)' },
        { nom: 'Bombe',      symbole: 'bmb', description: 'Bombe aérosol (dégrippant, peinture, nettoyant)' },
        { nom: 'Pot',        symbole: 'pot', description: 'Pot de graisse ou pâte' },
        { nom: 'Tube',       symbole: 'tb',  description: 'Tube de graisse, colle, silicone' },

        // ============ CONDITIONNEMENTS ============
        { nom: 'Lot',        symbole: 'lot', description: 'Lot de plusieurs pièces' },
        { nom: 'Paquet',     symbole: 'pqt', description: 'Paquet de pièces (joints, vis...)' },
        { nom: 'Sachet',     symbole: 'sch', description: 'Sachet de petites pièces (vis, écrous)' },
        { nom: 'Boîte',      symbole: 'bte', description: 'Boîte de pièces' },
        { nom: 'Carton',     symbole: 'ctn', description: 'Carton de pièces (grande quantité)' },
        { nom: 'Palette',    symbole: 'pal', description: 'Palette de stockage' },

        // ============ MESURES ============
        { nom: 'Mètre',      symbole: 'm',   description: 'Mètre linéaire (câble, durite, gaine)' },
        { nom: 'Centimètre', symbole: 'cm',  description: 'Centimètre linéaire' },
        { nom: 'Millimètre', symbole: 'mm',  description: 'Millimètre (visserie, précision)' },

        // ============ SPÉCIAL MOTO ============
        { nom: 'Jeu',        symbole: 'jeu', description: 'Jeu de pièces (jeu de joints, jeu de segments)' },
        { nom: 'Rouleau',    symbole: 'rlo', description: 'Rouleau (adhésif, gaine thermique)' },
        { nom: 'Bobine',     symbole: 'bob', description: 'Bobine (fil électrique, câble)' },
        { nom: 'Cartouche',  symbole: 'crt', description: 'Cartouche (filtre à huile, cartouche de gaz)' },

        // ============ DIVERS / PRESTATIONS ============
        { nom: 'Heure',      symbole: 'h',   description: "Heure de main d'œuvre (réparation)" },
        { nom: 'Forfait',    symbole: 'fft', description: 'Forfait (montage, révision complète)' },
        { nom: 'Service',    symbole: 'svc', description: 'Service (vidange, réglage)' },
    ];

    /**
     * ============================================================
     * SEED — Insérer les unités par défaut pour un utilisateur
     * ============================================================
     * Appelée automatiquement à l'inscription d'un nouveau propriétaire.
     * Peut aussi être appelée manuellement si un utilisateur a perdu ses unités.
     *
     * @param {number} id_utilisateur - ID du propriétaire (workspace)
     * @param {object} connection - (optionnel) Connexion MySQL en transaction
     * @returns {Promise<number>} Nombre d'unités insérées
     */
    static async seedDefaultUnites(id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour seedDefaultUnites');
        }

        const conn = connection || pool;
        let count = 0;

        for (const unite of this.UNITES_DEFAUT) {
            try {
                const [result] = await conn.execute(
                    `INSERT IGNORE INTO unites (id_utilisateur, nom, symbole, description)
                     VALUES (?, ?, ?, ?)`,
                    [id_utilisateur, unite.nom, unite.symbole, unite.description]
                );
                if (result.affectedRows > 0) count++;
            } catch (error) {
                // Ignorer les doublons
                if (error.code !== 'ER_DUP_ENTRY') {
                    console.error(`⚠️ Erreur insertion unité "${unite.nom}":`, error.message);
                }
            }
        }

        console.log(`✅ ${count} unités par défaut insérées pour l'utilisateur ${id_utilisateur}`);
        return count;
    }

    /**
     * ============================================================
     * VÉRIFIER SI L'UTILISATEUR A DÉJÀ DES UNITÉS
     * ============================================================
     */
    static async utilisateurAUneUnite(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM unites
             WHERE id_utilisateur = ?`,
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
        const dejaDesUnites = await this.utilisateurAUneUnite(id_utilisateur);
        if (dejaDesUnites) {
            console.log(`ℹ️ L'utilisateur ${id_utilisateur} a déjà des unités — seed ignoré`);
            return 0;
        }
        return await this.seedDefaultUnites(id_utilisateur, connection);
    }

    /**
     * ============================================================
     * RÉCUPÉRER TOUTES LES UNITÉS (isolées par utilisateur)
     * ============================================================
     */
    static async findAll(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM unites
             WHERE id_utilisateur = ?
             ORDER BY nom ASC`,
            [id_utilisateur]
        );
        return rows; 
    }

    /**
     * ============================================================
     * RÉCUPÉRER UNE UNITÉ PAR SON ID
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM unites
             WHERE id_unite = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * RÉCUPÉRER UNE UNITÉ PAR SON NOM
     * ============================================================
     */
    static async findByNom(nom, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByNom');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM unites
             WHERE nom = ? AND id_utilisateur = ?`,
            [nom, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * RÉCUPÉRER UNE UNITÉ PAR SON SYMBOLE
     * ============================================================
     */
    static async findBySymbole(symbole, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findBySymbole');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM unites
             WHERE symbole = ? AND id_utilisateur = ?`,
            [symbole, id_utilisateur]
        );
        return rows[0];
    }

    /**
     * ============================================================
     * RECHERCHER DES UNITÉS
     * ============================================================
     */
    static async search(keyword, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }

        const [rows] = await pool.execute(
            `SELECT *
             FROM unites
             WHERE id_utilisateur = ?
               AND (nom LIKE ? OR symbole LIKE ? OR description LIKE ?)
             ORDER BY nom ASC`,
            [
                id_utilisateur,
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`
            ]
        );
        return rows;
    }

    /**
     * ============================================================
     * CRÉER UNE NOUVELLE UNITÉ
     * ============================================================
     */
    static async create(data, id_utilisateur) {
        const { nom, symbole, description = null } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }
        if (!nom || nom.trim() === '') {
            throw new Error('Le nom est obligatoire');
        }
        if (!symbole || symbole.trim() === '') {
            throw new Error('Le symbole est obligatoire');
        }

        const [result] = await pool.execute(
            `INSERT INTO unites (id_utilisateur, nom, symbole, description)
             VALUES (?, ?, ?, ?)`,
            [id_utilisateur, nom.trim(), symbole.trim(), description]
        );
        return result.insertId;
    }

    /**
     * ============================================================
     * METTRE À JOUR UNE UNITÉ
     * ============================================================
     */
    static async update(id, data, id_utilisateur) {
        const { nom, symbole, description = null } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const [result] = await pool.execute(
            `UPDATE unites
             SET nom = ?, symbole = ?, description = ?
             WHERE id_unite = ? AND id_utilisateur = ?`,
            [nom, symbole, description, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * SUPPRIMER UNE UNITÉ
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        const [result] = await pool.execute(
            `DELETE FROM unites
             WHERE id_unite = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * VÉRIFIER SI UNE UNITÉ EXISTE
     * ============================================================
     */
    static async exists(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM unites
             WHERE id_unite = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * VÉRIFIER SI UN NOM EXISTE
     * ============================================================
     */
    static async nomExists(nom, id_utilisateur, excludeId = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour nomExists');
        }

        let query = `SELECT COUNT(*) as count
                     FROM unites
                     WHERE nom = ? AND id_utilisateur = ?`;
        const params = [nom, id_utilisateur];

        if (excludeId) {
            query += ' AND id_unite != ?';
            params.push(excludeId);
        }

        const [rows] = await pool.execute(query, params);
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * VÉRIFIER SI UN SYMBOLE EXISTE
     * ============================================================
     */
    static async symboleExists(symbole, id_utilisateur, excludeId = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour symboleExists');
        }

        let query = `SELECT COUNT(*) as count
                     FROM unites
                     WHERE symbole = ? AND id_utilisateur = ?`;
        const params = [symbole, id_utilisateur];

        if (excludeId) {
            query += ' AND id_unite != ?';
            params.push(excludeId);
        }

        const [rows] = await pool.execute(query, params);
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * STATISTIQUES
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM unites
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        return {
            total: parseInt(rows[0].total) || 0
        };
    }

    /**
     * ============================================================
     * COMPTER
     * ============================================================
     */
    static async count(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour count');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM unites
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );
        return parseInt(rows[0].total) || 0;
    }

    /**
     * ============================================================
     * PAGINATION
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
             FROM unites
             WHERE id_utilisateur = ?
             ORDER BY nom ASC
             LIMIT ${limitInt} OFFSET ${offsetInt}`,
            [id_utilisateur]
        );
        return rows;
    }
}

export default Unite;