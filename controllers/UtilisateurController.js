// controllers/UtilisateurController.js
import jwt from "jsonwebtoken";
import Utilisateur from '../models/Utilisateur.js';

const JWT_EXPIRES_IN = '30d';

// Fonction utilitaire pour générer le token
function generateToken(userId, telephone, role) {
    return jwt.sign(
        { id: userId, telephone, role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: JWT_EXPIRES_IN } 
    );
}

class UtilisateurController {
    /**
     * INSCRIPTION d'un nouvel utilisateur
     * Le rôle est automatiquement défini comme 'client'
     * ⚠️ AUCUN rôle ne vient du frontend pour des raisons de sécurité
     */
    static async register(req, res) {
        try {
            // ⚠️ On n'accepte PAS de rôle dans la requête
            const { fullname, telephone, password, email } = req.body;

            // Validation des données
            if (!fullname || !telephone || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Nom, téléphone et mot de passe sont obligatoires'
                });
            }

            // Validation du mot de passe (4 chiffres)
            if (!/^\d{4}$/.test(password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le mot de passe doit contenir exactement 4 chiffres'
                });
            }

            // Nettoyer le numéro de téléphone
            const cleanedTelephone = telephone.replace(/\s/g, '');

            // Vérifier si l'utilisateur existe déjà
            const existingUser = await Utilisateur.findOnly(cleanedTelephone);

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Un utilisateur avec ce numéro existe déjà'
                });
            }

            // Créer l'utilisateur - Le rôle 'client' est automatiquement attribué
            const userId = await Utilisateur.create({
                fullname,
                telephone: cleanedTelephone,
                password,
                email: email || null
                // ⚠️ PAS de rôle ici !
            });

            // Récupérer l'utilisateur créé
            const newUser = await Utilisateur.findById(userId);

            // Générer le token avec le nom du rôle
            const token = generateToken(newUser.id_utilisateur, newUser.telephone, newUser.role_nom);

            return res.status(201).json({
                success: true,
                message: 'Utilisateur créé avec succès', 
                token,
                user: {
                    id: newUser.id_utilisateur,
                    slug: newUser.slug,
                    fullname: newUser.fullname,
                    telephone: newUser.telephone,
                    email: newUser.email,
                    role: newUser.role_nom, // ← Le rôle vient de la BD, PAS du frontend
                    actif: newUser.actif
                }
            });

        } catch (error) {
            console.error('❌ Register error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du compte',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * CRÉER un utilisateur avec un rôle spécifique (UNIQUEMENT pour Admin)
     * ⚠️ Cette route est protégée et réservée aux administrateurs
     */
    static async createUserByAdmin(req, res) {
        try {
            // Vérifier si l'utilisateur est admin
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé. Seul un administrateur peut créer des utilisateurs avec des rôles spécifiques.'
                });
            }

            // ✅ L'admin peut définir le rôle
            const { fullname, telephone, password, email, roleName } = req.body;

            if (!fullname || !telephone || !password || !roleName) {
                return res.status(400).json({
                    success: false,
                    message: 'Nom, téléphone, mot de passe et rôle sont obligatoires'
                });
            }

            // Vérifier que le rôle existe
            const roles = await Utilisateur.getAllRoles();
            const roleExists = roles.some(r => r.nom === roleName);
            if (!roleExists) {
                return res.status(400).json({
                    success: false,
                    message: `Le rôle '${roleName}' n'existe pas`
                });
            }

            const cleanedTelephone = telephone.replace(/\s/g, '');

            // Vérifier si l'utilisateur existe déjà
            const existingUser = await Utilisateur.findOnly(cleanedTelephone);
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Un utilisateur avec ce numéro existe déjà'
                });
            }

            // Créer l'utilisateur avec le rôle spécifié
            const userId = await Utilisateur.createWithRole({
                fullname,
                telephone: cleanedTelephone,
                password,
                email: email || null,
                roleName
            });

            const newUser = await Utilisateur.findById(userId);

            return res.status(201).json({
                success: true,
                message: 'Utilisateur créé avec succès',
                user: {
                    id: newUser.id_utilisateur,
                    slug: newUser.slug,
                    fullname: newUser.fullname,
                    telephone: newUser.telephone,
                    email: newUser.email,
                    role: newUser.role_nom,
                    actif: newUser.actif
                }
            });

        } catch (error) {
            console.error('❌ CreateUserByAdmin error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de l\'utilisateur'
            });
        }
    }

    /**
     * CONNEXION d'un utilisateur
     */
    static async login(req, res) {
        try {
            const { telephone, password } = req.body;

            if (!telephone || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Téléphone et mot de passe sont obligatoires'
                });
            }

            const cleanedTelephone = telephone.replace(/\s/g, '');
            const user = await Utilisateur.findOnly(cleanedTelephone);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Identifiants invalides'
                });
            }

            if (!user.actif) {
                return res.status(403).json({
                    success: false,
                    message: 'Compte désactivé. Veuillez contacter l\'administrateur.'
                });
            }

            const isValidPassword = await Utilisateur.verifyPassword(user.id_utilisateur, password);

            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    message: 'Identifiants invalides'
                });
            }

            const token = generateToken(user.id_utilisateur, user.telephone, user.role_nom);
            await Utilisateur.updateLastLogin(user.id_utilisateur);

            return res.status(200).json({
                success: true,
                message: 'Connexion réussie',
                token,
                user: {
                    id: user.id_utilisateur,
                    slug: user.slug,
                    fullname: user.fullname,
                    telephone: user.telephone,
                    email: user.email,
                    role: user.role_nom,
                    actif: user.actif
                }
            });

        } catch (error) {
            console.error('❌ Login error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la connexion'
            });
        }
    }

    /**
     * RÉCUPÉRER le profil de l'utilisateur connecté
     */
    static async getProfile(req, res) {
        try {
            const userId = req.user.id;
            const user = await Utilisateur.findById(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                user: {
                    id: user.id_utilisateur,
                    slug: user.slug,
                    fullname: user.fullname,
                    telephone: user.telephone,
                    email: user.email,
                    role: user.role_nom,
                    actif: user.actif,
                    date_creation: user.date_creation,
                    derniere_connexion: user.derniere_connexion
                }
            });

        } catch (error) {
            console.error('❌ GetProfile error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du profil'
            });
        }
    }

    /**
     * RÉCUPÉRER le profil par SLUG
     */
    static async getProfileBySlug(req, res) {
        try {
            const { slug } = req.params;
            const user = await Utilisateur.findBySlug(slug);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                user: {
                    id: user.id_utilisateur,
                    slug: user.slug,
                    fullname: user.fullname,
                    telephone: user.telephone,
                    email: user.email,
                    role: user.role_nom,
                    actif: user.actif,
                    date_creation: user.date_creation,
                    derniere_connexion: user.derniere_connexion
                }
            });

        } catch (error) {
            console.error('❌ GetProfileBySlug error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du profil'
            });
        }
    }

    /**
     * RÉCUPÉRER tous les utilisateurs (Admin)
     */
    static async getAllUsers(req, res) {
        try {
            // Vérifier si l'utilisateur est admin
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            const users = await Utilisateur.findAll();

            return res.status(200).json({
                success: true,
                count: users.length,
                users: users.map(user => ({
                    id: user.id_utilisateur,
                    slug: user.slug,
                    fullname: user.fullname,
                    telephone: user.telephone,
                    email: user.email,
                    role: user.role_nom,
                    actif: user.actif,
                    date_creation: user.date_creation,
                    derniere_connexion: user.derniere_connexion
                }))
            });

        } catch (error) {
            console.error('❌ GetAllUsers error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des utilisateurs'
            });
        }
    }

    /**
     * RÉCUPÉRER les utilisateurs par rôle (Admin)
     */
    static async getUsersByRole(req, res) {
        try {
            const { role } = req.params;

            // Vérifier si l'utilisateur est admin
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            const users = await Utilisateur.findByRole(role);

            return res.status(200).json({
                success: true,
                count: users.length,
                users
            });

        } catch (error) {
            console.error('❌ GetUsersByRole error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des utilisateurs'
            });
        }
    }

    /**
     * METTRE À JOUR le profil de l'utilisateur connecté
     * ⚠️ NE PEUT PAS changer son propre rôle
     */
    static async updateProfile(req, res) {
        try {
            const userId = req.user.id;
            const { fullname, telephone, email } = req.body;

            // ⚠️ On n'accepte PAS de changement de rôle ici
            const updatedUser = await Utilisateur.update(userId, { 
                fullname, 
                telephone: telephone ? telephone.replace(/\s/g, '') : undefined,
                email
            });

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Profil mis à jour avec succès',
                user: {
                    id: updatedUser.id_utilisateur,
                    slug: updatedUser.slug,
                    fullname: updatedUser.fullname,
                    telephone: updatedUser.telephone,
                    email: updatedUser.email,
                    role: updatedUser.role_nom,
                    actif: updatedUser.actif
                }
            });

        } catch (error) {
            console.error('❌ UpdateProfile error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du profil'
            });
        }
    }

    /**
     * METTRE À JOUR le rôle d'un utilisateur (UNIQUEMENT Admin)
     */
    static async updateUserRole(req, res) {
        try {
            const { id } = req.params;
            const { roleName } = req.body;

            // Vérifier si l'utilisateur est admin
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé. Seul un administrateur peut changer les rôles.'
                });
            }

            if (!roleName) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom du rôle est obligatoire'
                });
            }

            // Vérifier que le rôle existe
            const roles = await Utilisateur.getAllRoles();
            const roleExists = roles.some(r => r.nom === roleName);
            if (!roleExists) {
                return res.status(400).json({
                    success: false,
                    message: `Le rôle '${roleName}' n'existe pas`
                });
            }

            // Empêcher un admin de changer son propre rôle
            if (parseInt(id) === req.user.id) {
                return res.status(400).json({
                    success: false,
                    message: 'Vous ne pouvez pas modifier votre propre rôle'
                });
            }

            const updatedUser = await Utilisateur.updateRole(id, roleName);

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Rôle mis à jour avec succès',
                user: {
                    id: updatedUser.id_utilisateur,
                    fullname: updatedUser.fullname,
                    role: updatedUser.role_nom
                }
            });

        } catch (error) {
            console.error('❌ UpdateUserRole error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du changement de rôle'
            });
        }
    }

    /**
     * METTRE À JOUR un utilisateur (Admin)
     * ⚠️ L'admin peut tout modifier SAUF son propre rôle
     */
    static async updateUserById(req, res) {
        try {
            const { id } = req.params;

            // Vérifier si l'utilisateur est admin
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            const { fullname, telephone, email, actif } = req.body;

            // Empêcher l'admin de se désactiver lui-même
            if (parseInt(id) === req.user.id && actif === false) {
                return res.status(400).json({
                    success: false,
                    message: 'Vous ne pouvez pas désactiver votre propre compte'
                });
            }

            // ⚠️ On ne modifie PAS le rôle ici, utilisation de la méthode updateRole séparée
            const updatedUser = await Utilisateur.update(id, {
                fullname,
                telephone: telephone ? telephone.replace(/\s/g, '') : undefined,
                email,
                actif
            });

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Utilisateur mis à jour avec succès',
                user: {
                    id: updatedUser.id_utilisateur,
                    slug: updatedUser.slug,
                    fullname: updatedUser.fullname,
                    telephone: updatedUser.telephone,
                    email: updatedUser.email,
                    role: updatedUser.role_nom,
                    actif: updatedUser.actif
                }
            });

        } catch (error) {
            console.error('❌ UpdateUserById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de l\'utilisateur'
            });
        }
    }

    /**
     * METTRE À JOUR le mot de passe
     */
    static async updatePassword(req, res) {
        try {
            const userId = req.user.id;
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Mot de passe actuel et nouveau mot de passe sont obligatoires'
                });
            }

            // Vérifier le mot de passe actuel
            const isValid = await Utilisateur.verifyPassword(userId, currentPassword);
            if (!isValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Mot de passe actuel incorrect'
                });
            }

            // Validation du nouveau mot de passe
            if (newPassword.length < 4) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nouveau mot de passe doit contenir au moins 4 caractères'
                });
            }

            const updated = await Utilisateur.updatePassword(userId, newPassword);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du mot de passe'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Mot de passe mis à jour avec succès'
            });

        } catch (error) {
            console.error('❌ UpdatePassword error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du mot de passe'
            });
        }
    }

    /**
     * ACTIVER/DÉSACTIVER un utilisateur (Admin)
     */
    static async toggleUserActivation(req, res) {
        try {
            const { id } = req.params;
            const { actif } = req.body;

            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            if (actif === undefined || actif === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Le statut actif est obligatoire'
                });
            }

            if (parseInt(id) === req.user.id && !actif) {
                return res.status(400).json({
                    success: false,
                    message: 'Vous ne pouvez pas désactiver votre propre compte'
                });
            }

            const updated = await Utilisateur.toggleActivation(id, actif);

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Utilisateur ${actif ? 'activé' : 'désactivé'} avec succès`
            });

        } catch (error) {
            console.error('❌ ToggleUserActivation error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la modification du statut'
            });
        }
    }

    /**
     * SUPPRIMER un utilisateur (Admin)
     */
    static async deleteUser(req, res) {
        try {
            const { id } = req.params;

            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            if (parseInt(id) === req.user.id) {
                return res.status(400).json({
                    success: false,
                    message: 'Vous ne pouvez pas supprimer votre propre compte'
                });
            }

            const deleted = await Utilisateur.delete(id);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Utilisateur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Utilisateur supprimé avec succès'
            });

        } catch (error) {
            console.error('❌ DeleteUser error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de l\'utilisateur'
            });
        }
    }

    /**
     * RECHERCHER des utilisateurs (Admin)
     */
    static async searchUsers(req, res) {
        try {
            const { keyword } = req.query;

            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Le terme de recherche doit contenir au moins 2 caractères'
                });
            }

            const users = await Utilisateur.search(keyword);

            return res.status(200).json({
                success: true,
                count: users.length,
                users
            });

        } catch (error) {
            console.error('❌ SearchUsers error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche'
            });
        }
    }

    /**
     * STATISTIQUES des utilisateurs (Admin)
     */
    static async getUserStats(req, res) {
        try {
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            const total = await Utilisateur.count();
            
            const roles = await Utilisateur.getAllRoles();
            const byRole = {};
            
            for (const role of roles) {
                byRole[role.nom] = await Utilisateur.countByRole(role.nom);
            }

            return res.status(200).json({
                success: true,
                stats: {
                    total,
                    byRole
                }
            });

        } catch (error) {
            console.error('❌ GetUserStats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }
    }

    /**
     * RÉCUPÉRER tous les rôles disponibles (Admin)
     */
    static async getAllRoles(req, res) {
        try {
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }

            const roles = await Utilisateur.getAllRoles();

            return res.status(200).json({
                success: true,
                roles
            });

        } catch (error) {
            console.error('❌ GetAllRoles error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des rôles'
            });
        }
    }
}

export default UtilisateurController;