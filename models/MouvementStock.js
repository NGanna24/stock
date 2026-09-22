// models/MouvementStock.js
import { pool } from '../config/db.js';

class MouvementStock {
    /**
     * ============================================================
     * MÉTHODE CENTRALE — Enregistre UNIQUEMENT l'historique
     * ============================================================
     * ⚠️ RÈGLE ABSOLUE :
     *   Cette méthode NE MODIFIE JAMAIS le stock du produit.
     *   Elle enregistre seulement le mouvement dans la table
     *   `mouvements_stock` pour la traçabilité.
     *
     *   C'est le modèle APPELANT qui doit faire le UPDATE du stock :
     *     - Reception.create          → UPDATE produits.quantite_stock
     *     - CommandeVente.create      → UPDATE produits.quantite_stock
     *     - CommandeVente.annuler     → UPDATE produits.quantite_stock
     *     - AjustementStock.create    → UPDATE produits.quantite_stock
     *     - TransfertStock.create     → UPDATE produits.quantite_stock
     *
     *   Sinon, le stock est modifié plusieurs fois → BUG.
     *
     * @param {object} data
     * @param {number} data.id_produit       - ID du produit
     * @param {string} data.type_mouvement   - 'entree' | 'sortie' | 'ajustement' | 'transfert'
     * @param {number} data.quantite         - Quantité (toujours positive)
     * @param {number} data.id_reference     - ID de l'entité source (optionnel)
     * @param {string} data.type_reference   - 'reception' | 'vente' | ... (optionnel)
     * @param {string} data.notes            - Notes libres (optionnel)
     * @param {object} connection            - Connexion MySQL en transaction (obligatoire)
     * @param {number} id_utilisateur        - ID du workspace (obligatoire)
     * @returns {Promise<number>}            - ID du mouvement créé
     */
/**
 * ============================================================
 * MÉTHODE CENTRALE — Enregistre UNIQUEMENT l'historique
 * ============================================================
 * ⚠️ Cette méthode NE MODIFIE JAMAIS le stock du produit.
 *    Elle enregistre seulement dans `mouvements_stock`.
 *
 * ✅ NOUVEAU : accepte les quantités NÉGATIVES pour les ajustements
 *    d'inventaire (manquant/surplus).
 */
static async enregistrer(data, connection, id_utilisateur) {
    // --- Validations de base ---
    if (!connection) {
        throw new Error('Une connexion MySQL en transaction est obligatoire');
    }
    if (!id_utilisateur) {
        throw new Error('id_utilisateur requis pour enregistrer un mouvement');
    }

    const {
        id_produit,
        type_mouvement,
        quantite,
        id_reference = null,
        type_reference = null,
        notes = null
    } = data;

    if (!id_produit) throw new Error('id_produit requis');
    if (!['entree', 'sortie', 'ajustement', 'transfert'].includes(type_mouvement)) {
        throw new Error(`Type de mouvement invalide: ${type_mouvement}`);
    }

    // ✅ Parse sécurisé
    const qte = parseFloat(quantite);

    if (isNaN(qte)) {
        throw new Error('La quantité doit être un nombre');
    }

    // ✅ Quantité nulle → on ignore (sans planter)
    if (qte === 0) {
        console.warn('⚠️ Mouvement ignoré (quantité nulle):', {
            id_produit, type_mouvement, id_reference
        });
        return null;
    }

    // ✅ Quantité négative AUTORISÉE uniquement pour les ajustements
    if (qte < 0 && type_mouvement !== 'ajustement') {
        throw new Error('La quantité doit être un nombre positif');
    }

    // --- Lire l'état ACTUEL du produit (traçabilité) ---
    const [rows] = await connection.execute(
        `SELECT quantite_stock
         FROM produits
         WHERE id_produit = ? AND id_utilisateur = ?`,
        [id_produit, id_utilisateur]
    );
    if (rows.length === 0) {
        throw new Error(
            `Produit ID ${id_produit} non trouvé dans le workspace ${id_utilisateur}`
        );
    }
    const quantite_actuelle = parseFloat(rows[0].quantite_stock) || 0;

    // Calcul de l'ancienne/nouvelle quantité selon le type
    let ancienne_quantite;
    let nouvelle_quantite;

    switch (type_mouvement) {
        case 'entree':
            nouvelle_quantite = quantite_actuelle;
            ancienne_quantite = quantite_actuelle - qte;
            break;
        case 'sortie':
            nouvelle_quantite = quantite_actuelle;
            ancienne_quantite = quantite_actuelle + qte;
            break;
        case 'ajustement':
            // ✅ Pour un ajustement, l'appelant a déjà mis à jour le stock.
            //    On stocke la valeur passée + l'état actuel.
            nouvelle_quantite = quantite_actuelle;
            ancienne_quantite = quantite_actuelle - qte;
            break;
        case 'transfert':
            nouvelle_quantite = quantite_actuelle;
            ancienne_quantite = quantite_actuelle;
            break;
        default:
            throw new Error(`Type de mouvement non géré: ${type_mouvement}`);
    }

    // ============================================================
    // ✅ INSERT UNIQUEMENT — AUCUN UPDATE DE STOCK ICI
    // ============================================================
    const [result] = await connection.execute(
        `INSERT INTO mouvements_stock (
            id_utilisateur, id_produit, type_mouvement, quantite,
            ancienne_quantite, nouvelle_quantite,
            id_reference, type_reference, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id_utilisateur,
            id_produit,
            type_mouvement,
            qte,                       // ✅ peut être négatif pour ajustement
            ancienne_quantite,
            nouvelle_quantite,
            id_reference,
            type_reference,
            notes
        ]
    );

    return result.insertId;
}

    /**
     * ============================================================
     * LECTURE (consultation uniquement — filtrée par workspace)
     * ============================================================
     */

    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        let query = `
            SELECT m.*,
                   p.nom AS produit_nom,
                   p.id_marque,
                   ma.nom AS marque_nom,
                   p.id_unite,
                   u.symbole AS unite_symbole,
                   ut.fullname AS utilisateur_nom,
                   DATE_FORMAT(m.date_mouvement, '%d/%m/%Y %H:%i') AS date_mouvement_formatee
            FROM mouvements_stock m
            LEFT JOIN produits p ON m.id_produit = p.id_produit
            LEFT JOIN marques ma ON p.id_marque = ma.id_marque
            LEFT JOIN unites u ON p.id_unite = u.id_unite
            LEFT JOIN utilisateurs ut ON m.id_utilisateur = ut.id_utilisateur
            WHERE m.id_utilisateur = ?
        `;
        const params = [id_utilisateur];

        if (filters.id_produit) {
            query += ' AND m.id_produit = ?';
            params.push(filters.id_produit);
        }
        if (filters.type_mouvement) {
            query += ' AND m.type_mouvement = ?';
            params.push(filters.type_mouvement);
        }
        if (filters.type_reference) {
            query += ' AND m.type_reference = ?';
            params.push(filters.type_reference);
        }
        if (filters.date_debut) {
            query += ' AND DATE(m.date_mouvement) >= ?';
            params.push(filters.date_debut);
        }
        if (filters.date_fin) {
            query += ' AND DATE(m.date_mouvement) <= ?';
            params.push(filters.date_fin);
        }
        if (filters.search) {
            query += ' AND (p.nom LIKE ? OR ut.fullname LIKE ? OR m.notes LIKE ?)';
            const s = `%${filters.search}%`;
            params.push(s, s, s);
        }

        query += ' ORDER BY m.date_mouvement DESC, m.id_mouvement DESC';

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
    }

    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT m.*,
                    p.nom AS produit_nom,
                    ma.nom AS marque_nom,
                    u.symbole AS unite_symbole,
                    ut.fullname AS utilisateur_nom
             FROM mouvements_stock m
             LEFT JOIN produits p ON m.id_produit = p.id_produit
             LEFT JOIN marques ma ON p.id_marque = ma.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN utilisateurs ut ON m.id_utilisateur = ut.id_utilisateur
             WHERE m.id_mouvement = ?
               AND m.id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0];
    }

    static async findByProduit(id_produit, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByProduit');
        }

        const [rows] = await pool.execute(
            `SELECT m.*, ut.fullname AS utilisateur_nom,
                    DATE_FORMAT(m.date_mouvement, '%d/%m/%Y %H:%i') AS date_mouvement_formatee
             FROM mouvements_stock m
             LEFT JOIN utilisateurs ut ON m.id_utilisateur = ut.id_utilisateur
             WHERE m.id_produit = ?
               AND m.id_utilisateur = ?
             ORDER BY m.date_mouvement DESC`,
            [id_produit, id_utilisateur]
        );
        return rows;
    }

    static async getStats(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN type_mouvement = 'entree'     THEN 1 ELSE 0 END) AS total_entrees,
                SUM(CASE WHEN type_mouvement = 'sortie'     THEN 1 ELSE 0 END) AS total_sorties,
                SUM(CASE WHEN type_mouvement = 'ajustement' THEN 1 ELSE 0 END) AS total_ajustements,
                SUM(CASE WHEN type_mouvement = 'transfert'  THEN 1 ELSE 0 END) AS total_transferts,
                COALESCE(SUM(CASE WHEN type_mouvement = 'entree' THEN quantite ELSE 0 END), 0) AS qte_entrees,
                COALESCE(SUM(CASE WHEN type_mouvement = 'sortie' THEN quantite ELSE 0 END), 0) AS qte_sorties,
                SUM(CASE WHEN DATE(date_mouvement) = CURDATE() THEN 1 ELSE 0 END) AS aujourdhui
             FROM mouvements_stock
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            total_entrees: parseInt(s.total_entrees) || 0,
            total_sorties: parseInt(s.total_sorties) || 0,
            total_ajustements: parseInt(s.total_ajustements) || 0,
            total_transferts: parseInt(s.total_transferts) || 0,
            qte_entrees: parseFloat(s.qte_entrees) || 0,
            qte_sorties: parseFloat(s.qte_sorties) || 0,
            aujourdhui: parseInt(s.aujourdhui) || 0
        };
    }

    static async getDerniers(limit = 5, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getDerniers');
        }

        const limitInt = Math.max(1, Math.min(100, parseInt(limit, 10) || 5));

        const [rows] = await pool.query(
            `SELECT m.*,
                    p.nom AS produit_nom,
                    ma.nom AS marque_nom,
                    u.symbole AS unite_symbole,
                    ut.fullname AS utilisateur_nom,
                    DATE_FORMAT(m.date_mouvement, '%d/%m/%Y %H:%i') AS date_formatee
             FROM mouvements_stock m
             LEFT JOIN produits p ON m.id_produit = p.id_produit
             LEFT JOIN marques ma ON p.id_marque = ma.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN utilisateurs ut ON m.id_utilisateur = ut.id_utilisateur
             WHERE m.id_utilisateur = ?
             ORDER BY m.date_mouvement DESC
             LIMIT ${limitInt}`,
            [id_utilisateur]
        );
        return rows;
    }
}

export default MouvementStock;