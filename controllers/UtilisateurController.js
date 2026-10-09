// controllers/UtilisateurController.js
import jwt from "jsonwebtoken";
import Utilisateur from '../models/Utilisateur.js';
 import Magasin from '../models/Magasin.js';
 import Employe from '../models/Employe.js';
import PasswordReset from '../models/PasswordReset.js';
import { sendResetCode } from '../Services/emailService.js';

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
 * ✅ NOUVEAU : Crée automatiquement le magasin
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

        // ✅ NOUVEAU : Créer automatiquement le magasin du patron
        try {
            await Magasin.create(userId, {
                telephone: cleanedTelephone
            });
            console.log(`✅ Magasin créé automatiquement pour l'utilisateur ${userId}`);
        } catch (magasinError) {
            console.error('⚠️ Erreur création magasin (non bloquant):', magasinError);
            // On ne bloque PAS l'inscription si la création du magasin échoue
        }

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

static async login(req, res) {
    try {
        const { telephone, password } = req.body;

        // ==================== 🔍 LOGS DÉBUT ====================
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('🔐 [LOGIN] NOUVELLE TENTATIVE');
        console.log('⏰ Timestamp :', new Date().toISOString());
        console.log('📥 req.body :', {
            telephone: JSON.stringify(telephone),
            telephoneType: typeof telephone,
            telephoneLength: telephone?.length,
            passwordLength: password?.length,
            passwordType: typeof password,
            passwordPreview: password ? '***' + password.slice(-2) : '(vide)',
        });
        // =========================================================

        if (!telephone || !password) {
            console.log('❌ [LOGIN] Étape 1 ÉCHEC → telephone ou password manquant');
            console.log('═══════════════════════════════════════════════════');
            return res.status(400).json({
                success: false,
                message: 'Téléphone et mot de passe sont obligatoires'
            });
        }

        const cleanedTelephone = telephone.replace(/\s/g, '');
        console.log('🧹 [LOGIN] Étape 2 OK → telephone nettoyé :', JSON.stringify(cleanedTelephone));

        // ============================================================
        // 1️⃣ Recherche dans UTILISATEURS
        // ============================================================
        console.log('🔎 [LOGIN] Étape 3 → Recherche dans UTILISATEURS...');
        let user = await Utilisateur.findOnly(cleanedTelephone);
        let type = 'utilisateur';
        if (user) {
            console.log('   ✅ TROUVÉ dans utilisateurs');
            console.log('      id_utilisateur :', user.id_utilisateur);
            console.log('      fullname       :', user.fullname);
            console.log('      telephone      :', user.telephone);
            console.log('      actif          :', user.actif, '(type:', typeof user.actif, ')');
            console.log('      role_nom       :', user.role_nom);
        } else {
            console.log('   ❌ NON TROUVÉ dans utilisateurs');
        }

        // ============================================================
        // 2️⃣ Recherche dans EMPLOYÉS
        // ============================================================
        if (!user) {
            console.log('🔎 [LOGIN] Étape 4 → Recherche dans EMPLOYES...');
            user = await Employe.findByTelephone(cleanedTelephone);
            type = 'employe';
            if (user) {
                console.log('   ✅ TROUVÉ dans employes');
                console.log('      id_employe     :', user.id_employe);
                console.log('      fullname       :', user.fullname);
                console.log('      telephone      :', user.telephone);
                console.log('      actif          :', user.actif, '(type:', typeof user.actif, ')');
                console.log('      role_nom       :', user.role_nom);
                console.log('      id_patron      :', user.id_patron);
                console.log('      slug_patron    :', user.slug_patron);
                console.log('      id_magasin     :', user.id_magasin);
            } else {
                console.log('   ❌ NON TROUVÉ dans employes');
            }
        }

        // ============================================================
        // AUCUN RÉSULTAT
        // ============================================================
        if (!user) {
            console.log('');
            console.log('💥 [LOGIN] ÉCHEC FINAL → Aucun user/employé trouvé');
            console.log('   → telephone recherché :', JSON.stringify(cleanedTelephone));
            console.log('   → Requête SQL à vérifier en prod :');
            console.log('     SELECT * FROM utilisateurs WHERE telephone = ?', [cleanedTelephone]);
            console.log('     SELECT * FROM employes WHERE telephone = ?', [cleanedTelephone]);
            console.log('═══════════════════════════════════════════════════');
            return res.status(401).json({
                success: false,
                message: 'Identifiants invalides'
            });
        }

        // ============================================================
        // VÉRIFICATION STATUT ACTIF
        // ============================================================
        console.log('🔎 [LOGIN] Étape 5 → Vérification actif...');
        if (!user.actif) {
            console.log('❌ [LOGIN] ÉCHEC → Compte désactivé (actif =', user.actif, ')');
            console.log('═══════════════════════════════════════════════════');
            return res.status(403).json({
                success: false,
                message: 'Compte désactivé. Veuillez contacter l\'administrateur.'
            });
        }
        console.log('   ✅ Compte actif');

        // ============================================================
        // VÉRIFICATION MOT DE PASSE
        // ============================================================
        console.log('🔎 [LOGIN] Étape 6 → Vérification mot de passe (' + type + ')...');
        let isValidPassword = false;

        if (type === 'utilisateur') {
            console.log('   → Appel Utilisateur.verifyPassword(id_utilisateur =', user.id_utilisateur, ')');
            isValidPassword = await Utilisateur.verifyPassword(user.id_utilisateur, password);
        } else {
            console.log('   → Appel Employe.verifyPassword(id_employe =', user.id_employe, ')');
            isValidPassword = await Employe.verifyPassword(user.id_employe, password);
        }

        console.log('   → Résultat bcrypt.compare :', isValidPassword);

        if (!isValidPassword) {
            console.log('');
            console.log('💥 [LOGIN] ÉCHEC FINAL → Mot de passe incorrect');
            console.log('   → telephone :', cleanedTelephone);
            console.log('   → type      :', type);
            console.log('   → id        :', type === 'utilisateur' ? user.id_utilisateur : user.id_employe);
            console.log('   → Vérifier manuellement avec :');
            console.log('     bcrypt.compare("' + (password ? '***' + password.slice(-2) : '') + '", hash_en_base)');
            console.log('═══════════════════════════════════════════════════');
            return res.status(401).json({
                success: false,
                message: 'Identifiants invalides'
            });
        }

        // ============================================================
        // GÉNÉRATION DU TOKEN
        // ============================================================
        console.log('🔎 [LOGIN] Étape 7 → Génération du token JWT...');
        const id = type === 'utilisateur' ? user.id_utilisateur : user.id_employe;
        const token = jwt.sign(
            {
                id,
                telephone: user.telephone,
                role: user.role_nom,
                type
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: JWT_EXPIRES_IN }
        );
        console.log('   ✅ Token généré');

        // ============================================================
        // MAJ DERNIÈRE CONNEXION
        // ============================================================
        console.log('🔎 [LOGIN] Étape 8 → Maj dernière connexion...');
        if (type === 'utilisateur') {
            await Utilisateur.updateLastLogin(user.id_utilisateur);
        } else {
            await Employe.updateLastLogin(user.id_employe);
        }
        console.log('   ✅ Dernière connexion mise à jour');

        // ============================================================
        // RÉPONSE SUCCÈS
        // ============================================================
        console.log('');
        console.log('✅ [LOGIN] SUCCÈS TOTAL pour :', user.fullname, '(' + type + ')');
        console.log('   → id :', id);
        console.log('   → slug :', type === 'utilisateur' ? user.slug : user.slug_patron);
        console.log('   → role :', user.role_nom);
        console.log('   → id_magasin :', type === 'employe' ? user.id_magasin : null);
        console.log('═══════════════════════════════════════════════════');
        console.log('');

        return res.status(200).json({
            success: true,
            message: 'Connexion réussie',
            token,
            user: {
                id,
                type,
                slug: type === 'utilisateur' ? user.slug : user.slug_patron,
                fullname: user.fullname,
                telephone: user.telephone,
                email: user.email || null,
                role: user.role_nom,
                id_magasin: type === 'employe' ? user.id_magasin : null,
                actif: user.actif
            }
        });

    } catch (error) {
        console.log('');
        console.log(' [LOGIN] EXCEPTION NON PRÉVUE ');
        console.error('   Message :', error.message);
        console.error('   Stack :', error.stack);
        console.log('═══════════════════════════════════════════════════');
        console.log('');
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
     * ÉTAPE 1 : Demander un code de réinitialisation par email
     * POST /api/utilisateur/forgot-password
     * Body: { email }
     */
    static async forgotPassword(req, res) {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'L\'adresse email est obligatoire'
                });
            }

            const cleanedEmail = email.trim().toLowerCase();

            // Validation format email
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
                return res.status(400).json({
                    success: false,
                    message: 'Adresse email invalide'
                });
            }

            const ip = req.ip || req.connection.remoteAddress;

            // Réponse générique (anti-énumération d'emails)
            const genericResponse = {
                success: true,
                message: 'Si cette adresse email est enregistrée, un code de réinitialisation a été envoyé.'
            };

            // ============================================================
            // 1️⃣ Chercher l'utilisateur par email
            // ============================================================
            const user = await Utilisateur.findByEmail(cleanedEmail);

            if (!user) {
                console.log('⚠️ [FORGOT-PWD] Email inconnu:', cleanedEmail);
                return res.status(200).json(genericResponse);
            }

            if (!user.actif) {
                return res.status(403).json({
                    success: false,
                    message: 'Compte désactivé. Contactez l\'administrateur.'
                });
            }

            // ============================================================
            // 2️⃣ Anti-spam : max 3 demandes / 15 minutes
            // ============================================================
            const recentCount = await PasswordReset.countRecentRequests(cleanedEmail, 15);
            if (recentCount >= 3) {
                return res.status(429).json({
                    success: false,
                    message: 'Trop de demandes. Veuillez réessayer dans 15 minutes.'
                });
            }

            // ============================================================
            // 3️⃣ Créer le code OTP
            // ============================================================
            const { code } = await PasswordReset.createOTP(
                cleanedEmail,
                user.id_utilisateur,
                ip
            );

            // ============================================================
            // 4️⃣ Envoyer l'email
            // ============================================================
            const emailResult = await sendResetCode(cleanedEmail, code, user.fullname);

            if (!emailResult.success) {
                console.error('❌ [FORGOT-PWD] Échec envoi email');
                return res.status(500).json({
                    success: false,
                    message: 'Impossible d\'envoyer l\'email. Réessayez plus tard.'
                });
            }

            console.log(`✅ [FORGOT-PWD] Code envoyé à ${cleanedEmail}`);

            return res.status(200).json(genericResponse);

        } catch (error) {
            console.error('❌ ForgotPassword error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la demande de réinitialisation'
            });
        }
    }

    /**
     * ÉTAPE 2 : Vérifier le code OTP
     * POST /api/utilisateur/verify-reset-code
     * Body: { email, code }
     */
    static async verifyResetCode(req, res) {
        try {
            const { email, code } = req.body;

            if (!email || !code) {
                return res.status(400).json({
                    success: false,
                    message: 'Email et code sont obligatoires'
                });
            }

            const cleanedEmail = email.trim().toLowerCase();
            const result = await PasswordReset.verifyOTP(cleanedEmail, code);

            if (!result.valid) {
                return res.status(400).json({
                    success: false,
                    message: result.reason
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Code valide'
            });

        } catch (error) {
            console.error('❌ VerifyResetCode error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la vérification du code'
            });
        }
    }

    /**
     * ÉTAPE 3 : Réinitialiser le mot de passe
     * POST /api/utilisateur/reset-password
     * Body: { email, code, newPassword }
     */
    static async resetPassword(req, res) {
        try {
            const { email, code, newPassword } = req.body;

            // Validation
            if (!email || !code || !newPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Email, code et nouveau mot de passe sont obligatoires'
                });
            }

            if (!/^\d{4}$/.test(newPassword)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nouveau mot de passe doit contenir exactement 4 chiffres'
                });
            }

            const cleanedEmail = email.trim().toLowerCase();

            // Vérifier le code
            const verification = await PasswordReset.verifyOTP(cleanedEmail, code);
            if (!verification.valid) {
                return res.status(400).json({
                    success: false,
                    message: verification.reason
                });
            }

            const otp = verification.otp;

            // Mettre à jour le mot de passe
            const updated = await Utilisateur.updatePassword(otp.id_utilisateur, newPassword);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du mot de passe'
                });
            }

            // Marquer le code comme utilisé
            await PasswordReset.markAsUsed(otp.id_otp);

            console.log(`✅ [RESET-PWD] Mot de passe réinitialisé pour ${cleanedEmail}`);

            return res.status(200).json({
                success: true,
                message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.'
            });

        } catch (error) {
            console.error('❌ ResetPassword error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la réinitialisation'
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