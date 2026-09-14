// middlewares/roleMiddleware.js
import { pool } from '../config/db.js';

/**
 * Récupérer le rôle de l'utilisateur depuis la base de données
 */ 
const getUserRole = async (userId) => {
    try {
        const [rows] = await pool.execute(
            `SELECT r.nom as role 
             FROM utilisateurs u
             JOIN roles r ON u.id_role = r.id_role
             WHERE u.id_utilisateur = ?`,
            [userId]
        );
        console.log('le role : ',rows[0]?.role);
        return rows[0]?.role || null;
    } catch (error) {
        console.error('❌ Erreur lors de la récupération du rôle:', error);
        return null;
    }
};

/**
 * Middleware pour vérifier que l'utilisateur est admin
 */
export const isAdmin = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Non authentifié'
        });
    }

    try {
        const role = await getUserRole(req.user.id);
        
        if (!role) {
            return res.status(403).json({
                success: false,
                message: 'Rôle non trouvé'
            });
        }

        if (role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé. Seul un administrateur peut effectuer cette action.'
            });
        }

        // Ajouter le rôle à l'objet req pour un usage ultérieur
        req.user.role = role;
        next();
    } catch (error) {
        console.error('❌ Erreur dans isAdmin:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la vérification des permissions'
        });
    }
};

/**
 * Middleware pour vérifier que l'utilisateur est manager ou admin
 */
export const isManagerOrAdmin = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Non authentifié'
        });
    }

    try {
        const role = await getUserRole(req.user.id);
        
        console.log('🔍 Rôle récupéré pour l\'utilisateur:', req.user.id, '->', role);

        if (!role) {
            return res.status(403).json({
                success: false,
                message: 'Rôle non trouvé'
            });
        }

        if (!['admin', 'manager'].includes(role)) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé. Seul un manager ou un administrateur peut effectuer cette action.'
            });
        }

        // Ajouter le rôle à l'objet req pour un usage ultérieur
        req.user.role = role;
        next();
    } catch (error) {
        console.error('❌ Erreur dans isManagerOrAdmin:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la vérification des permissions'
        });
    }
};

/**
 * Middleware pour vérifier que l'utilisateur est caissier, manager ou admin
 */
export const isStaff = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Non authentifié'
        });
    }

    try {
        const role = await getUserRole(req.user.id);
        
        if (!role) {
            return res.status(403).json({
                success: false,
                message: 'Rôle non trouvé'
            });
        }

        if (!['admin', 'manager', 'caissier'].includes(role)) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé. Vous devez être membre du staff.'
            });
        }

        // Ajouter le rôle à l'objet req pour un usage ultérieur
        req.user.role = role;
        next();
    } catch (error) {
        console.error('❌ Erreur dans isStaff:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la vérification des permissions'
        });
    }
};