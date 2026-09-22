// models/Fournisseur.js
import { pool } from '../config/db.js';

class Fournisseur {
    /**
     * ============================================================
     * Créer un nouveau fournisseur dans le workspace
     * ============================================================
     */
    static async create(fournisseurData, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }

        try {
            const {
                nom,
                telephone,
                email,
                ville,
                pays,
                numero_tva,
                actif = true
            } = fournisseurData;

            if (!nom || nom.trim() === '') {
                throw new Error('Le nom est obligatoire');
            }

            const [result] = await pool.execute(
                `INSERT INTO fournisseurs (
                    id_utilisateur, nom, telephone, email, ville, pays, numero_tva, actif
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id_utilisateur,
                    nom.trim(),
                    telephone || null,
                    email || null,
                    ville || null,
                    pays || null,
                    numero_tva || null,
                    actif ? 1 : 0
                ]
            );

            return await this.findById(result.insertId, id_utilisateur);
        } catch (error) {
            console.error('❌ Error creating fournisseur:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer tous les fournisseurs (par workspace)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            let query = `
                SELECT f.*,
                       COUNT(DISTINCT c.id_commande_achat) as nombre_commandes
                FROM fournisseurs f
                LEFT JOIN commandes_achat c ON f.id_fournisseur = c.id_fournisseur
                                            AND c.id_utilisateur = ?
                WHERE f.id_utilisateur = ?              -- ✅ ISOLATION
            `;
            const params = [id_utilisateur, id_utilisateur];

            if (filters.nom) {
                query += ' AND f.nom LIKE ?';
                params.push(`%${filters.nom}%`);
            }

            if (filters.telephone) {
                query += ' AND f.telephone LIKE ?';
                params.push(`%${filters.telephone}%`);
            }

            if (filters.email) {
                query += ' AND f.email LIKE ?';
                params.push(`%${filters.email}%`);
            }

            if (filters.ville) {
                query += ' AND f.ville LIKE ?';
                params.push(`%${filters.ville}%`);
            }

            if (filters.pays) {
                query += ' AND f.pays LIKE ?';
                params.push(`%${filters.pays}%`);
            }

            if (filters.actif !== undefined && filters.actif !== null) {
                query += ' AND f.actif = ?';
                params.push(filters.actif ? 1 : 0);
            }

            if (filters.search) {
                query += ` AND (f.nom LIKE ?
                            OR f.email LIKE ?
                            OR f.telephone LIKE ?
                            OR f.ville LIKE ?
                            OR f.pays LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s, s, s);
            }

            query += ' GROUP BY f.id_fournisseur ORDER BY f.nom ASC';

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
            console.error('❌ Error finding fournisseurs:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer un fournisseur par ID (workspace)
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT f.*,
                        COUNT(DISTINCT c.id_commande_achat) as nombre_commandes
                 FROM fournisseurs f
                 LEFT JOIN commandes_achat c ON f.id_fournisseur = c.id_fournisseur
                                            AND c.id_utilisateur = ?
                 WHERE f.id_fournisseur = ?
                   AND f.id_utilisateur = ?
                 GROUP BY f.id_fournisseur`,
                [id_utilisateur, id, id_utilisateur]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding fournisseur by ID:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer un fournisseur par email (workspace)
     * ============================================================
     */
    static async findByEmail(email, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByEmail');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE email = ? AND id_utilisateur = ?`,
                [email, id_utilisateur]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding fournisseur by email:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer un fournisseur par téléphone (workspace)
     * ============================================================
     */
    static async findByPhone(telephone, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByPhone');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE telephone = ? AND id_utilisateur = ?`,
                [telephone, id_utilisateur]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding fournisseur by phone:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer un fournisseur par TVA (workspace)
     * ============================================================
     */
    static async findByTva(numero_tva, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByTva');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE numero_tva = ? AND id_utilisateur = ?`,
                [numero_tva, id_utilisateur]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding fournisseur by TVA:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les fournisseurs actifs (workspace)
     * ============================================================
     */
    static async findActive(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findActive');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE actif = 1 AND id_utilisateur = ?
                 ORDER BY nom ASC`,
                [id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding active fournisseurs:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Mettre à jour un fournisseur (workspace)
     * ============================================================
     */
    static async update(id, fournisseurData, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        try {
            const {
                nom,
                telephone,
                email,
                ville,
                pays,
                numero_tva,
                actif
            } = fournisseurData;

            const updates = [];
            const values = [];

            if (nom !== undefined) {
                updates.push('nom = ?');
                values.push(nom);
            }
            if (telephone !== undefined) {
                updates.push('telephone = ?');
                values.push(telephone || null);
            }
            if (email !== undefined) {
                updates.push('email = ?');
                values.push(email || null);
            }
            if (ville !== undefined) {
                updates.push('ville = ?');
                values.push(ville || null);
            }
            if (pays !== undefined) {
                updates.push('pays = ?');
                values.push(pays || null);
            }
            if (numero_tva !== undefined) {
                updates.push('numero_tva = ?');
                values.push(numero_tva || null);
            }
            if (actif !== undefined && actif !== null) {
                updates.push('actif = ?');
                values.push(actif ? 1 : 0);
            }

            if (updates.length === 0) {
                return await this.findById(id, id_utilisateur);
            }

            values.push(id);
            values.push(id_utilisateur);

            const [result] = await pool.execute(
                `UPDATE fournisseurs
                 SET ${updates.join(', ')}
                 WHERE id_fournisseur = ? AND id_utilisateur = ?`,   // ✅ ISOLATION
                values
            );

            if (result.affectedRows === 0) {
                return null;
            }

            return await this.findById(id, id_utilisateur);
        } catch (error) {
            console.error('❌ Error updating fournisseur:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Désactiver un fournisseur (workspace)
     * ============================================================
     */
    static async deactivate(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour deactivate');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE fournisseurs SET actif = 0
                 WHERE id_fournisseur = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error deactivating fournisseur:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Activer un fournisseur (workspace)
     * ============================================================
     */
    static async activate(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour activate');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE fournisseurs SET actif = 1
                 WHERE id_fournisseur = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error activating fournisseur:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Supprimer un fournisseur (workspace)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            const [result] = await pool.execute(
                `DELETE FROM fournisseurs
                 WHERE id_fournisseur = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error deleting fournisseur:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Vérifier si un fournisseur existe (workspace)
     * ============================================================
     */
    static async exists(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour exists');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM fournisseurs
                 WHERE id_fournisseur = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            return rows[0].count > 0;
        } catch (error) {
            console.error('❌ Error checking fournisseur existence:', error);
            throw error;
        }
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

        try {
            let query = `SELECT COUNT(*) as count
                         FROM fournisseurs
                         WHERE nom = ? AND id_utilisateur = ?`;
            const params = [nom, id_utilisateur];

            if (excludeId) {
                query += ' AND id_fournisseur != ?';
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
     * Compter le nombre total de fournisseurs (workspace)
     * ============================================================
     */
    static async count(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour count');
        }

        try {
            let query = `SELECT COUNT(*) as total
                         FROM fournisseurs
                         WHERE id_utilisateur = ?`;      // ✅ ISOLATION
            const params = [id_utilisateur];

            if (filters.actif !== undefined && filters.actif !== null) {
                query += ' AND actif = ?';
                params.push(filters.actif ? 1 : 0);
            }

            if (filters.search) {
                query += ' AND (nom LIKE ? OR email LIKE ? OR telephone LIKE ?)';
                const s = `%${filters.search}%`;
                params.push(s, s, s);
            }

            const [rows] = await pool.execute(query, params);
            return parseInt(rows[0].total) || 0;
        } catch (error) {
            console.error('❌ Error counting fournisseurs:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Statistiques des fournisseurs (workspace)
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
                    SUM(CASE WHEN actif = 1 THEN 1 ELSE 0 END) as actifs,
                    SUM(CASE WHEN actif = 0 THEN 1 ELSE 0 END) as inactifs,
                    COUNT(DISTINCT pays) as pays_distincts,
                    COUNT(DISTINCT ville) as villes_distinctes
                 FROM fournisseurs
                 WHERE id_utilisateur = ?`,             // ✅ ISOLATION
                [id_utilisateur]
            );

            const s = rows[0];
            return {
                total: parseInt(s.total) || 0,
                actifs: parseInt(s.actifs) || 0,
                inactifs: parseInt(s.inactifs) || 0,
                pays_distincts: parseInt(s.pays_distincts) || 0,
                villes_distinctes: parseInt(s.villes_distinctes) || 0
            };
        } catch (error) {
            console.error('❌ Error getting fournisseur stats:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les fournisseurs par pays (workspace)
     * ============================================================
     */
    static async findByCountry(pays, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCountry');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE pays = ? AND actif = 1 AND id_utilisateur = ?
                 ORDER BY nom ASC`,
                [pays, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding fournisseurs by country:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les fournisseurs par ville (workspace)
     * ============================================================
     */
    static async findByCity(ville, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCity');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE ville = ? AND actif = 1 AND id_utilisateur = ?
                 ORDER BY nom ASC`,
                [ville, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding fournisseurs by city:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les pays distincts (workspace)
     * ============================================================
     */
    static async getDistinctCountries(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getDistinctCountries');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT DISTINCT pays
                 FROM fournisseurs
                 WHERE pays IS NOT NULL AND pays != ''
                   AND id_utilisateur = ?
                 ORDER BY pays ASC`,
                [id_utilisateur]
            );
            return rows.map(row => row.pays);
        } catch (error) {
            console.error('❌ Error getting distinct countries:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Récupérer les villes distinctes (workspace)
     * ============================================================
     */
    static async getDistinctCities(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getDistinctCities');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT DISTINCT ville
                 FROM fournisseurs
                 WHERE ville IS NOT NULL AND ville != ''
                   AND id_utilisateur = ?
                 ORDER BY ville ASC`,
                [id_utilisateur]
            );
            return rows.map(row => row.ville);
        } catch (error) {
            console.error('❌ Error getting distinct cities:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Rechercher des fournisseurs par mot-clé (workspace)
     * ============================================================
     */
    static async search(keyword, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour search');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM fournisseurs
                 WHERE id_utilisateur = ?
                   AND (nom LIKE ?
                        OR email LIKE ?
                        OR telephone LIKE ?
                        OR ville LIKE ?
                        OR pays LIKE ?)
                 ORDER BY nom ASC`,
                [
                    id_utilisateur,
                    `%${keyword}%`,
                    `%${keyword}%`,
                    `%${keyword}%`,
                    `%${keyword}%`,
                    `%${keyword}%`
                ]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error searching fournisseurs:', error);
            throw error;
        }
    }

    /**
     * ============================================================
     * Pagination des fournisseurs (workspace)
     * ============================================================
     */
    static async findWithPagination(page = 1, limit = 10, filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findWithPagination');
        }

        try {
            const pageInt = Math.max(1, parseInt(page, 10) || 1);
            const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
            const offset = (pageInt - 1) * limitInt;

            const [rows] = await pool.query(
                `SELECT * FROM fournisseurs
                 WHERE id_utilisateur = ?
                 ORDER BY nom ASC
                 LIMIT ${limitInt} OFFSET ${offset}`,
                [id_utilisateur]
            );

            const total = await this.count(filters, id_utilisateur);

            return {
                data: rows,
                pagination: {
                    page: pageInt,
                    limit: limitInt,
                    total,
                    totalPages: Math.ceil(total / limitInt)
                }
            };
        } catch (error) {
            console.error('❌ Error finding fournisseurs with pagination:', error);
            throw error;
        }
    }

    /**
 * ============================================================
 * ✅ Récupérer les produits réellement reçus d'un fournisseur
 *    avec la quantité nette retournable
 * ============================================================
 * Retourne pour chaque produit :
 *  - quantite_recue        : total reçu (unité de base)
 *  - quantite_deja_retournee : total déjà retourné
 *  - quantite_nette_recue  : reçu - déjà retourné
 *  - quantite_stock        : stock physique actuel
 *  - quantite_max_retournable : MIN(stock, nette_recue)
 *  - prix_achat            : prix unitaire actuel
 *  - infos réception récente (id_reception, id_ligne_achat, id_commande_achat)
 */
static async getProduitsRecus(id_fournisseur, id_utilisateur) {
    if (!id_utilisateur) {
        throw new Error('id_utilisateur requis pour getProduitsRecus');
    }

    try {
        const [rows] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom,
                p.quantite_stock,
                p.prix_achat,
                p.id_unite,
                u.symbole AS unite_symbole,
                u.nom AS unite_nom,

                -- Quantité totale reçue du fournisseur (hors réceptions annulées)
                COALESCE(SUM(rl.quantite_totale_base), 0) AS quantite_recue,

                -- Quantité déjà retournée à ce fournisseur (hors retours annulés)
                COALESCE((
                    SELECT SUM(rl2.quantite)
                    FROM retour_lignes rl2
                    INNER JOIN retours_fournisseurs rf
                        ON rl2.id_retour = rf.id_retour
                    WHERE rl2.id_produit = p.id_produit
                      AND rf.id_fournisseur = ?
                      AND rf.id_utilisateur = ?
                      AND rf.statut != 'annule'
                ), 0) AS quantite_deja_retournee,

                -- Dernière réception (pour traçabilité)
                MAX(r.id_reception) AS id_reception_recente,
                MAX(r.date_reception) AS derniere_reception,
                MAX(ca.id_commande_achat) AS id_commande_achat_recente

             FROM produits p
             INNER JOIN reception_lignes rl ON rl.id_produit = p.id_produit
             INNER JOIN receptions r ON rl.id_reception = r.id_reception
             INNER JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             WHERE r.id_utilisateur = ?
               AND ca.id_fournisseur = ?
               AND r.statut != 'annulee'
               AND ca.statut != 'annulee'
             GROUP BY p.id_produit, p.nom, p.quantite_stock, p.prix_achat,
                      p.id_unite, u.symbole, u.nom
             HAVING quantite_recue > 0`,
            [
                id_fournisseur, id_utilisateur,   // sous-requête retours
                id_utilisateur, id_fournisseur    // WHERE principal
            ]
        );

        // Enrichissement : calculer la quantité max retournable
        return rows.map(r => {
            const recue = parseFloat(r.quantite_recue) || 0;
            const dejaRetournee = parseFloat(r.quantite_deja_retournee) || 0;
            const stock = parseFloat(r.quantite_stock) || 0;

            const netteRecue = Math.max(0, recue - dejaRetournee);
            const maxRetournable = Math.min(stock, netteRecue);

            return {
                id_produit: r.id_produit,
                nom: r.nom,
                id_unite: r.id_unite,
                unite_symbole: r.unite_symbole || '',
                unite_nom: r.unite_nom || 'Unité',

                quantite_stock: stock,
                quantite_recue: recue,
                quantite_deja_retournee: dejaRetournee,
                quantite_nette_recue: netteRecue,
                quantite_max_retournable: Math.floor(maxRetournable),

                prix_achat: parseFloat(r.prix_achat) || 0,

                id_reception_recente: r.id_reception_recente,
                derniere_reception: r.derniere_reception,
                id_commande_achat_recente: r.id_commande_achat_recente,
            };
        }).filter(p => p.quantite_max_retournable > 0);

    } catch (error) {
        console.error('❌ Error getting produits recus:', error);
        throw error;
    }
}
}

export default Fournisseur; 