// middleware/middleware.js
import jwt from 'jsonwebtoken';
import Utilisateur from '../models/Utilisateur.js';
import Employe from '../models/Employe.js';

/**
 * ============================================================
 * MIDDLEWARE D'AUTHENTIFICATION UNIFIÉ
 * ------------------------------------------------------------
 * Gère :
 *   - Les UTILISATEURS (table `utilisateurs`) — rôle admin
 *   - Les EMPLOYÉS (table `employes`) — rôles caissier, magasinier...
 *
 * ➜ Injecte TOUJOURS le `id_utilisateur` de l'utilisateur admin
 *   dans req.user.id_utilisateur (workspace)
 * ➜ Tous les controllers existants continuent de fonctionner
 * ============================================================
 */
export const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification manquant'
            });
        }

        jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', async (err, decoded) => {
            if (err) {
                return res.status(403).json({
                    success: false,
                    message: 'Token invalide ou expiré'
                });
            }

            try {
                let user = null;
                let type = null;        // 'utilisateur' | 'employe'
                let id_workspace = null; // ⭐ id de l'admin (workspace)
                let id_magasin = null;
                let role = null;

                // ============================================================
                // CAS 1 : EMPLOYÉ
                // ============================================================
                if (decoded.type === 'employe') {
                    user = await Employe.findById(decoded.id);

                    if (!user) {
                        return res.status(401).json({
                            success: false,
                            message: 'Employé introuvable'
                        });
                    }

                    type = 'employe';
                    id_workspace = user.id_utilisateur;   // ⭐ id de l'admin
                    id_magasin = user.id_magasin;
                    role = user.role_nom;
                }
                // ============================================================
                // CAS 2 : UTILISATEUR (admin)
                // ============================================================
                else {
                    user = await Utilisateur.findById(decoded.id);

                    if (!user) {
                        return res.status(401).json({
                            success: false,
                            message: 'Utilisateur introuvable'
                        });
                    }

                    type = 'utilisateur';
                    id_workspace = user.id_utilisateur;
                    role = user.role_nom;
                    id_magasin = req.headers['x-magasin-id'] || req.query.id_magasin || null;
                }

                // Vérification du statut actif
                if (!user.actif) {
                    return res.status(403).json({
                        success: false,
                        message: 'Compte désactivé'
                    });
                }

                // ✅ Objet `user` unifié
                req.user = {
                    id:             user.id_utilisateur || user.id_employe,
                    id_utilisateur: id_workspace,           // ⭐ WORKSPACE (admin)
                    id_employe:     user.id_employe || null,
                    type,                                    // 'utilisateur' | 'employe'
                    id_magasin,
                    role,                                    // 'admin' | 'caissier' | 'magasinier'...
                    fullname:       user.fullname,
                    telephone:      user.telephone,
                    slug:           user.slug,
                    actif:          user.actif
                };

                // Compatibilité avec l'ancien code
                req.workspaceId = id_workspace;
                req.userId = req.user.id;
                req.userRole = role;

                next();

            } catch (error) {
                console.error('❌ Auth middleware error:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur d\'authentification'
                });
            }
        });

    } catch (error) {
        console.error('❌ Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur d\'authentification'
        });
    }
};

/**
 * ============================================================
 * MIDDLEWARE D'AUTORISATION PAR RÔLES
 * ============================================================
 */
export const authorize = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        const userRole = req.user.role;

        if (Array.isArray(roles)) {
            if (!roles.includes(userRole)) {
                return res.status(403).json({
                    success: false,
                    message: `Accès refusé. Rôle requis: ${roles.join(' ou ')}`,
                    currentRole: userRole
                });
            }
        } else if (typeof roles === 'string') {
            if (userRole !== roles) {
                return res.status(403).json({
                    success: false,
                    message: `Accès refusé. Rôle requis: ${roles}`,
                    currentRole: userRole
                });
            }
        }

        next();
    };
};

/**
 * ============================================================
 * MIDDLEWARE : ADMIN UNIQUEMENT (le propriétaire du compte)
 * ============================================================
 */
export const isAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Non authentifié' });
    }
    if (req.user.type !== 'utilisateur' || req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Accès réservé à l\'administrateur'
        });
    }
    next();
};

/**
 * ============================================================
 * MIDDLEWARE : ADMIN OU MANAGER
 * ============================================================
 */
export const isAdminOrManager = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Non authentifié' });
    }
    if (req.user.role === 'admin' || req.user.role === 'manager') {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Accès refusé. Réservé à l\'administrateur ou au manager.'
    });
};

