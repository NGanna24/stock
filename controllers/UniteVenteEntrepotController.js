// controllers/UniteVenteEntrepotController.js
import UniteVenteEntrepot from '../models/UniteVenteEntrepot.js';

class UniteVenteEntrepotController {
    /**
     * GET /api/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente
     */
    static async getByProduitEntrepot(req, res) {
        try {
            const { id_entrepot, id_produit_entrepot } = req.params;

            if (!id_entrepot || isNaN(id_entrepot) ||
                !id_produit_entrepot || isNaN(id_produit_entrepot)) {
                return res.status(400).json({
                    success: false,
                    message: 'IDs invalides'
                });
            }

            const unites = await UniteVenteEntrepot.findByProduit(
                parseInt(id_produit_entrepot),
                parseInt(id_entrepot),
                req.workspaceId
            );

            res.status(200).json({
                success: true,
                count: unites.length,
                data: unites
            });
        } catch (error) {
            console.error('❌ Erreur getByProduitEntrepot:', error);
            res.status(error.message.includes('accès refusé') ? 403 : 500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * POST /api/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente
     */
    static async create(req, res) {
        try {
            const { id_entrepot, id_produit_entrepot } = req.params;
            const data = { ...req.body, id_produit_entrepot: parseInt(id_produit_entrepot) };

            if (!data.nom || !data.nom.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom de l\'unité est obligatoire'
                });
            }

            if (!data.quantite_base || parseFloat(data.quantite_base) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La quantité de base doit être supérieure à 0'
                });
            }

            if (!data.prix_vente || parseFloat(data.prix_vente) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le prix de vente doit être supérieur à 0'
                });
            }

            const id = await UniteVenteEntrepot.create(
                data,
                parseInt(id_entrepot),
                req.workspaceId
            );
            const unite = await UniteVenteEntrepot.findById(
                id,
                parseInt(id_entrepot),
                req.workspaceId
            );

            res.status(201).json({
                success: true,
                message: 'Unité de vente créée avec succès',
                data: unite
            });
        } catch (error) {
            console.error('❌ Erreur create unité vente entrepôt:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * PUT /api/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente/:id
     */
    static async update(req, res) {
        try {
            const { id_entrepot, id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID invalide'
                });
            }

            const updated = await UniteVenteEntrepot.update(
                parseInt(id),
                req.body,
                parseInt(id_entrepot),
                req.workspaceId
            );

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité de vente non trouvée'
                });
            }

            const unite = await UniteVenteEntrepot.findById(
                parseInt(id),
                parseInt(id_entrepot),
                req.workspaceId
            );

            res.status(200).json({
                success: true,
                message: 'Unité de vente mise à jour',
                data: unite
            });
        } catch (error) {
            console.error('❌ Erreur update unité vente entrepôt:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la mise à jour',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * DELETE /api/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente/:id
     */
    static async delete(req, res) {
        try {
            const { id_entrepot, id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID invalide'
                });
            }

            const deleted = await UniteVenteEntrepot.delete(
                parseInt(id),
                parseInt(id_entrepot),
                req.workspaceId
            );

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité de vente non trouvée'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Unité de vente supprimée'
            });
        } catch (error) {
            console.error('❌ Erreur delete unité vente entrepôt:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default UniteVenteEntrepotController;