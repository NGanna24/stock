// middleware/middleware.js
import jwt from 'jsonwebtoken';
import Utilisateur from '../models/Utilisateur.js';

/**
 * Middleware d'authentification
 * Vérifie que l'utilisateur est connecté
 */
export const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split (' ')[1]; // Bearer TOKEN

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
                // Récupérer l'utilisateur complet depuis la base de données
                const user = await Utilisateur.findById(decoded.id);
                
                if (!user) {
                    return res.status(401).json({
                        success: false,
                        message: 'Utilisateur non trouvé'
                    });
                }

                if (!user.actif) {
                    return res.status(403).json({
                        success: false,
                        message: 'Compte désactivé'
                    });
                }

            req.user = {
                id: user.id_utilisateur,
                id_utilisateur: user.id_utilisateur,
                fullname: user.fullname,
                telephone: user.telephone,
                role: user.role,
                slug: user.slug,
                actif: user.actif
            };

            req.workspaceId = user.id_utilisateur;
            req.userId = user.id_utilisateur;
            req.userRole = user.role;

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
 * Middleware d'autorisation par rôles
 * Vérifie que l'utilisateur a le rôle requis
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
        
        // Si roles est un tableau
        if (Array.isArray(roles)) {
            if (!roles.includes(userRole)) {
                return res.status(403).json({
                    success: false,
                    message: `Accès refusé. Rôle requis: ${roles.join(' ou ')}`,
                    currentRole: userRole
                });
            }
        } 
        // Si roles est une chaîne
        else if (typeof roles === 'string') {
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
 * Middleware d'autorisation par propriétaire
 * Vérifie que l'utilisateur est le propriétaire de la ressource
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

            // Si l'utilisateur est admin, il peut tout faire
            if (req.user.role === 'admin') {
                return next();
            }

            // Récupérer l'ID du propriétaire de la ressource
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
 * Middleware de vérification des permissions
 * Vérifie des permissions spécifiques
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

            // Récupérer les permissions de l'utilisateur depuis la base de données
            // Cette partie dépend de votre système de permissions
            const userPermissions = await getUserPermissions(req.user.id);
            
            if (!userPermissions.includes(permission)) {
                return res.status(403).json({
                    success: false,
                    message: `Permission requise: ${permission}`,
                    currentPermissions: userPermissions
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
 * Middleware de limitation de taux (Rate Limiting)
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

        // Nettoyer les anciennes requêtes
        setTimeout(() => {
            const current = requests.get(key) || [];
            requests.set(key, current.filter(time => now - time < windowMs));
        }, windowMs);

        next();
    };
};

/**
 * Middleware de journalisation
 */
export const logRequest = (req, res, next) => {
    const start = Date.now();
    
    // Journaliser après la réponse
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
            userAgent: req.headers['user-agent']
        };
        
        console.log('📝 Request log:', JSON.stringify(log));
    });

    next();
};

/**
 * Middleware de validation des rôles (version simplifiée)
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
    isOwner,
    hasPermission,
    rateLimit,
    logRequest,
    requireRole
};