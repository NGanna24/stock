// controllers/AssistantAchatController.js
import AssistantAchat from '../models/AssistantAchat.js';

class AssistantAchatController {
    /**
     * ============================================================
     * GET /api/assistant-achat/proposition
     * ============================================================
     * Query params :
     *   - niveau : 'urgent' | 'normal' | 'large' (défaut: normal)
     */
    static async getProposition(req, res) {
        try {
            const niveau = ['urgent', 'normal', 'large'].includes(req.query.niveau)
                ? req.query.niveau
                : 'normal';

            const proposition = await AssistantAchat.getProposition(req.workspaceId, { niveau });

            return res.status(200).json({
                success: true,
                data: proposition,
            });
        } catch (error) {
            console.error('❌ getProposition assistant error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la génération de la proposition',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            });
        }
    }

    /**
     * ============================================================
     * POST /api/assistant-achat/creer
     * ============================================================
     * Body :
     *   {
     *     date_commande: 'YYYY-MM-DD' (optionnel),
     *     notes: string (optionnel),
     *     groupes: [
     *       {
     *         id_fournisseur: 1,
     *         lignes: [
     *           {
     *             id_produit, id_unite_vente, nom_unite_vente,
     *             quantite, quantite_base, quantite_totale_base,
     *             prix_achat
     *           }
     *         ]
     *       }
     *     ]
     *   }
     */
    static async creerBons(req, res) {
        try {
            const payload = req.body;

            if (!payload || !Array.isArray(payload.groupes) || payload.groupes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucun groupe de commande fourni',
                });
            }

            const result = await AssistantAchat.creerBons(req.workspaceId, payload);

            const statut = result.total_erreurs === 0 ? 201 : 207;

            return res.status(statut).json({
                success: result.total_crees > 0,
                message: result.total_erreurs === 0
                    ? `${result.total_crees} bon(s) de commande créé(s) avec succès`
                    : `${result.total_crees} bon(s) créé(s), ${result.total_erreurs} erreur(s)`,
                data: result,
            });
        } catch (error) {
            console.error('❌ creerBons assistant error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création des bons de commande',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            });
        }
    }
}

export default AssistantAchatController;