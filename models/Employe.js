// models/Employe.js
import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';

class Employe {
    /**
     * ============================================================
     * Générer un slug à partir du nom
     * ============================================================
     */
    static generateSlug(fullname) {
        return fullname
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * ============================================================
     * Créer un slug unique DANS le workspace du patron
     * ============================================================
     */
    static async createUniqueSlug(fullname, id_utilisateur) {
        let baseSlug = this.generateSlug(fullname);
        let slug = baseSlug;
        let counter = 1;

        while (true) {
            const [rows] = await pool.execute(
                'SELECT COUNT(*) as count FROM employes WHERE slug = ? AND id_utilisateur = ?',
                [slug, id_utilisateur]
            );
            if (rows[0].count === 0) break;
            slug = `${baseSlug}-${counter}`;
            counter++;
        }
        return slug;
    }

    /**
     * ============================================================
     * Récupérer l'ID d'un rôle par son nom
     * ============================================================
     */
    static async getRoleId(roleName) {
        const [rows] = await pool.execute(
            'SELECT id_role FROM roles WHERE nom = ? AND actif = 1',
            [roleName]
        );
        return rows[0]?.id_role || null;
    }

    /**
     * ============================================================
     * Vérifier si un téléphone existe déjà pour un patron donné
     * ============================================================
     */
    static async telephoneExists(telephone, id_utilisateur, excludeId = null) {
        let query = `SELECT COUNT(*) AS count 
                     FROM employes 
                     WHERE telephone = ? AND id_utilisateur = ?`;
        const params = [telephone, id_utilisateur];

        if (excludeId) {
            query += ' AND id_employe != ?';
            params.push(excludeId);
        }

        const [rows] = await pool.execute(query, params);
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Trouver un employé par téléphone (pour le login)
     * ============================================================
     */
    static async findByTelephone(telephone) {
        const [rows] = await pool.execute(
            `SELECT e.*, 
                    r.nom AS role_nom,
                    u.id_utilisateur AS id_patron,
                    u.slug AS slug_patron
             FROM employes e
             JOIN roles r ON e.id_role = r.id_role
             JOIN utilisateurs u ON e.id_utilisateur = u.id_utilisateur
             WHERE e.telephone = ?
             LIMIT 1`,
            [telephone]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Trouver un employé par ID (pour le middleware auth)
     * ============================================================
     */
    static async findById(id) {
        const [rows] = await pool.execute(
            `SELECT e.*, 
                    r.nom AS role_nom,
                    u.id_utilisateur AS id_patron,
                    u.slug AS slug_patron
             FROM employes e
             JOIN roles r ON e.id_role = r.id_role
             JOIN utilisateurs u ON e.id_utilisateur = u.id_utilisateur
             WHERE e.id_employe = ?
             LIMIT 1`,
            [id]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Trouver un employé par ID (vérifié dans le workspace du patron)
     * ============================================================
     */
    static async findByIdAndPatron(id, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT e.*, r.nom AS role_nom
             FROM employes e
             JOIN roles r ON e.id_role = r.id_role
             WHERE e.id_employe = ? AND e.id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Lister tous les employés d'un patron
     * ============================================================
     */
    static async findAllByPatron(id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT e.id_employe, e.fullname, e.slug, e.telephone, 
                    e.actif, e.date_creation, e.derniere_connexion,
                    e.id_magasin, r.nom AS role_nom, r.id_role,
                    m.ville AS magasin_ville
             FROM employes e
             JOIN roles r ON e.id_role = r.id_role
             LEFT JOIN magasins m ON e.id_magasin = m.id_magasin
             WHERE e.id_utilisateur = ?
             ORDER BY e.date_creation DESC`,
            [id_utilisateur]
        );
        return rows;
    }

    /**
     * ============================================================
     * Créer un employé
     * ============================================================
     */
    static async create({ id_utilisateur, id_magasin, fullname, telephone, password, roleName }) {
        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        // Slug unique dans le workspace
        const slug = await this.createUniqueSlug(fullname, id_utilisateur);

        // Récupérer l'ID du rôle
        const roleId = await this.getRoleId(roleName);
        if (!roleId) {
            throw new Error(`Le rôle '${roleName}' n'existe pas ou est inactif`);
        }

        const [result] = await pool.execute(
            `INSERT INTO employes 
                (id_utilisateur, id_magasin, id_role, fullname, slug, telephone, password, actif)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [id_utilisateur, id_magasin, roleId, fullname, slug, telephone, hashedPassword]
        );

        return result.insertId;
    }

    /**
     * ============================================================
     * Mettre à jour un employé
     * ============================================================
     */
    static async update(id, id_utilisateur, data) {
        const updates = [];
        const values = [];

        if (data.fullname) {
            // Vérifier si le nom a changé → regénérer le slug
            const current = await this.findByIdAndPatron(id, id_utilisateur);
            if (current && current.fullname !== data.fullname) {
                const newSlug = await this.createUniqueSlug(data.fullname, id_utilisateur);
                updates.push('fullname = ?', 'slug = ?');
                values.push(data.fullname, newSlug);
            } else if (current && current.fullname === data.fullname) {
                // Nom identique, ne rien changer
            }
        }

        if (data.telephone !== undefined) {
            updates.push('telephone = ?');
            values.push(data.telephone);
        }

        if (data.roleName) {
            const roleId = await this.getRoleId(data.roleName);
            if (!roleId) throw new Error(`Rôle '${data.roleName}' invalide`);
            updates.push('id_role = ?');
            values.push(roleId);
        }

        if (data.id_magasin !== undefined) {
            updates.push('id_magasin = ?');
            values.push(data.id_magasin);
        }

        if (data.actif !== undefined && data.actif !== null) {
            updates.push('actif = ?');
            values.push(data.actif ? 1 : 0);
        }

        if (updates.length === 0) return false;

        values.push(id, id_utilisateur);

        const [result] = await pool.execute(
            `UPDATE employes SET ${updates.join(', ')} 
             WHERE id_employe = ? AND id_utilisateur = ?`,
            values
        );

        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Mettre à jour le mot de passe
     * ============================================================
     */
    static async updatePassword(id, newPassword) {
        const hashed = await bcrypt.hash(newPassword, 10);
        const [result] = await pool.execute(
            'UPDATE employes SET password = ? WHERE id_employe = ?',
            [hashed, id]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Vérifier le mot de passe
     * ============================================================
     */
    static async verifyPassword(id, password) {
        const [rows] = await pool.execute(
            'SELECT password FROM employes WHERE id_employe = ?',
            [id]
        );
        if (rows.length === 0) return false;
        return await bcrypt.compare(password, rows[0].password);
    }

    /**
     * ============================================================
     * Mettre à jour la dernière connexion
     * ============================================================
     */
    static async updateLastLogin(id) {
        await pool.execute(
            'UPDATE employes SET derniere_connexion = CURRENT_TIMESTAMP WHERE id_employe = ?',
            [id]
        );
    }

    /**
     * ============================================================
     * Activer / désactiver
     * ============================================================
     */
    static async toggleActivation(id, id_utilisateur, actif) {
        const [result] = await pool.execute(
            'UPDATE employes SET actif = ? WHERE id_employe = ? AND id_utilisateur = ?',
            [actif ? 1 : 0, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Supprimer un employé (vérifié workspace)
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        const [result] = await pool.execute(
            'DELETE FROM employes WHERE id_employe = ? AND id_utilisateur = ?',
            [id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Compter les employés d'un patron
     * ============================================================
     */
    static async countByPatron(id_utilisateur) {
        const [rows] = await pool.execute(
            'SELECT COUNT(*) as total FROM employes WHERE id_utilisateur = ?',
            [id_utilisateur]
        );
        return rows[0].total;
    }

    /**
     * ============================================================
     * Statistiques (total, actifs, inactifs, par rôle)
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN actif = 1 THEN 1 ELSE 0 END) AS actifs,
                SUM(CASE WHEN actif = 0 THEN 1 ELSE 0 END) AS inactifs
             FROM employes
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const [byRole] = await pool.execute(
            `SELECT r.nom AS role, COUNT(e.id_employe) AS total
             FROM roles r
             LEFT JOIN employes e ON e.id_role = r.id_role AND e.id_utilisateur = ?
             WHERE r.actif = 1 AND r.nom != 'admin'
             GROUP BY r.id_role, r.nom`,
            [id_utilisateur]
        );

        return {
            total:    parseInt(rows[0].total)    || 0,
            actifs:   parseInt(rows[0].actifs)   || 0,
            inactifs: parseInt(rows[0].inactifs) || 0,
            byRole
        };
    }
}

export default Employe;