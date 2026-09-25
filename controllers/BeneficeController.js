// controllers/BeneficeController.js
import Benefice from '../models/Benefice.js';

class BeneficeController {
    /**
     * ============================================================
     * RAPPORT BÉNÉFICES & MARGES COMPLET
     * ============================================================
     */
    static async getBenefices(req, res) { 
        try {
            const { dateDebut, dateFin } = req.query;

            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            const debut = dateDebut || firstDayOfMonth.toISOString().split('T')[0];
            const fin = dateFin || lastDayOfMonth.toISOString().split('T')[0];

            const [
                commandes,
                totaux,
                parProduit,
                parCategorie,
                parJour,
                topProduits,
                topClients,
                produitsRentables
            ] = await Promise.all([
                Benefice.getBeneficesByPeriod(debut, fin, req.workspaceId),
                Benefice.getTotauxBenefices(debut, fin, req.workspaceId),
                Benefice.getBeneficesParProduit(debut, fin, req.workspaceId),
                Benefice.getBeneficesParCategorie(debut, fin, req.workspaceId),
                Benefice.getBeneficesParJour(debut, fin, req.workspaceId),
                Benefice.getTopProduitsBenefice(debut, fin, req.workspaceId, 10),
                Benefice.getTopClientsBenefice(debut, fin, req.workspaceId, 10),
                Benefice.getProduitsPlusRentables(debut, fin, req.workspaceId, 10)
            ]);

            res.status(200).json({
                success: true,
                data: {
                    periode: { dateDebut: debut, dateFin: fin },
                    totaux,
                    commandes,
                    par_produit: parProduit,
                    par_categorie: parCategorie,
                    par_jour: parJour,
                    top_produits: topProduits,
                    top_clients: topClients,
                    produits_rentables: produitsRentables
                }
            });
        } catch (error) {
            console.error('❌ Erreur getBenefices:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des bénéfices',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * EXPORT DU RAPPORT EN CSV
     * ============================================================
     */
    static async exportBenefices(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;

            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            const debut = dateDebut || firstDayOfMonth.toISOString().split('T')[0];
            const fin = dateFin || lastDayOfMonth.toISOString().split('T')[0];

            const produits = await Benefice.getBeneficesParProduit(debut, fin, req.workspaceId);
            const totaux = await Benefice.getTotauxBenefices(debut, fin, req.workspaceId);

            const headers = [
                'Produit', 'Marque', 'Catégorie', 'Qté vendue',
                "Prix d'achat", 'Prix de vente', 'Marge unitaire', 'Marge %',
                "Chiffre d'affaires", 'Coût achat', 'Bénéfice'
            ];

            const rows = produits.map(p => [
                p.produit_nom,
                p.marque_nom || '',
                p.categorie_nom || '',
                p.quantite_vendue,
                p.prix_achat,
                p.prix_vente,
                p.marge_unitaire,
                p.marge_unitaire_pct.toFixed(2),
                p.chiffre_affaires,
                p.cout_achat,
                p.benefice
            ]);

            const csvContent = [
                `"Rapport Bénéfices & Marges du ${debut} au ${fin}"`,
                '',
                `"Chiffre d'affaires: ${totaux.chiffre_affaires} FCFA"`,
                `"Coût d'achat: ${totaux.cout_achat} FCFA"`,
                `"Bénéfice brut: ${totaux.benefice_brut} FCFA"`,
                `"Marge brute: ${totaux.marge_brute_pct.toFixed(2)}%"`,
                `"Taux de marge: ${totaux.taux_marge.toFixed(2)}%"`,
                '',
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=benefices_${debut}_${fin}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportBenefices:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default BeneficeController;