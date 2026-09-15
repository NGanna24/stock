// models/Utilisateur.js
import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';

class Utilisateur { 
    /**
     * Générer un slug à partir du nom
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
     * Créer un slug unique
     */
    static async createUniqueSlug(fullname) {
        let baseSlug = this.generateSlug(fullname);
        let slug = baseSlug;
        let counter = 1;

        while (true) {
            const [rows] = await pool.execute(
                'SELECT COUNT(*) as count FROM utilisateurs WHERE slug = ?',
                [slug]
            );
            
            if (rows[0].count === 0) {
                break;
            }
            
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        return slug;
    }

    /**
     * Récupérer l'ID du rôle par défaut (client)
     */
    static async getDefaultRoleId() {
        try {
            const [rows] = await pool.execute(
                'SELECT id_role FROM roles WHERE nom = ? AND actif = 1',
                ['client']
            );
            
            if (rows.length === 0) {
                // Si le rôle 'client' n'existe pas, prendre le premier rôle actif
                const [fallbackRows] = await pool.execute(
                    'SELECT id_role FROM roles WHERE actif = 1 LIMIT 1'
                );
                return fallbackRows[0]?.id_role || null;
            }
            
            return rows[0].id_role;
        } catch (error) {
            console.error('❌ Error getting default role ID:', error);
            throw error;
        }
    }

    /**
     * Récupérer l'ID d'un rôle par son nom
     */
    static async getRoleId(roleName) {
        try {
            const [rows] = await pool.execute(
                'SELECT id_role FROM roles WHERE nom = ? AND actif = 1',
                [roleName]
            );
            return rows[0]?.id_role || null;
        } catch (error) {
            console.error('❌ Error getting role ID:', error);
            throw error;
        }
    }

    /**
     * Récupérer le nom d'un rôle par son ID
     */
    static async getRoleName(roleId) {
        try {
            const [rows] = await pool.execute(
                'SELECT nom FROM roles WHERE id_role = ?',
                [roleId]
            );
            return rows[0]?.nom || null;
        } catch (error) {
            console.error('❌ Error getting role name:', error);
            throw error;
        }
    }

    /**
     * Trouver un utilisateur par téléphone
     */
    static async findOnly(telephone) {
        try {
            const [rows] = await pool.execute(
                `SELECT u.*, r.nom as role_nom 
                 FROM utilisateurs u
                 LEFT JOIN roles r ON u.id_role = r.id_role
                 WHERE u.telephone = ?`,
                [telephone]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding user:', error);
            throw error;
        }
    }

    /**
     * Trouver un utilisateur par slug
     */
    static async findBySlug(slug) {
        try {
            const [rows] = await pool.execute(
                `SELECT u.*, r.nom as role_nom 
                 FROM utilisateurs u
                 LEFT JOIN roles r ON u.id_role = r.id_role
                 WHERE u.slug = ?`,
                [slug]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding user by slug:', error);
            throw error;
        }
    }

    /**
     * Trouver un utilisateur par ID
     */
    static async findById(id) {
        try {
            const [rows] = await pool.execute(
                `SELECT u.*, r.nom as role_nom 
                 FROM utilisateurs u
                 LEFT JOIN roles r ON u.id_role = r.id_role
                 WHERE u.id_utilisateur = ?`,
                [id]
            );
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error finding user by ID:', error);
            throw error;
        }
    }

    /**
     * Trouver tous les utilisateurs
     */
    static async findAll() {
        try {
            const [rows] = await pool.execute(
                `SELECT u.id_utilisateur, u.fullname, u.slug, u.email, u.telephone, 
                        u.actif, u.date_creation, u.derniere_connexion,
                        r.id_role, r.nom as role_nom
                 FROM utilisateurs u
                 LEFT JOIN roles r ON u.id_role = r.id_role
                 ORDER BY u.date_creation DESC`
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding all users:', error);
            throw error;
        }
    }

    /**
     * Créer un nouvel utilisateur - ROLE AUTO-ATTRIBUÉ
     */
    static async create({ fullname, telephone, password, email = null }) {
        try {
            // Hasher le mot de passe
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Générer un slug unique
            const slug = await this.createUniqueSlug(fullname);

            // Récupérer l'ID du rôle par défaut (client)
            const roleId = await this.getDefaultRoleId();
            if (!roleId) {
                throw new Error('Aucun rôle disponible dans la base de données');
            }

            const [result] = await pool.execute(
                `INSERT INTO utilisateurs (fullname, telephone, password, slug, email, id_role, actif) 
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [fullname, telephone, hashedPassword, slug, email, roleId]
            );

            return result.insertId;
        } catch (error) {
            console.error('❌ Error creating user:', error);
            throw error;
        }
    }

    /**
     * Créer un utilisateur avec un rôle spécifique (UNIQUEMENT pour Admin)
     */
    static async createWithRole({ fullname, telephone, password, email = null, roleName }) {
        try {
            // Hasher le mot de passe
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Générer un slug unique
            const slug = await this.createUniqueSlug(fullname);

            // Récupérer l'ID du rôle spécifié
            const roleId = await this.getRoleId(roleName);
            if (!roleId) {
                throw new Error(`Le rôle '${roleName}' n'existe pas ou est inactif`);
            }

            const [result] = await pool.execute(
                `INSERT INTO utilisateurs (fullname, telephone, password, slug, email, id_role, actif) 
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [fullname, telephone, hashedPassword, slug, email, roleId]
            );

            return result.insertId;
        } catch (error) {
            console.error('❌ Error creating user with role:', error);
            throw error;
        }
    }

    /**
     * Vérifier le mot de passe
     */
    static async verifyPassword(userId, password) {
        try {
            const [rows] = await pool.execute(
                'SELECT password FROM utilisateurs WHERE id_utilisateur = ?',
                [userId]
            );

            if (rows.length === 0) {
                return false;
            }

            return await bcrypt.compare(password, rows[0].password);
        } catch (error) {
            console.error('❌ Error verifying password:', error);
            throw error;
        }
    }

    /**
     * Mettre à jour la dernière connexion
     */
    static async updateLastLogin(userId) {
        try {
            await pool.execute(
                'UPDATE utilisateurs SET derniere_connexion = CURRENT_TIMESTAMP WHERE id_utilisateur = ?',
                [userId]
            );
        } catch (error) {
            console.error('❌ Error updating last login:', error);
            throw error;
        }
    }

    /**
     * Mettre à jour le profil utilisateur (ne change PAS le rôle)
     */
    static async update(userId, data) {
        try {
            const updates = [];
            const values = [];

            if (data.fullname) {
                const currentUser = await this.findById(userId);
                if (currentUser && currentUser.fullname !== data.fullname) {
                    const newSlug = await this.createUniqueSlug(data.fullname);
                    updates.push('fullname = ?');
                    updates.push('slug = ?');
                    values.push(data.fullname);
                    values.push(newSlug);
                } else if (currentUser && currentUser.fullname === data.fullname) {
                    // Ne pas modifier si le nom est identique
                } else {
                    updates.push('fullname = ?');
                    values.push(data.fullname);
                }
            }

            if (data.telephone !== undefined) {
                updates.push('telephone = ?');
                values.push(data.telephone);
            }

            if (data.email !== undefined) {
                updates.push('email = ?');
                values.push(data.email);
            }

            if (data.actif !== undefined && data.actif !== null) {
                updates.push('actif = ?');
                values.push(data.actif ? 1 : 0);
            }

            if (updates.length === 0) {
                return await this.findById(userId);
            }

            values.push(userId);

            const [result] = await pool.execute(
                `UPDATE utilisateurs SET ${updates.join(', ')} WHERE id_utilisateur = ?`,
                values
            );

            if (result.affectedRows === 0) {
                return null;
            }

            return await this.findById(userId);
        } catch (error) {
            console.error('❌ Error updating user:', error);
            throw error;
        }
    }

    /**
     * Mettre à jour le rôle d'un utilisateur (UNIQUEMENT pour Admin)
     */
    static async updateRole(userId, roleName) {
        try {
            const roleId = await this.getRoleId(roleName);
            if (!roleId) {
                throw new Error(`Le rôle '${roleName}' n'existe pas ou est inactif`);
            }

            const [result] = await pool.execute(
                'UPDATE utilisateurs SET id_role = ? WHERE id_utilisateur = ?',
                [roleId, userId]
            );

            if (result.affectedRows === 0) {
                return null;
            }

            return await this.findById(userId);
        } catch (error) {
            console.error('❌ Error updating role:', error);
            throw error;
        }
    }

    /**
     * Mettre à jour le mot de passe
     */
    static async updatePassword(userId, newPassword) {
        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            
            const [result] = await pool.execute(
                'UPDATE utilisateurs SET password = ? WHERE id_utilisateur = ?',
                [hashedPassword, userId]
            );

            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating password:', error);
            throw error;
        }
    }

    /**
     * Désactiver/Activer un utilisateur (UNIQUEMENT pour Admin)
     */
    static async toggleActivation(userId, actif) {
        try {
            const [result] = await pool.execute(
                'UPDATE utilisateurs SET actif = ? WHERE id_utilisateur = ?',
                [actif ? 1 : 0, userId]
            );

            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error toggling user activation:', error);
            throw error;
        }
    }

    /**
     * Supprimer un utilisateur (UNIQUEMENT pour Admin)
     */
    static async delete(userId) {
        try {
            const [result] = await pool.execute(
                'DELETE FROM utilisateurs WHERE id_utilisateur = ?',
                [userId]
            );

            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error deleting user:', error);
            throw error;
        }
    }

    /**
     * Compter le nombre total d'utilisateurs
     */
    static async count() {
        try {
            const [rows] = await pool.execute(
                'SELECT COUNT(*) as total FROM utilisateurs'
            );
            return rows[0].total;
        } catch (error) {
            console.error('❌ Error counting users:', error);
            throw error;
        }
    }

    /**
     * Compter les utilisateurs par rôle
     */
    static async countByRole(roleName) {
        try {
            const roleId = await this.getRoleId(roleName);
            if (!roleId) {
                return 0;
            }

            const [rows] = await pool.execute(
                'SELECT COUNT(*) as total FROM utilisateurs WHERE id_role = ?',
                [roleId]
            );
            return rows[0].total;
        } catch (error) {
            console.error('❌ Error counting users by role:', error);
            throw error;
        }
    }

    /**
     * Rechercher des utilisateurs par nom, téléphone ou email
     */
    static async search(keyword) {
        try {
            const [rows] = await pool.execute(
                `SELECT u.id_utilisateur, u.fullname, u.slug, u.email, u.telephone, 
                        u.actif, u.date_creation, u.derniere_connexion,
                        r.id_role, r.nom as role_nom
                 FROM utilisateurs u
                 LEFT JOIN roles r ON u.id_role = r.id_role
                 WHERE u.fullname LIKE ? OR u.telephone LIKE ? OR u.email LIKE ?
                 ORDER BY u.date_creation DESC`,
                [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error searching users:', error);
            throw error;
        }
    }

    /**
     * Récupérer tous les rôles disponibles
     */
    static async getAllRoles() {
        try {
            const [rows] = await pool.execute(
                'SELECT id_role, nom, description, actif FROM roles WHERE actif = 1 ORDER BY nom'
            );
            return rows;
        } catch (error) {
            console.error('❌ Error getting roles:', error);
            throw error;
        }
    }
}

export default Utilisateur;