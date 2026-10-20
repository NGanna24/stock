// controllers/AdminController.js
import Admin from '../models/Admin.js';

class AdminController {
    /**
     * GET /api/admin/dashboard
     * Retourne TOUT pour le dashboard en un seul appel
     */
    static async getDashboard(req, res) {
        try {
            const data = await Admin.getDashboardComplet();
            return res.json({ success: true, ...data });
        } catch (error) {
            console.error('❌ getDashboard:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }
    }

    /**
     * GET /api/admin/stats
     */
    static async getStats(req, res) {
        try {
            const stats = await Admin.getStatsGlobales();
            return res.json({ success: true, stats });
        } catch (error) {
            console.error('❌ getStats:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/utilisateurs?limit=50
     */
    static async getUtilisateurs(req, res) {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 500);
            const utilisateurs = await Admin.getDerniersUtilisateurs(limit);
            return res.json({ success: true, utilisateurs });
        } catch (error) {
            console.error('❌ getUtilisateurs:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/utilisateurs/:id
     */
    static async getUtilisateur(req, res) {
        try {
            const { id } = req.params;
            const utilisateur = await Admin.getUtilisateurDetail(id);
            if (!utilisateur) {
                return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
            }
            return res.json({ success: true, utilisateur });
        } catch (error) {
            console.error('❌ getUtilisateur:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * PATCH /api/admin/utilisateurs/:id/toggle
     * Body: { actif: true|false }
     */
    static async toggleUtilisateur(req, res) {
        try {
            const { id } = req.params;
            const { actif } = req.body;

            const ok = await Admin.toggleUtilisateur(id, actif);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
            }

            return res.json({
                success: true,
                message: `Utilisateur ${actif ? 'activé' : 'désactivé'}`
            });
        } catch (error) {
            console.error('❌ toggleUtilisateur:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/magasins-carte
     */
    static async getMagasinsCarte(req, res) {
        try {
            const magasins = await Admin.getMagasinsGeolocalises();
            return res.json({ success: true, magasins });
        } catch (error) {
            console.error('❌ getMagasinsCarte:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/top-produits
     */
    static async getTopProduits(req, res) {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 10, 100);
            const produits = await Admin.getTopProduitsGlobal(limit);
            return res.json({ success: true, produits });
        } catch (error) {
            console.error('❌ getTopProduits:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/activite?limit=20
     */
    static async getActivite(req, res) {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const activite = await Admin.getActiviteRecente(limit);
            return res.json({ success: true, activite });
        } catch (error) {
            console.error('❌ getActivite:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/inactifs?days=30
     */
    static async getInactifs(req, res) {
        try {
            const days = Math.min(parseInt(req.query.days) || 30, 365);
            const inactifs = await Admin.getUtilisateursInactifs(days);
            return res.json({ success: true, inactifs });
        } catch (error) {
            console.error('❌ getInactifs:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /**
     * GET /api/admin/geo
     */
    static async getGeo(req, res) {
        try {
            const geo = await Admin.getRepartitionGeographique();
            return res.json({ success: true, ...geo });
        } catch (error) {
            console.error('❌ getGeo:', error);
            return res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }
}

export default AdminController;