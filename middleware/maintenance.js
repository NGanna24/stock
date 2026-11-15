// middleware/maintenance.js
// Quand la maintenance est activée depuis la console Super Admin, l'API des patrons
// et des employés répond 503 avec le message choisi. La console reste accessible.
import Plateforme from '../models/Plateforme.js';

const LIBRES = [/^\/super-admin(\/|$)/, /^\/admin(\/|$)/, /^\/plateforme(\/|$)/, /^\/ping$/];

export async function maintenance(req, res, next) {
    try {
        if (req.method === 'OPTIONS' || LIBRES.some((r) => r.test(req.path))) return next();
        const m = await Plateforme.enMaintenance();
        if (!m) return next();
        return res.status(503).json({ success: false, maintenance: true, message: m.message, fin_prevue: m.fin_prevue || null });
    } catch {
        return next();
    }
}
