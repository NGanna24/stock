// models/Entrepot.js
import { pool } from '../config/db.js';
import crypto from 'crypto';

class Entrepot {
    /**
     * ============================================================
     * Générer un code d'accès unique (ex: "MIYO-A7X9K2")
     * ============================================================
     */
    static generateCodeAcces() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 (confusion)
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return `MIYO-${code}`;
    }

    static async generateUniqueCode() {
        let code;
        let exists = true;
        let attempts = 0;

        while (exists && attempts < 10) {
            code = this.generateCodeAcces();
            const [rows] = await pool.execute(
                'SELECT COUNT(*) as count FROM entrepots WHERE code_acces = ?',
                [code]
            );
            exists = rows[0].count > 0;
            attempts++;
        }

        if (exists) {
            throw new Error('Impossible de générer un code d\'accès unique');
        }
        return code;
    }

    /**
     * ============================================================
     * Créer un entrepôt + ajouter le créateur comme propriétaire
     * ============================================================
     */
    static async create(data, id_utilisateur_proprietaire) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { nom, adresse, ville, pays, code_postal } = data;

            if (!nom || !nom.trim()) {
                throw new Error('Le nom de l\'entrepôt est requis');
            }

            const code_acces = await this.generateUniqueCode();

            // 1. Créer l'entrepôt
            const [result] = await connection.execute(
                `INSERT INTO entrepots (
                    nom, adresse, ville, pays, code_postal,
                    code_acces, id_utilisateur_proprietaire
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    nom.trim(),
                    adresse || null,
                    ville || null,
                    pays || null,
                    code_postal || null,
                    code_acces,
                    id_utilisateur_proprietaire
                ]
            );

            const id_entrepot = result.insertId;

            // 2. Ajouter le créateur comme propriétaire
            await connection.execute(
                `INSERT INTO membres_entrepot (id_entrepot, id_utilisateur, role_membre)
                 VALUES (?, ?, 'proprietaire')`,
                [id_entrepot, id_utilisateur_proprietaire]
            );

            await connection.commit();
            return await this.findById(id_entrepot);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Rejoindre un entrepôt via son code d'accès
     * ============================================================
     */
    static async joinByCode(code_acces, id_utilisateur) {
        if (!code_acces || !code_acces.trim()) {
            throw new Error('Le code d\'accès est requis');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Trouver l'entrepôt
            const [entrepotRows] = await connection.execute(
                `SELECT id_entrepot, nom, actif
                 FROM entrepots
                 WHERE code_acces = ?`,
                [code_acces.trim().toUpperCase()]
            );

            if (entrepotRows.length === 0) {
                throw new Error('Code d\'accès invalide');
            }

            const entrepot = entrepotRows[0];
            if (!entrepot.actif) {
                throw new Error('Cet entrepôt est désactivé');
            }

            // 2. Vérifier si déjà membre
            const [membreRows] = await connection.execute(
                `SELECT id_membre FROM membres_entrepot
                 WHERE id_entrepot = ? AND id_utilisateur = ?`,
                [entrepot.id_entrepot, id_utilisateur]
            );

            if (membreRows.length > 0) {
                throw new Error('Vous êtes déjà membre de cet entrepôt');
            }

            // 3. Ajouter comme membre
            await connection.execute(
                `INSERT INTO membres_entrepot (id_entrepot, id_utilisateur, role_membre)
                 VALUES (?, ?, 'membre')`,
                [entrepot.id_entrepot, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(entrepot.id_entrepot);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Récupérer un entrepôt par ID
     * ============================================================
     */
    static async findById(id_entrepot, id_utilisateur = null) {
        // Si id_utilisateur est fourni, on vérifie que l'utilisateur est membre
        if (id_utilisateur) {
            const [rows] = await pool.execute(
                `SELECT e.*,
                        me.role_membre,
                        me.date_ajout as date_adhesion,
                        u.fullname as proprietaire_nom,
                        u.telephone as proprietaire_telephone
                 FROM entrepots e
                 INNER JOIN membres_entrepot me
                     ON me.id_entrepot = e.id_entrepot
                     AND me.id_utilisateur = ?
                     AND me.actif = TRUE
                 LEFT JOIN utilisateurs u ON e.id_utilisateur_proprietaire = u.id_utilisateur
                 WHERE e.id_entrepot = ?`,
                [id_utilisateur, id_entrepot]
            );
            return rows[0] || null;
        }

        // Sinon, accès direct (admin / super-admin)
        const [rows] = await pool.execute(
            `SELECT e.*,
                    u.fullname as proprietaire_nom,
                    u.telephone as proprietaire_telephone
             FROM entrepots e
             LEFT JOIN utilisateurs u ON e.id_utilisateur_proprietaire = u.id_utilisateur
             WHERE e.id_entrepot = ?`,
            [id_entrepot]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Lister tous les entrepôts d'un utilisateur (membre ou propriétaire)
     * ============================================================
     */
    static async findAllByUser(id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT e.*,
                    me.role_membre,
                    me.date_ajout as date_adhesion,
                    u.fullname as proprietaire_nom,
                    (SELECT COUNT(*) FROM membres_entrepot m2
                     WHERE m2.id_entrepot = e.id_entrepot AND m2.actif = TRUE) as nb_membres
             FROM entrepots e
             INNER JOIN membres_entrepot me
                 ON me.id_entrepot = e.id_entrepot
                 AND me.id_utilisateur = ?
                 AND me.actif = TRUE
             LEFT JOIN utilisateurs u ON e.id_utilisateur_proprietaire = u.id_utilisateur
             WHERE e.actif = TRUE
             ORDER BY me.role_membre = 'proprietaire' DESC, e.date_creation DESC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Lister les membres d'un entrepôt
     * ============================================================
     */
    static async findMembres(id_entrepot, id_utilisateur_demandeur) {
        // Vérifier que le demandeur est membre
        const estMembre = await this.isMembre(id_entrepot, id_utilisateur_demandeur);
        if (!estMembre) {
            throw new Error('Accès refusé à cet entrepôt');
        }

        const [rows] = await pool.execute(
            `SELECT me.*,
                    u.fullname,
                    u.telephone,
                    u.email,
                    u.slug
             FROM membres_entrepot me
             INNER JOIN utilisateurs u ON me.id_utilisateur = u.id_utilisateur
             WHERE me.id_entrepot = ? AND me.actif = TRUE
             ORDER BY me.role_membre = 'proprietaire' DESC, me.date_ajout ASC`,
            [id_entrepot]
        );
        return rows;
    }

    /**
     * ============================================================
     * Vérifier si un utilisateur est membre d'un entrepôt
     * ============================================================
     */
    static async isMembre(id_entrepot, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM membres_entrepot
             WHERE id_entrepot = ? AND id_utilisateur = ? AND actif = TRUE`,
            [id_entrepot, id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Vérifier si un utilisateur est propriétaire d'un entrepôt
     * ============================================================
     */
    static async isProprietaire(id_entrepot, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM membres_entrepot
             WHERE id_entrepot = ? AND id_utilisateur = ?
               AND actif = TRUE AND role_membre = 'proprietaire'`,
            [id_entrepot, id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Mettre à jour un entrepôt (propriétaire uniquement)
     * ============================================================
     */
    static async update(id_entrepot, data, id_utilisateur) {
        const isProprio = await this.isProprietaire(id_entrepot, id_utilisateur);
        if (!isProprio) {
            throw new Error('Seul le propriétaire peut modifier l\'entrepôt');
        }

        const { nom, adresse, ville, pays, code_postal } = data;

        const updates = [];
        const values = [];

        if (nom !== undefined) { updates.push('nom = ?'); values.push(nom.trim()); }
        if (adresse !== undefined) { updates.push('adresse = ?'); values.push(adresse || null); }
        if (ville !== undefined) { updates.push('ville = ?'); values.push(ville || null); }
        if (pays !== undefined) { updates.push('pays = ?'); values.push(pays || null); }
        if (code_postal !== undefined) { updates.push('code_postal = ?'); values.push(code_postal || null); }

        if (updates.length === 0) {
            return await this.findById(id_entrepot);
        }

        values.push(id_entrepot);

        await pool.execute(
            `UPDATE entrepots SET ${updates.join(', ')} WHERE id_entrepot = ?`,
            values
        );

        return await this.findById(id_entrepot);
    }

    /**
     * ============================================================
     * Régénérer le code d'accès (propriétaire uniquement)
     * ============================================================
     */
    static async regenererCodeAcces(id_entrepot, id_utilisateur) {
        const isProprio = await this.isProprietaire(id_entrepot, id_utilisateur);
        if (!isProprio) {
            throw new Error('Seul le propriétaire peut régénérer le code');
        }

        const newCode = await this.generateUniqueCode();
        await pool.execute(
            'UPDATE entrepots SET code_acces = ? WHERE id_entrepot = ?',
            [newCode, id_entrepot]
        );
        return newCode;
    }

    /**
     * ============================================================
     * Retirer un membre (propriétaire uniquement)
     * ============================================================
     */
    static async retirerMembre(id_entrepot, id_membre, id_utilisateur) {
        const isProprio = await this.isProprietaire(id_entrepot, id_utilisateur);
        if (!isProprio) {
            throw new Error('Seul le propriétaire peut retirer des membres');
        }

        // Ne pas se retirer soi-même
        const [rows] = await pool.execute(
            'SELECT id_utilisateur FROM membres_entrepot WHERE id_membre = ?',
            [id_membre]
        );
        if (rows[0]?.id_utilisateur === id_utilisateur) {
            throw new Error('Vous ne pouvez pas vous retirer vous-même');
        }

        await pool.execute(
            'UPDATE membres_entrepot SET actif = FALSE WHERE id_membre = ?',
            [id_membre]
        );
        return true;
    }
}

export default Entrepot;