// controllers/MagasinAdminController.js
import MagasinAdmin from '../models/MagasinAdmin.js';

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

const mapLogos = (arr, baseUrl) =>
    (arr || []).map((m) => ({ ...m, logo_url: normalizeLogoUrl(m.logo_url, baseUrl) }));

class MagasinAdminController {
    /**
     * GET /api/super-admin/magasins
     * ?page=1&limit=20&search=&statut=tous|actif|inactif
     * &geolocalise=tous|oui|non&pays=&ville=&orderBy=&orderDir=
     */
    static async getListe(req, res) {
        try {
            const result = await MagasinAdmin.getListe(req.query);
            const baseUrl = getBaseUrl(req);
            result.magasins = mapLogos(result.magasins, baseUrl);
            return res.json({ success: true, ...result });
        } catch (error) {
            console.error('❌ MagasinAdminController.getListe:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/magasins/carte?limit=1000
     * Tous les magasins géolocalisés (vue carte).
     */
    static async getGeolocalises(req, res) {
        try {
            const limit = parseInt(req.query.limit, 10) || 1000;
            const rows = await MagasinAdmin.getGeolocalises(limit);
            const baseUrl = getBaseUrl(req);
            const magasins = mapLogos(rows, baseUrl);
            return res.json({ success: true, total: magasins.length, magasins });
        } catch (error) {
            console.error('❌ MagasinAdminController.getGeolocalises:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/magasins/stats
     */
    static async getStats(req, res) {
        try {
            const stats = await MagasinAdmin.getStats();
            return res.json({ success: true, stats });
        } catch (error) {
            console.error('❌ MagasinAdminController.getStats:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/magasins/filtres
     * Renvoie pays + villes pour peupler les selects.
     */
    static async getFiltres(req, res) {
        try {
            const pays = await MagasinAdmin.getPays();
            const villes = await MagasinAdmin.getVilles(req.query.pays || null);
            return res.json({ success: true, pays, villes });
        } catch (error) {
            console.error('❌ MagasinAdminController.getFiltres:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/super-admin/magasins/:id
     */
    static async getDetail(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id) || id < 1) {
                return res.status(400).json({ success: false, message: 'id invalide' });
            }
            const magasin = await MagasinAdmin.getDetail(id);
            if (!magasin) {
                return res.status(404).json({ success: false, message: 'Magasin introuvable' });
            }
            magasin.logo_url = normalizeLogoUrl(magasin.logo_url, getBaseUrl(req));
            return res.json({ success: true, magasin });
        } catch (error) {
            console.error('❌ MagasinAdminController.getDetail:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * PATCH /api/super-admin/magasins/:id/toggle
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

            const ok = await MagasinAdmin.toggleActif(id, actif);
            if (!ok) return res.status(404).json({ success: false, message: 'Magasin introuvable' });

            return res.json({
                success: true,
                message: `Magasin ${actif ? 'activé' : 'désactivé'}`,
            });
        } catch (error) {
            console.error('❌ MagasinAdminController.toggleActif:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * PATCH /api/super-admin/magasins/:id/geolocalisation
     * Body: { latitude, longitude, position_source? }
     */
    static async updateGeolocalisation(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            const { latitude, longitude, position_source } = req.body;

            if (isNaN(id) || id < 1) {
                return res.status(400).json({ success: false, message: 'id invalide' });
            }
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
                return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
            }

            const ok = await MagasinAdmin.updateGeolocalisation(id, {
                latitude: lat,
                longitude: lng,
                position_source: position_source || 'manuel',
            });
            if (!ok) return res.status(404).json({ success: false, message: 'Magasin introuvable' });

            return res.json({ success: true, message: 'Géolocalisation mise à jour' });
        } catch (error) {
            console.error('❌ MagasinAdminController.updateGeolocalisation:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }




    
}

export default MagasinAdminController;