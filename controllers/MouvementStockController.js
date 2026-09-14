// controllers/MouvementStockController.js
import MouvementStock from '../models/MouvementStock.js';

class MouvementStockController {
    /**
     * ============================================================
     * Récupérer tous les mouvements du workspace (avec filtres)
     * ============================================================
     */
    static async getAllMouvements(req, res) { 
        try {
            // ✅ req.workspaceId en 2e argument
            const mouvements = await MouvementStock.findAll(req.query, req.workspaceId);
            res.status(200).json({
                success: true,
                count: mouvements.length,
                data: mouvements
            });
        } catch (error) {
            console.error('❌ Erreur getAllMouvements:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des mouvements',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un mouvement par ID
     * ============================================================
     */
    static async getMouvementById(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const mouvement = await MouvementStock.findById(id, req.workspaceId);

            if (!mouvement) {
                return res.status(404).json({
                    success: false,
                    message: 'Mouvement non trouvé'
                });
            }

            res.status(200).json({ success: true, data: mouvement });
        } catch (error) {
            console.error('❌ Erreur getMouvementById:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du mouvement',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les mouvements d'un produit
     * ============================================================
     */
    static async getMouvementsByProduit(req, res) {
        try {
            const { id_produit } = req.params;

            if (!id_produit || isNaN(id_produit)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de produit invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const mouvements = await MouvementStock.findByProduit(
                parseInt(id_produit),
                req.workspaceId
            );

            res.status(200).json({
                success: true,
                count: mouvements.length,
                data: mouvements
            });
        } catch (error) {
            console.error('❌ Erreur getMouvementsByProduit:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des mouvements du produit',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les mouvements par type
     * ============================================================
     */
    static async getMouvementsByType(req, res) {
        try {
            const { type } = req.params;
            const typesValides = ['entree', 'sortie', 'ajustement', 'transfert'];

            if (!typesValides.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: `Type invalide. Valeurs possibles: ${typesValides.join(', ')}`
                });
            }

            // ✅ Filtre + workspace
            const mouvements = await MouvementStock.findAll(
                { type_mouvement: type },
                req.workspaceId
            );

            res.status(200).json({
                success: true,
                count: mouvements.length,
                data: mouvements
            });
        } catch (error) {
            console.error('❌ Erreur getMouvementsByType:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des mouvements par type',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des mouvements (workspace)
     * ============================================================
     */
    static async getMouvementsStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await MouvementStock.getStats(req.workspaceId);

            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            console.error('❌ Erreur getMouvementsStats:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Exporter les mouvements du workspace en CSV
     * ============================================================
     */
    static async exportMouvements(req, res) {
        try {
            // ✅ req.workspaceId en 2e argument
            const mouvements = await MouvementStock.findAll(req.query, req.workspaceId);

            const headers = [
                'ID', 'Date', 'Type', 'Produit', 'Marque', 'Quantité',
                'Ancienne quantité', 'Nouvelle quantité',
                'Type référence', 'ID référence', 'Utilisateur', 'Notes'
            ];

            const rows = mouvements.map(m => [
                m.id_mouvement,
                m.date_mouvement_formatee || new Date(m.date_mouvement).toLocaleString('fr-FR'),
                m.type_mouvement,
                m.produit_nom || '',
                m.marque_nom || '',
                m.quantite || 0,
                m.ancienne_quantite || 0,
                m.nouvelle_quantite || 0,
                m.type_reference || '',
                m.id_reference || '',
                m.utilisateur_nom || '',
                (m.notes || '').replace(/"/g, '""')
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=mouvements_stock_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportMouvements:', error);
            res.status(500).json({
                success: false,
                message: "Erreur lors de l'exportation des mouvements",
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Derniers mouvements (dashboard) — par workspace
     * ============================================================
     */
    static async getDerniersMouvements(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;

            // ✅ Méthode dédiée du modèle
            const mouvements = await MouvementStock.getDerniers(limit, req.workspaceId);

            res.status(200).json({
                success: true,
                count: mouvements.length,
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
}

export default MouvementStockController;