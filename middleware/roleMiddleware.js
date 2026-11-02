// middlewares/roleMiddleware.js
//
// Contrôle des rôles côté serveur.
//
// ⚠️ L'ancienne version relisait le rôle dans la table `utilisateurs` avec `req.user.id`.
//    Pour un EMPLOYÉ, `req.user.id` est un id_employe : on lisait donc le rôle d'un autre
//    compte (ex. l'employé n°1 récupérait le rôle de l'utilisateur n°1, souvent un admin).
//    Le rôle est maintenant pris dans `req.user.role`, déjà calculé correctement par
//    authenticateToken (employé ou compte principal). Plus aucune requête SQL ici.
import { authenticateToken } from './middleware.js';

const LIBELLES = {
    admin: 'administrateur',
    manager: 'manager',
    caissier: 'caissier',
    magasinier: 'magasinier',
};

/**
 * requireRole('admin', 'manager', ...)
 * Authentifie la requête si ce n'est pas déjà fait, puis vérifie le rôle.
 * Utilisable seul (app.use('/api/x', requireRole('admin'), routes)) ou après authenticateToken.
 */
export const requireRole = (...roles) => (req, res, next) => {
    const verifier = () => {
        const role = req.user?.role || req.userRole;
        if (!role) {
            return res.status(403).json({ success: false, message: 'Rôle non trouvé' });
        }
        if (!roles.includes(role)) {
            const qui = roles.map((r) => LIBELLES[r] || r).join(', ');
            return res.status(403).json({
                success: false,
                message: `Accès non autorisé. Action réservée aux profils : ${qui}.`,
            });
        }
        return next();
    };

    if (req.user) return verifier();
    return authenticateToken(req, res, verifier);
};

/**
 * requireRoleForWrites('admin')
 * Laisse passer les lectures (GET/HEAD/OPTIONS) à tout utilisateur connecté,
 * mais réserve les écritures (POST/PUT/PATCH/DELETE) aux rôles donnés.
 */
export const requireRoleForWrites = (...roles) => {
    const guard = requireRole(...roles);
    return (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        return guard(req, res, next);
    };
};

/** Compatibilité avec le code existant */
export const isAdmin = requireRole('admin');
export const isManagerOrAdmin = requireRole('admin', 'manager');
export const isStaff = requireRole('admin', 'manager', 'caissier');
