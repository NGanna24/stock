// controllers/RapportAchatController.js
import RapportAchat from '../models/RapportAchat.js';

class RapportAchatController {
    /**
     * ============================================================
     * RAPPORT DES ACHATS COMPLET
     * ============================================================
     */
    static async getRapportAchats(req, res) { 
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
                topFournisseurs
            ] = await Promise.all([
                RapportAchat.getAchatsByPeriod(debut, fin, req.workspaceId),
                RapportAchat.getTotauxAchats(debut, fin, req.workspaceId),
                RapportAchat.getAchatsParProduit(debut, fin, req.workspaceId),
                RapportAchat.getAchatsParJour(debut, fin, req.workspaceId),
                RapportAchat.getAchatsParStatut(debut, fin, req.workspaceId),
                RapportAchat.getTopFournisseurs(debut, fin, req.workspaceId, 10)
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
                    top_fournisseurs: topFournisseurs
                }
            });
        } catch (error) {
            console.error('❌ Erreur getRapportAchats:', error);
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
    static async exportRapportAchats(req, res) {
        try {
            const { dateDebut, dateFin } = req.query;

            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            const debut = dateDebut || firstDayOfMonth.toISOString().split('T')[0];
            const fin = dateFin || lastDayOfMonth.toISOString().split('T')[0];

            const commandes = await RapportAchat.getAchatsByPeriod(debut, fin, req.workspaceId);
            const totaux = await RapportAchat.getTotauxAchats(debut, fin, req.workspaceId);

            const headers = [
                'N° Commande', 'Date', 'Fournisseur', 'Téléphone', 'Ville',
                'Statut', 'Montant', 'N° Réception', 'Statut Réception'
            ];

            const rows = commandes.map(c => [
                c.numero_commande,
                c.date_formatee || c.date_commande,
                c.fournisseur_nom || '',
                c.fournisseur_telephone || '',
                c.fournisseur_ville || '',
                c.statut,
                c.montant_total,
                c.numero_reception || '',
                c.statut_reception || ''
            ]);

            const csvContent = [
                `"Rapport des achats du ${debut} au ${fin}"`,
                '',
                `"Nombre de commandes: ${totaux.nombre_commandes}"`,
                `"Montant total: ${totaux.montant_total} FCFA"`,
                `"Panier moyen: ${totaux.panier_moyen.toFixed(2)} FCFA"`,
                '',
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=rapport_achats_${debut}_${fin}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportRapportAchats:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation du rapport',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default RapportAchatController;