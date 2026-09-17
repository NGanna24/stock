// controllers/AlerteController.js
import Alerte from '../models/Alerte.js';

class AlerteController {
    /**
     * ============================================================
     * LISTE COMPLÈTE DES ALERTES
     * ============================================================
     */ 
    static async getAllAlertes(req, res) {
        try {
            const [
                alertes,
                stats,
                parCategorie,
                parFournisseur,
                ruptures,
                stockBas
            ] = await Promise.all([
                Alerte.findAll(req.workspaceId),
                Alerte.getStats(req.workspaceId),
                Alerte.getAlertesParCategorie(req.workspaceId),
                Alerte.getAlertesParFournisseur(req.workspaceId),
                Alerte.getRuptures(req.workspaceId),
                Alerte.getStockBas(req.workspaceId)
            ]);

            res.status(200).json({
                success: true,
                count: alertes.length,
                data: {
                    alertes,
                    stats,
                    par_categorie: parCategorie,
                    par_fournisseur: parFournisseur,
                    ruptures,
                    stock_bas: stockBas
                }
            });
        } catch (error) {
            console.error('❌ Erreur getAllAlertes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des alertes',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * STATISTIQUES SEULES
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await Alerte.getStats(req.workspaceId);
            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getStats alertes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * RUPTURES UNIQUEMENT
     * ============================================================
     */
    static async getRuptures(req, res) {
        try {
            const ruptures = await Alerte.getRuptures(req.workspaceId);
            res.status(200).json({
                success: true,
                count: ruptures.length,
                data: ruptures
            });
        } catch (error) {
            console.error('❌ Erreur getRuptures:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des ruptures',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * STOCK BAS UNIQUEMENT
     * ============================================================
     */
    static async getStockBas(req, res) {
        try {
            const stockBas = await Alerte.getStockBas(req.workspaceId);
            res.status(200).json({
                success: true,
                count: stockBas.length,
                data: stockBas
            });
        } catch (error) {
            console.error('❌ Erreur getStockBas:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des stocks bas',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * EXPORT CSV DES ALERTES
     * ============================================================
     */
    static async exportAlertes(req, res) {
        try {
            const alertes = await Alerte.findAll(req.workspaceId);
            const stats = await Alerte.getStats(req.workspaceId);

            const headers = [
                'Type', 'Produit', 'Catégorie', 'Marque',
                'Stock', 'Stock Min', 'Stock Max', 'Unité',
                "Prix d'achat", 'Qté à commander', 'Valeur à commander',
                'Fournisseur', 'Téléphone'
            ];

            const rows = alertes.map(a => [
                a.type_alerte,
                a.produit_nom,
                a.categorie_nom || '',
                a.marque_nom || '',
                a.quantite_stock,
                a.quantite_minimale,
                a.quantite_maximale,
                a.unite_symbole || '',
                a.prix_achat,
                a.quantite_a_commander,
                a.valeur_manque,
                a.fournisseur_nom || '',
                a.fournisseur_telephone || ''
            ]);

            const csvContent = [
                `"Alertes de stock - ${new Date().toLocaleDateString('fr-FR')}"`,
                '',
                `"Total alertes: ${stats.total_alertes}"`,
                `"Ruptures: ${stats.total_rupture}"`,
                `"Stock bas: ${stats.total_stock_bas}"`,
                `"Surstock: ${stats.total_surstock}"`,
                `"Valeur à commander: ${stats.valeur_reapprovisionnement} FCFA"`,
                '',
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=alertes_stock_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportAlertes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default AlerteController;