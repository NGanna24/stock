// models/Categorie.js
import { pool } from '../config/db.js';

class Categorie {
    /**
     * ============================================================
     * Récupérer toutes les catégories d'un utilisateur
     * ============================================================
     */
    static async findAll(idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT c.*,
                        COUNT(DISTINCT p.id_produit) as nb_produits
                 FROM categories c
                 LEFT JOIN produits p ON p.id_categorie = c.id_categorie
                 WHERE c.id_utilisateur = ?
                 GROUP BY c.id_categorie
                 ORDER BY c.nom ASC`,
                [idUtilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding categories:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer une catégorie par son ID
     * ============================================================
     */
    static async findById(idCategorie, idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT c.*,
                        COUNT(DISTINCT p.id_produit) as nb_produits
                 FROM categories c
                 LEFT JOIN produits p ON p.id_categorie = c.id_categorie
                 WHERE c.id_categorie = ? AND c.id_utilisateur = ?
                 GROUP BY c.id_categorie`,
                [idCategorie, idUtilisateur]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding category by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer une catégorie par son nom
     * ============================================================
     */
    static async findByNom(nom, idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour findByNom');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT c.*,
                        COUNT(DISTINCT p.id_produit) as nb_produits
                 FROM categories c
                 LEFT JOIN produits p ON p.id_categorie = c.id_categorie
                 WHERE c.nom = ? AND c.id_utilisateur = ?
                 GROUP BY c.id_categorie`,
                [nom, idUtilisateur]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding category by nom:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les catégories actives uniquement
     * ============================================================
     */
    static async findActives(idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour findActives');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT c.*,
                        COUNT(DISTINCT p.id_produit) as nb_produits
                 FROM categories c
                 LEFT JOIN produits p ON p.id_categorie = c.id_categorie
                 WHERE c.id_utilisateur = ? AND c.statut = 'actif'
                 GROUP BY c.id_categorie
                 ORDER BY c.nom ASC`,
                [idUtilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding actives categories:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Créer une nouvelle catégorie
     * ============================================================
     */
    static async create({ idUtilisateur, nom, description }) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }
        if (!nom || nom.trim() === '') {
            throw new Error('Le nom est obligatoire');
        }

        try {
            const [result] = await pool.execute(
                `INSERT INTO categories (id_utilisateur, nom, description)
                 VALUES (?, ?, ?)`,
                [idUtilisateur, nom.trim(), description || null]
            );

            return result.insertId;
        } catch (error) {
            console.error('❌ Error creating category:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour une catégorie
     * ============================================================
     */
    static async update(idCategorie, idUtilisateur, data) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        try {
            const updates = [];
            const values = [];

            if (data.nom !== undefined) {
                updates.push('nom = ?');
                values.push(data.nom);
            }

            if (data.description !== undefined) {
                updates.push('description = ?');
                values.push(data.description);
            }

            if (data.statut !== undefined) {
                updates.push('statut = ?');
                values.push(data.statut);
            }

            if (updates.length === 0) {
                return await this.findById(idCategorie, idUtilisateur);
            }

            values.push(idCategorie);
            values.push(idUtilisateur);

            const [result] = await pool.execute(
                `UPDATE categories SET ${updates.join(', ')}
                 WHERE id_categorie = ? AND id_utilisateur = ?`,
                values
            );

            if (result.affectedRows === 0) {
                return null;
            }

            return await this.findById(idCategorie, idUtilisateur);
        } catch (error) {
            console.error('❌ Error updating category:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une catégorie
     * ============================================================
     */
    static async updateStatus(id, userId, statut) {
        if (!userId) {
            throw new Error('id_utilisateur requis pour updateStatus');
        }

        if (!['actif', 'inactif'].includes(statut)) {
            throw new Error('Statut invalide (actif | inactif)');
        }

        try {
            const query = `
                UPDATE categories
                SET statut = ?, date_modification = NOW()
                WHERE id_categorie = ? AND id_utilisateur = ?
            `;

            const [result] = await pool.execute(query, [statut, id, userId]);

            if (result.affectedRows === 0) {
                return null;
            }

            return await this.findById(id, userId);
        } catch (error) {
            console.error('❌ UpdateStatus error:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Supprimer une catégorie (vérifie qu'elle est vide)
     * ============================================================
     */
    static async delete(idCategorie, idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            // ✅ Vérifier si la catégorie a des produits DANS CE WORKSPACE
            const [produits] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM produits
                 WHERE id_categorie = ? AND id_utilisateur = ?`,
                [idCategorie, idUtilisateur]
            );

            if (produits[0].count > 0) {
                throw new Error(
                    `Impossible de supprimer la catégorie car elle contient ${produits[0].count} produits`
                );
            }

            const [result] = await pool.execute(
                `DELETE FROM categories
                 WHERE id_categorie = ? AND id_utilisateur = ?`,
                [idCategorie, idUtilisateur]
            );

            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error deleting category:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Vérifier si une catégorie existe dans le workspace
     * ============================================================
     */
    static async exists(idCategorie, idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM categories
                 WHERE id_categorie = ? AND id_utilisateur = ?`,
                [idCategorie, idUtilisateur]
            );
            return rows[0].count > 0;
        } catch (error) {
            console.error('❌ Error in exists:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Vérifier si un nom existe déjà (dans le workspace)
     * ============================================================
     */
    static async nomExists(nom, idUtilisateur, excludeId = null) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour nomExists');
        }

        try {
            let query = `SELECT COUNT(*) as count
                         FROM categories
                         WHERE nom = ? AND id_utilisateur = ?`;
            const params = [nom, idUtilisateur];

            if (excludeId) {
                query += ' AND id_categorie != ?';
                params.push(excludeId);
            }

            const [rows] = await pool.execute(query, params);
            return rows[0].count > 0;
        } catch (error) {
            console.error('❌ Error in nomExists:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Vérifier si une catégorie a des produits (dans le workspace)
     * ============================================================
     */
    static async hasProducts(idCategorie, idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour hasProducts');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM produits
                 WHERE id_categorie = ? AND id_utilisateur = ?`,
                [idCategorie, idUtilisateur]
            );
            return rows[0].count > 0;
        } catch (error) {
            console.error('❌ Error checking products:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Compter le nombre de catégories
     * ============================================================
     */
    static async count(idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour count');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT COUNT(*) as total
                 FROM categories
                 WHERE id_utilisateur = ?`,
                [idUtilisateur]
            );
            return parseInt(rows[0].total) || 0;
        } catch (error) {
            console.error('❌ Error counting categories:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Rechercher des catégories par mot-clé
     * ============================================================
     */
    static async search(idUtilisateur, keyword) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT c.*,
                        COUNT(DISTINCT p.id_produit) as nb_produits
                 FROM categories c
                 LEFT JOIN produits p ON p.id_categorie = c.id_categorie
                 WHERE c.id_utilisateur = ?
                   AND (c.nom LIKE ? OR c.description LIKE ?)
                 GROUP BY c.id_categorie
                 ORDER BY c.nom ASC`,
                [idUtilisateur, `%${keyword}%`, `%${keyword}%`]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error searching categories:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Statistiques des catégories (par workspace)
     * ============================================================
     */
    static async getStats(idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN statut = 'actif'   THEN 1 ELSE 0 END) as actifs,
                    SUM(CASE WHEN statut = 'inactif' THEN 1 ELSE 0 END) as inactifs
                 FROM categories
                 WHERE id_utilisateur = ?`,
                [idUtilisateur]
            );

            const s = rows[0];
            return {
                total: parseInt(s.total) || 0,
                actifs: parseInt(s.actifs) || 0,
                inactifs: parseInt(s.inactifs) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Pagination des catégories
     * ============================================================
     */
    static async findPaginated(limit, offset, idUtilisateur) {
        if (!idUtilisateur) {
            throw new Error('id_utilisateur requis pour findPaginated');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
        const offsetInt = Math.max(0, parseInt(offset, 10) || 0);

        try {
            const [rows] = await pool.query(
                `SELECT c.*,
                        COUNT(DISTINCT p.id_produit) as nb_produits
                 FROM categories c
                 LEFT JOIN produits p ON p.id_categorie = c.id_categorie
                 WHERE c.id_utilisateur = ?
                 GROUP BY c.id_categorie
                 ORDER BY c.nom ASC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`,
                [idUtilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error in findPaginated:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * SEED — Catégories par défaut pour pièces détachées MOTO
     * ============================================================
     * Appelée automatiquement à l'inscription d'un nouveau propriétaire.
     */
    static CATEGORIES_DEFAUT = [
        // MOTEUR
        { nom: 'Moteur',           description: 'Pièces moteur (piston, cylindre, culasse, vilebrequin)' },
        { nom: 'Kit moteur',       description: 'Kits de révision moteur' },
        { nom: 'Allumage',         description: 'Bougies, bobines, CDI, volant magnétique' },
        { nom: 'Carburation',      description: 'Carburateurs, injecteurs, gicleurs' },
        { nom: 'Filtration',       description: 'Filtres à air, à huile, à essence' },

        // TRANSMISSION
        { nom: 'Transmission',     description: 'Chaînes, courroies, pignons, plateaux' },
        { nom: 'Embrayage',        description: "Disques, ressorts, câbles d'embrayage" },
        { nom: 'Boîte de vitesses', description: 'Engrenages, arbres, fourchettes' },

        // FREINAGE
        { nom: 'Freinage',         description: 'Plaquettes, disques, étriers, maîtres-cylindres' },
        { nom: 'Liquide de frein', description: 'Liquides DOT3, DOT4, DOT5' },

        // SUSPENSION
        { nom: 'Suspension',       description: 'Amortisseurs, ressorts, fourches' },
        { nom: 'Roulements',       description: 'Roulements de roue, de direction, de colonne' },

        // ROUES & PNEUS
        { nom: 'Pneus',            description: 'Pneus avant et arrière' },
        { nom: 'Chambres à air',   description: 'Chambres à air' },
        { nom: 'Jantes',           description: 'Jantes, rayons, moyeux' },

        // ÉLECTRICITÉ
        { nom: 'Électricité',      description: 'Batteries, phares, clignotants, faisceaux' },
        { nom: 'Éclairage',        description: 'Ampoules, phares, feux arrière, LED' },
        { nom: 'Démarreur',        description: 'Démarreurs, relais, contacteurs' },

        // CARROSSERIE
        { nom: 'Carrosserie',      description: 'Carénages, garde-boue, selles, réservoirs' },
        { nom: 'Rétroviseurs',     description: 'Rétroviseurs gauche/droite' },
        { nom: 'Guidon & Commandes', description: 'Poignées, leviers, commodos, câbles' },

        // LUBRIFIANTS
        { nom: 'Huiles moteur',    description: 'Huiles 2T, 4T, synthétiques, minérales' },
        { nom: 'Huiles de boîte',  description: 'Huiles de transmission' },
        { nom: 'Graisses',         description: 'Graisses multi-usage, chaîne' },
        { nom: "Produits d'entretien", description: 'Nettoyants, dégraissants, polish' },

        // ACCESSOIRES
        { nom: 'Accessoires',      description: 'Top-cases, sacoches, supports téléphone' },
        { nom: 'Visserie',         description: 'Boulons, écrous, rondelles, vis' },
        { nom: 'Joints & Étanchéité', description: 'Joints spi, joints toriques, joints de culasse' },

        // ÉQUIPEMENT PILOTE
        { nom: 'Casques',          description: 'Casques intégraux, modulables, jet' },
        { nom: 'Gants',            description: 'Gants été/hiver' },
        { nom: 'Blousons',         description: 'Blousons de protection' },
        { nom: 'Bottes',           description: 'Bottes et chaussures moto' },

        // DIVERS
        { nom: 'Outillage',        description: 'Clés, tournevis, outils spécifiques' },
        { nom: 'Divers',           description: 'Pièces et accessoires divers' },
    ];

    /**
     * ============================================================
     * SEED — Insérer les catégories par défaut pour un utilisateur
     * ============================================================
     * @param {number} id_utilisateur - ID du propriétaire (workspace)
     * @param {object} connection - (optionnel) Connexion MySQL en transaction
     * @returns {Promise<number>} Nombre de catégories insérées
     */
    static async seedDefaultCategories(id_utilisateur, connection = null) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour seedDefaultCategories');
        }

        const conn = connection || pool;
        let count = 0;

        for (const cat of this.CATEGORIES_DEFAUT) {
            try {
                const [result] = await conn.execute(
                    `INSERT IGNORE INTO categories (id_utilisateur, nom, description, statut)
                     VALUES (?, ?, ?, 'actif')`,
                    [id_utilisateur, cat.nom, cat.description]
                );
                if (result.affectedRows > 0) count++;
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') {
                    console.error(`⚠️ Erreur insertion catégorie "${cat.nom}":`, error.message);
                }
            }
        }

        console.log(`✅ ${count} catégories par défaut insérées pour l'utilisateur ${id_utilisateur}`);
        return count;
    }

    /**
     * ============================================================
     * Vérifier si l'utilisateur a déjà des catégories
     * ============================================================
     */
    static async utilisateurADesCategories(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM categories
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
        const deja = await this.utilisateurADesCategories(id_utilisateur);
        if (deja) {
            console.log(`ℹ️ L'utilisateur ${id_utilisateur} a déjà des catégories — seed ignoré`);
            return 0;
        }
        return await this.seedDefaultCategories(id_utilisateur, connection);
    }
}

export default Categorie;