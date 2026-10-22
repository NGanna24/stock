// middleware/superAdminAuth.js
import jwt from 'jsonwebtoken';

export const authenticateSuperAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Token manquant' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SUPER_ADMIN_SECRET, {
            algorithms: ['HS256'],
        });

        if (!decoded.super_admin) {
            return res.status(403).json({ success: false, message: 'Token invalide' });
        }

        req.superAdmin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: err.name === 'TokenExpiredError'
                ? 'Session expirée, reconnecte-toi'
                : 'Token invalide',
        });
    }
};