/**
 * ============================================================
 * MIDDLEWARE : PERMISSIONS PAR RÔLE
 * ------------------------------------------------------------
 * Utilisation : router.post('/', authenticateToken, can('ventes.creer'), ctrl.create)
 * ============================================================
 */
const ROLE_PERMISSIONS = {
    admin:      ['*'],
    manager:    ['*'],
    caissier: [
        'ventes.voir', 'ventes.creer', 'ventes.annuler',
        'paiements.voir', 'paiements.creer',
        'factures.voir', 'factures.creer',
        'clients.voir', 'clients.creer',
        'produits.voir',
        'recettes.voir',
        'retours_clients.voir', 'retours_clients.creer'
    ],
    magasinier: [
        'produits.voir', 'produits.creer', 'produits.modifier',
        'stocks.voir', 'stocks.entree', 'stocks.sortie',
        'inventaires.voir', 'inventaires.creer',
        'receptions.voir', 'receptions.creer',
        'achats.voir', 'fournisseurs.voir',
        'mouvements.voir'
    ]
};

export const can = (permission) => {
    return (req, res, next) => {
        const role = req.user?.role;

        if (!role) {
            return res.status(401).json({ success: false, message: 'Non authentifié' });
        }

        const perms = ROLE_PERMISSIONS[role] || [];

        if (perms.includes('*') || perms.includes(permission)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: `Permission refusée : ${permission}`,
            currentRole: role
        });
    };
};

/**
 * ============================================================
 * MIDDLEWARE : PROPRIÉTAIRE DE LA RESSOURCE
 * ============================================================
 */
export const isOwner = (getResourceUserId) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Non authentifié'
                });
            }

            if (req.user.role === 'admin') {
                return next();
            }

            const resourceUserId = await getResourceUserId(req);

            if (req.user.id !== resourceUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'Vous n\'êtes pas autorisé à accéder à cette ressource'
                });
            }

            next();
        } catch (error) {
            console.error('❌ IsOwner middleware error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur d\'autorisation'
            });
        }
    };
};

/**
 * ============================================================
 * MIDDLEWARE : VÉRIFICATION PERMISSIONS (ancienne API)
 * ============================================================
 */
export const hasPermission = (permission) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Non authentifié'
                });
            }

            const role = req.user.role;
            const perms = ROLE_PERMISSIONS[role] || [];

            if (!perms.includes('*') && !perms.includes(permission)) {
                return res.status(403).json({
                    success: false,
                    message: `Permission requise: ${permission}`,
                    currentRole: role
                });
            }

            next();
        } catch (error) {
            console.error('❌ HasPermission middleware error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur de vérification des permissions'
            });
        }
    };
};

/**
 * ============================================================
 * MIDDLEWARE : RATE LIMITING
 * ============================================================
 */
export const rateLimit = (maxRequests, windowMs = 60000) => {
    const requests = new Map();

    return (req, res, next) => {
        const key = req.ip || req.user?.id || req.connection.remoteAddress;
        const now = Date.now();

        if (!requests.has(key)) {
            requests.set(key, []);
        }

        const userRequests = requests.get(key);
        const validRequests = userRequests.filter(time => now - time < windowMs);

        if (validRequests.length >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: `Trop de requêtes. Limite: ${maxRequests} requêtes par ${windowMs/1000} secondes`
            });
        }

        validRequests.push(now);
        requests.set(key, validRequests);

        setTimeout(() => {
            const current = requests.get(key) || [];
            requests.set(key, current.filter(time => now - time < windowMs));
        }, windowMs);

        next();
    };
};

/**
 * ============================================================
 * MIDDLEWARE : JOURNALISATION
 * ============================================================
 */
export const logRequest = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress,
            user: req.user?.id || 'anonymous',
            userType: req.user?.type || 'unknown',
            userAgent: req.headers['user-agent']
        };

        console.log('📝 Request log:', JSON.stringify(log));
    });

    next();
};

/**
 * ============================================================
 * MIDDLEWARE : VALIDATION DES RÔLES (simplifié)
 * ============================================================
 */
export const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Non authentifié'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé',
                requiredRoles: allowedRoles,
                currentRole: req.user.role
            });
        }

        next();
    };
};

export default {
    authenticateToken,
    authorize,
    isAdmin,
    isAdminOrManager,
    can,
    isOwner,
    hasPermission,
    rateLimit,
    logRequest,
    requireRole
};