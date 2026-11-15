// controllers/SuperAdminController.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import JournalSuperAdmin from '../models/JournalSuperAdmin.js';
import SuperAdmin from '../models/SuperAdmin.js';
import { pool } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SUPER_ADMIN_SECRET;
const TOKEN_EXPIRES = '8h';
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MIN = 15;
const INVITE_CODE = process.env.SUPER_ADMIN_INVITE_CODE;

class SuperAdminController {

    // ============================================================
    // 🆕 REGISTER — protégé par code d'invitation
    // ============================================================
    static async register(req, res) {
        try {
            const { fullname, telephone, email, password, inviteCode } = req.body;

            // 1. Champs requis
            if (!fullname || !telephone || !email || !password || !inviteCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Tous les champs sont requis (nom, téléphone, email, mot de passe, code d\'invitation)',
                });
            }

            // 2. Code d'invitation
            if (!INVITE_CODE || inviteCode.trim() !== INVITE_CODE) {
                return res.status(403).json({
                    success: false,
                    message: 'Code d\'invitation invalide',
                });
            }

            // 3. Validation email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email invalide',
                });
            }

            // 4. Validation téléphone
            const phoneClean = telephone.replace(/\s/g, '');
            if (phoneClean.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'Numéro de téléphone invalide',
                });
            }

            // 5. Validation mot de passe
            if (password.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'Le mot de passe doit faire au moins 8 caractères',
                });
            }
            if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le mot de passe doit contenir au moins une majuscule et un chiffre',
                });
            }

            // 6. Unicité
            const existing = await SuperAdmin.existsByEmailOrPhone(email.trim().toLowerCase(), phoneClean);
            if (existing) {
                return res.status(409).json({
                    success: false,
                    message: existing.email === email.trim().toLowerCase()
                        ? 'Cet email est déjà utilisé'
                        : 'Ce numéro de téléphone est déjà utilisé',
                });
            }

            // 7. Hash
            const hashed = await bcrypt.hash(password, 12);

            // 8. Créer
            const id = await SuperAdmin.create({
                fullname: fullname.trim(),
                telephone: phoneClean,
                email: email.trim().toLowerCase(),
                password: hashed,
            });

            // 9. Récupérer le compte + générer token (auto-login)
            const sa = await SuperAdmin.findById(id);
            const token = jwt.sign(
                {
                    id_super_admin: sa.id_super_admin,
                    email: sa.email,
                    fullname: sa.fullname,
                    super_admin: true,
                },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRES }
            );

            return res.status(201).json({
                success: true,
                message: 'Compte super-admin créé',
                token,
                superAdmin: sa,
            });
        } catch (error) {
            console.error('❌ SuperAdminController.register:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    // ============================================================
    // 🔐 LOGIN
    // ============================================================
    static async login(req, res) {
        try {
            const { identifiant, password } = req.body;

            if (!identifiant || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Identifiant et mot de passe requis',
                });
            }

            const sa = await SuperAdmin.findByIdentifiant(identifiant.trim());
            const trace = (action, libelle, compte = sa) => JournalSuperAdmin.noter({
                id_super_admin: compte?.id_super_admin || null,
                acteur_nom: compte?.fullname || String(identifiant).trim().slice(0, 120),
                action, libelle, ip: req.ip, user_agent: req.headers['user-agent'],
            });
            if (!sa) {
                trace('echec_connexion', 'Connexion refusée : identifiant inconnu', null);
                return res.status(401).json({
                    success: false,
                    message: 'Identifiants incorrects',
                });
            }

            if (!sa.actif) {
                return res.status(403).json({
                    success: false,
                    message: 'Compte désactivé',
                });
            }

            if (sa.bloque_jusqua && new Date(sa.bloque_jusqua) > new Date()) {
                const minutes = Math.ceil((new Date(sa.bloque_jusqua) - new Date()) / 60000);
                trace('echec_connexion', 'Connexion refusée : compte bloqué');
                return res.status(429).json({
                    success: false,
                    message: `Compte bloqué. Réessaie dans ${minutes} min.`,
                });
            }

            const ok = await bcrypt.compare(password, sa.password);
            if (!ok) {
                await SuperAdmin.updateLoginFailure(sa.id_super_admin);
                const attempts = sa.tentatives_echouees + 1;
                if (attempts >= MAX_ATTEMPTS) {
                    trace('blocage', `Compte bloqué ${BLOCK_DURATION_MIN} min après ${attempts} codes faux`);
                    return res.status(429).json({
                        success: false,
                        message: `Trop de tentatives. Compte bloqué ${BLOCK_DURATION_MIN} min.`,
                    });
                }
                trace('echec_connexion', `Mot de passe faux (${attempts}/${MAX_ATTEMPTS})`);
                return res.status(401).json({
                    success: false,
                    message: `Identifiants incorrects (${MAX_ATTEMPTS - attempts} essai(s) restant(s))`,
                });
            }

            const ip = req.ip || req.connection.remoteAddress;
            await SuperAdmin.updateLoginSuccess(sa.id_super_admin, ip);
            trace('connexion', 'Connexion à la console');

            const token = jwt.sign(
                {
                    id_super_admin: sa.id_super_admin,
                    email: sa.email,
                    fullname: sa.fullname,
                    super_admin: true,
                },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRES }
            );

            return res.json({
                success: true,
                token,
                superAdmin: {
                    id_super_admin: sa.id_super_admin,
                    fullname: sa.fullname,
                    email: sa.email,
                    telephone: sa.telephone,
                },
            });
        } catch (error) {
            console.error('❌ SuperAdminController.login:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    // ============================================================
    // 👤 ME
    // ============================================================
    static async me(req, res) {
        try {
            const sa = await SuperAdmin.findById(req.superAdmin.id_super_admin);
            if (!sa) {
                return res.status(404).json({ success: false, message: 'Compte introuvable' });
            }
            return res.json({ success: true, superAdmin: sa });
        } catch (error) {
            console.error('❌ SuperAdminController.me:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    // ============================================================
    // PROFIL : modifier le nom affiché du compte
    // ============================================================
    static async profil(req, res) {
        try {
            const nom = String(req.body?.fullname || '').trim().slice(0, 100);
            if (nom.length < 2) return res.status(400).json({ success: false, message: 'Le nom doit faire au moins 2 caractères' });
            await pool.query('UPDATE super_admins SET fullname = ? WHERE id_super_admin = ?', [nom, req.superAdmin.id_super_admin]);
            const sa = await SuperAdmin.findById(req.superAdmin.id_super_admin);
            return res.json({ success: true, message: 'Nom modifié', superAdmin: sa });
        } catch (error) {
            console.error('SuperAdminController.profil:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    // ============================================================
    // 🔑 CHANGE PASSWORD
    // ============================================================
    static async changePassword(req, res) {
        try {
            const { ancien_password, nouveau_password } = req.body;
            if (!ancien_password || !nouveau_password) {
                return res.status(400).json({
                    success: false,
                    message: 'Ancien et nouveau mot de passe requis',
                });
            }
            if (nouveau_password.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nouveau mot de passe doit faire au moins 8 caractères',
                });
            }
            if (!/[A-Z]/.test(nouveau_password) || !/[0-9]/.test(nouveau_password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nouveau mot de passe doit contenir au moins une majuscule et un chiffre',
                });
            }

            const sa = await SuperAdmin.findByIdentifiant(req.superAdmin.email);
            if (!sa) {
                return res.status(404).json({ success: false, message: 'Compte introuvable' });
            }

            const ok = await bcrypt.compare(ancien_password, sa.password);
            if (!ok) {
                return res.status(401).json({
                    success: false,
                    message: 'Ancien mot de passe incorrect',
                });
            }

            const hashed = await bcrypt.hash(nouveau_password, 12);
            await SuperAdmin.updatePassword(sa.id_super_admin, hashed);

            return res.json({ success: true, message: 'Mot de passe modifié' });
        } catch (error) {
            console.error('❌ SuperAdminController.changePassword:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    // ============================================================
    // 🚪 LOGOUT
    // ============================================================
    static async logout(req, res) {
        return res.json({ success: true, message: 'Déconnecté' });
    }
}

export default SuperAdminController;