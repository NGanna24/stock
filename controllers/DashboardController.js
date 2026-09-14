// controllers/DashboardController.js
import Dashboard from '../models/Dashboard.js';

class DashboardController {
    /**
     * ============================================================
     * Récupérer TOUTES les statistiques du dashboard (workspace)
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Dashboard.getStatsCompletes(req.workspaceId);
            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getStats dashboard:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer uniquement les KPIs (workspace)
     * ============================================================
     */
    static async getKPIs(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const kpis = await Dashboard.getKPIs(req.workspaceId);
            res.status(200).json({
                success: true,
                data: kpis
            });
        } catch (error) {
            console.error('❌ Erreur getKPIs:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des KPIs',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer le graphique des ventes (workspace)
     * ============================================================
     */
    static async getVentesChart(req, res) {
        try {
            const jours = parseInt(req.query.jours) || 30;
            // ✅ req.workspaceId en 2e argument
            const chart = await Dashboard.getVentesChart(jours, req.workspaceId);
            res.status(200).json({
                success: true,
                data: chart
            });
        } catch (error) {
            console.error('❌ Erreur getVentesChart:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du graphique',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer le top des produits (workspace)
     * ============================================================
     */
    static async getTopProduits(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const jours = parseInt(req.query.jours) || 30;
            // ✅ req.workspaceId en 3e argument
            const top = await Dashboard.getTopProduits(limit, jours, req.workspaceId);
            res.status(200).json({
                success: true,
                data: top
            });
        } catch (error) {
            console.error('❌ Erreur getTopProduits:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des top produits',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les alertes de stock (workspace)
     * ============================================================
     */
    static async getAlertes(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const alertes = await Dashboard.getAlertes(req.workspaceId);
            res.status(200).json({
                success: true,
                data: alertes
            });
        } catch (error) {
            console.error('❌ Erreur getAlertes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des alertes',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les derniers mouvements (workspace)
     * ============================================================
     */
    static async getDerniersMouvements(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            // ✅ req.workspaceId en 2e argument
            const mouvements = await Dashboard.getDerniersMouvements(limit, req.workspaceId);
            res.status(200).json({
                success: true,
                data: mouvements
            });
        } catch (error) {
            console.error('❌ Erreur getDerniersMouvements:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des derniers mouvements',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les dernières factures (workspace)
     * ============================================================
     */
    static async getDernieresFactures(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            // ✅ req.workspaceId en 2e argument
            const factures = await Dashboard.getDernieresFactures(limit, req.workspaceId);
            res.status(200).json({
                success: true,
                data: factures
            });
        } catch (error) {
            console.error('❌ Erreur getDernieresFactures:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des dernières factures',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les dernières commandes (workspace)
     * ============================================================
     */
    static async getDernieresCommandes(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            // ✅ req.workspaceId en 2e argument
            const commandes = await Dashboard.getDernieresCommandes(limit, req.workspaceId);
            res.status(200).json({
                success: true,
                data: commandes
            });
        } catch (error) {
            console.error('❌ Erreur getDernieresCommandes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des dernières commandes',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default DashboardController;