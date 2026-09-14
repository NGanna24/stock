// controllers/RapportVenteController.js
import RapportVente from '../models/RapportVente.js';

class RapportVenteController {
    /**
     * ============================================================
     * RAPPORT DES VENTES COMPLET
     * ============================================================
     */
    static async getRapportVentes(req, res) {
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
                parJour,
                parStatut,
                topClients
            ] = await Promise.all([
                RapportVente.getVentesByPeriod(debut, fin, req.workspaceId),
                RapportVente.getTotauxVentes(debut, fin, req.workspaceId),
                RapportVente.getVentesParProduit(debut, fin, req.workspaceId),
                RapportVente.getVentesParJour(debut, fin, req.workspaceId),
                RapportVente.getVentesParStatut(debut, fin, req.workspaceId),
                RapportVente.getTopClients(debut, fin, req.workspaceId, 10)
            ]);

            res.status(200).json({
                success: true,
                data: {
                    periode: { dateDebut: debut, dateFin: fin },
                    totaux,
                    commandes,
                    par_produit: parProduit,
                    par_jour: parJour,
                    par_statut: parStatut,
                    top_clients: topClients
                }
            });
        } catch (error) {
            console.error('❌ Erreur getRapportVentes:', error);
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
    static async exportRapportVentes(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;

            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            const debut = dateDebut || firstDayOfMonth.toISOString().split('T')[0];
            const fin = dateFin || lastDayOfMonth.toISOString().split('T')[0];

            const commandes = await RapportVente.getVentesByPeriod(debut, fin, req.workspaceId);
            const totaux = await RapportVente.getTotauxVentes(debut, fin, req.workspaceId);

            const headers = [
                'N° Commande', 'Date', 'Client', 'Téléphone',
                'Statut', 'Montant', 'N° Facture', 'Statut Facture', 'Mode paiement'
            ];

            const rows = commandes.map(c => [
                c.numero_commande,
                c.date_formatee || c.date_commande,
                c.nomclient || '',
                c.telephone || '',
                c.statut,
                c.montant_total,
                c.numero_facture || '',
                c.statut_facture || '',
                c.mode_paiement || ''
            ]);

            const csvContent = [
                `"Rapport des ventes du ${debut} au ${fin}"`,
                '',
                `"Nombre de commandes: ${totaux.nombre_commandes}"`,
                `"Chiffre d'affaires: ${totaux.chiffre_affaires} FCFA"`,
                `"Panier moyen: ${totaux.panier_moyen.toFixed(2)} FCFA"`,
                '',
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=rapport_ventes_${debut}_${dateFin}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportRapportVentes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation du rapport',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default RapportVenteController;