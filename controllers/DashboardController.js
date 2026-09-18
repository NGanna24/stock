// controllers/DashboardController.js
import Dashboard from '../models/Dashboard.js';

class DashboardController {
    static async getStats(req, res) {
        try {
            const stats = await Dashboard.getStatsCompletes(req.workspaceId);
            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            console.error('❌ Erreur getStats dashboard:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getKPIs(req, res) {
        try {
            const kpis = await Dashboard.getKPIs(req.workspaceId);
            res.status(200).json({ success: true, data: kpis });
        } catch (error) {
            console.error('❌ Erreur getKPIs:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des KPIs',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getVentesChart(req, res) {
        try {
            const jours = parseInt(req.query.jours) || 30;
            const chart = await Dashboard.getVentesChart(jours, req.workspaceId);
            res.status(200).json({ success: true, data: chart });
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
     * ✅ NOUVEAU : Bénéfices par jour
     */
    static async getBeneficesParJour(req, res) {
        try {
            const jours = parseInt(req.query.jours) || 30;
            const data = await Dashboard.getBeneficesParJour(jours, req.workspaceId);
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error('❌ Erreur getBeneficesParJour:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des bénéfices par jour',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getTopProduits(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const jours = parseInt(req.query.jours) || 30;
            const top = await Dashboard.getTopProduits(limit, jours, req.workspaceId);
            res.status(200).json({ success: true, data: top });
        } catch (error) {
            console.error('❌ Erreur getTopProduits:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des top produits',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getAlertes(req, res) {
        try {
            const alertes = await Dashboard.getAlertes(req.workspaceId);
            res.status(200).json({ success: true, data: alertes });
        } catch (error) {
            console.error('❌ Erreur getAlertes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des alertes',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getDerniersMouvements(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const mouvements = await Dashboard.getDerniersMouvements(limit, req.workspaceId);
            res.status(200).json({ success: true, data: mouvements });
        } catch (error) {
            console.error('❌ Erreur getDerniersMouvements:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des derniers mouvements',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getDernieresFactures(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const factures = await Dashboard.getDernieresFactures(limit, req.workspaceId);
            res.status(200).json({ success: true, data: factures });
        } catch (error) {
            console.error('❌ Erreur getDernieresFactures:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des dernières factures',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    static async getDernieresCommandes(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const commandes = await Dashboard.getDernieresCommandes(limit, req.workspaceId);
            res.status(200).json({ success: true, data: commandes });
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