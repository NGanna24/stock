// controllers/DashboardController.js
import Dashboard from '../models/Dashboard.js';
import { aModule, permissionsDe } from '../utils/permissions.js';

// Ce que le rôle a le droit de voir sur l'accueil (réglé par le propriétaire)
async function accesAccueil(req) {
    await permissionsDe(req);
    const peut = (...pages) => pages.some((p) => aModule(req, p));
    return {
        ventes: peut('rapport-ventes'),
        ventesJour: peut('rapport-ventes', 'caisse', 'commandes-clients'),
        benefices: peut('benefices'),
        impayes: peut('factures', 'relances', 'clients'),
        factures: peut('factures'),
        commandes: peut('commandes-clients'),
        mouvements: peut('mouvements', 'produits'),
        alertes: peut('alertes', 'produits'),
    };
}

// Retire les chiffres interdits (ils ne quittent pas le serveur)
function filtrerKpis(k, a) {
    if (!k) return k;
    const out = { ...k };
    if (!a.ventes) out.ventes_mois = null;
    if (!a.ventesJour) out.ventes_jour = null;
    if (!a.benefices) {
        out.benefices_mois = null;
        out.benefices_jour = null;
        out.marge_moyenne_pct = null;
        out.produits_sans_cout = 0;
        out.produits_sans_cout_jour = 0;
    }
    if (!a.impayes) {
        out.factures_impayees = null;
        out.montant_impaye = null;
    }
    return out;
}

class DashboardController {
    static async getStats(req, res) {
        try {
            const [stats, a] = await Promise.all([Dashboard.getStatsCompletes(req.workspaceId), accesAccueil(req)]);
            const data = {
                ...stats,
                kpis: filtrerKpis(stats.kpis, a),
                ventes_chart: a.ventes ? stats.ventes_chart : [],
                benefices_chart: a.benefices ? stats.benefices_chart : [],
                ventes_jour_chart: a.ventesJour ? stats.ventes_jour_chart : [],
                ventes_semaine: a.ventes ? stats.ventes_semaine : [],
                top_produits: a.ventes ? stats.top_produits : [],
                derniers_mouvements: a.mouvements ? stats.derniers_mouvements : [],
                dernieres_factures: a.factures ? stats.dernieres_factures : [],
                dernieres_commandes: a.commandes ? stats.dernieres_commandes : [],
                acces: a,
            };
            res.status(200).json({ success: true, data });
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
            const [kpis, a] = await Promise.all([Dashboard.getKPIs(req.workspaceId), accesAccueil(req)]);
            res.status(200).json({ success: true, data: filtrerKpis(kpis, a) });
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
            if (!(await accesAccueil(req)).ventes) return res.status(200).json({ success: true, data: [] });
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
            if (!(await accesAccueil(req)).benefices) return res.status(200).json({ success: true, data: [] });
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
            if (!(await accesAccueil(req)).ventes) return res.status(200).json({ success: true, data: [] });
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
            if (!(await accesAccueil(req)).mouvements) return res.status(200).json({ success: true, data: [] });
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
            if (!(await accesAccueil(req)).factures) return res.status(200).json({ success: true, data: [] });
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
            if (!(await accesAccueil(req)).commandes) return res.status(200).json({ success: true, data: [] });
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