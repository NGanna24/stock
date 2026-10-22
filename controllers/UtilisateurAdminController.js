// controllers/UtilisateurAdminController.js
import UtilisateurAdmin from '../models/UtilisateurAdmin.js';

const getBaseUrl = (req) => {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    return `${req.protocol}://${req.get('host')}`;
};

const normalizeLogoUrl = (logoUrl, baseUrl) => {
    if (!logoUrl) return null;
    const v = String(logoUrl).trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    return `${baseUrl}${v.startsWith('/') ? '' : '/'}${v}`;
};

class UtilisateurAdminController {
    /**
     * GET /api/super-admin/utilisateurs
     * ?page=1&limit=20&search=&statut=tous|actif|inactif&jamaisConnecte=1
     */
    static async getListe(req, res) {
        try {
            const result = await UtilisateurAdmin.getListe(req.query);
            const baseUrl = getBaseUrl(req);

            result.utilisateurs = result.utilisateurs.map((u) => ({
                ...u,
                logo_magasin: normalizeLogoUrl(u.logo_magasin, baseUrl),
            }));

            return res.json({ success: true, ...result });
        } catch (error) {
            console.error('❌ UtilisateurAdminController.getListe:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/utilisateurs/stats
     */
    static async getStats(req, res) {
        try {
            const stats = await UtilisateurAdmin.getStats();
            return res.json({ success: true, stats });
        } catch (error) {
            console.error('❌ UtilisateurAdminController.getStats:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/utilisateurs/inactifs?days=30
     */
    static async getInactifs(req, res) {
        try {
            const days = parseInt(req.query.days, 10) || 30;
            const inactifs = await UtilisateurAdmin.getInactifs(days);
            return res.json({ success: true, total: inactifs.length, inactifs });
        } catch (error) {
            console.error('❌ UtilisateurAdminController.getInactifs:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/utilisateurs/:id
     */
    static async getDetail(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id) || id < 1) {
                return res.status(400).json({ success: false, message: 'id invalide' });
            }

            const detail = await UtilisateurAdmin.getDetail(id);
            if (!detail) {
                return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
            }

            const baseUrl = getBaseUrl(req);
            detail.magasins = detail.magasins.map((m) => ({
                ...m,
                logo_url: normalizeLogoUrl(m.logo_url, baseUrl),
            }));

            return res.json({ success: true, ...detail });
        } catch (error) {
            console.error('❌ UtilisateurAdminController.getDetail:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * PATCH /api/super-admin/utilisateurs/:id/toggle
     * Body: { actif: true|false }
     */
    static async toggleActif(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            const { actif } = req.body;

            if (isNaN(id) || id < 1) {
                return res.status(400).json({ success: false, message: 'id invalide' });
            }
            if (typeof actif !== 'boolean') {
                return res.status(400).json({ success: false, message: '"actif" doit être un booléen' });
            }

            const ok = await UtilisateurAdmin.toggleActif(id, actif);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
            }

            return res.json({
                success: true,
                message: `Utilisateur ${actif ? 'activé' : 'désactivé'}`,
            });
        } catch (error) {
            console.error('❌ UtilisateurAdminController.toggleActif:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }
}

export default UtilisateurAdminController;