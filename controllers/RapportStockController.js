// controllers/RapportStockController.js
import RapportStock from '../models/RapportStock.js';

class RapportStockController {
    /**
     * ============================================================
     * RAPPORT DES STOCKS COMPLET
     * ============================================================ 
     */
    static async getRapportStocks(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;

            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            const debut = dateDebut || firstDayOfMonth.toISOString().split('T')[0];
            const fin = dateFin || lastDayOfMonth.toISOString().split('T')[0];

            const [
                produits,
                totaux,
                parCategorie,
                parMarque,
                alertes,
                topValeur,
                mouvements
            ] = await Promise.all([
                RapportStock.getStockGlobal(req.workspaceId),
                RapportStock.getTotauxStock(req.workspaceId),
                RapportStock.getStockParCategorie(req.workspaceId),
                RapportStock.getStockParMarque(req.workspaceId),
                RapportStock.getProduitsEnAlerte(req.workspaceId),
                RapportStock.getTopValeurStock(req.workspaceId, 10),
                RapportStock.getMouvementsByPeriod(debut, fin, req.workspaceId)
            ]);

            res.status(200).json({
                success: true,
                data: {
                    periode: { dateDebut: debut, dateFin: fin },
                    totaux,
                    produits,
                    par_categorie: parCategorie,
                    par_marque: parMarque,
                    alertes,
                    top_valeur: topValeur,
                    mouvements
                }
            });
        } catch (error) {
            console.error('❌ Erreur getRapportStocks:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du rapport',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * EXPORT DU RAPPORT EN CSV
     * ============================================================
     */
    static async exportRapportStocks(req, res) {
        try {
            const produits = await RapportStock.getStockGlobal(req.workspaceId);
            const totaux = await RapportStock.getTotauxStock(req.workspaceId);

            const headers = [
                'ID', 'Produit', 'Catégorie', 'Marque', 'Modèle',
                'Stock', 'Stock Min', 'Stock Max', 'Unité',
                "Prix d'achat", 'Prix de vente', 'Valeur stock',
                'Emplacement', 'Rayon', 'Étagère', 'État'
            ];

            const rows = produits.map(p => [
                p.id_produit,
                p.produit_nom,
                p.categorie_nom || '',
                p.marque_nom || '',
                p.modele_nom || '',
                p.quantite_stock,
                p.quantite_minimale,
                p.quantite_maximale,
                p.unite_symbole || '',
                p.prix_achat,
                p.prix_vente,
                p.valeur_stock,
                p.emplacement || '',
                p.rayon || '',
                p.etagere || '',
                p.etat_stock
            ]);

            const csvContent = [
                `"Rapport des stocks - ${new Date().toLocaleDateString('fr-FR')}"`,
                '',
                `"Nombre de produits: ${totaux.nombre_produits}"`,
                `"Valeur d'achat totale: ${totaux.valeur_achat} FCFA"`,
                `"Valeur de vente totale: ${totaux.valeur_vente} FCFA"`,
                `"Produits en rupture: ${totaux.total_rupture}"`,
                `"Produits en stock bas: ${totaux.total_stock_bas}"`,
                '',
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=rapport_stocks_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportRapportStocks:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation du rapport',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default RapportStockController;