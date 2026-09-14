// controllers/UniteVenteController.js
import UniteVente from '../models/UniteVente.js';

class UniteVenteController {
    /**
     * ============================================================
     * GET /api/produits/:id_produit/unites-vente
     * Récupérer les unités de vente d'un produit
     * ============================================================
     */
    static async getByProduit(req, res) {
        try {
            const { id_produit } = req.params;

            if (!id_produit || isNaN(id_produit)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID produit invalide'
                });
            }

            const unites = await UniteVente.findByProduit(
                parseInt(id_produit),
                req.workspaceId
            );

            res.status(200).json({
                success: true,
                count: unites.length,
                data: unites
            });

        } catch (error) {
            console.error('❌ Erreur getByProduit unités vente:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * POST /api/unites-vente
     * Créer une unité de vente
     * ============================================================
     */
    static async create(req, res) {
        try {
            const data = req.body;

            // Validations
            if (!data.id_produit) {
                return res.status(400).json({
                    success: false,
                    message: 'Le produit est obligatoire'
                });
            }

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

            const id = await UniteVente.create(data, req.workspaceId);
            const unite = await UniteVente.findById(id, req.workspaceId);

            res.status(201).json({
                success: true,
                message: 'Unité de vente créée avec succès',
                data: unite
            });

        } catch (error) {
            console.error('❌ Erreur create unité vente:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * PUT /api/unites-vente/:id
     * Mettre à jour une unité de vente
     * ============================================================
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const data = req.body;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID invalide'
                });
            }

            const updated = await UniteVente.update(
                parseInt(id),
                data,
                req.workspaceId
            );

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité de vente non trouvée'
                });
            }

            const unite = await UniteVente.findById(parseInt(id), req.workspaceId);

            res.status(200).json({
                success: true,
                message: 'Unité de vente mise à jour',
                data: unite
            });

        } catch (error) {
            console.error('❌ Erreur update unité vente:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la mise à jour',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * DELETE /api/unites-vente/:id
     * Supprimer une unité de vente
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID invalide'
                });
            }

            const deleted = await UniteVente.delete(parseInt(id), req.workspaceId);

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
            console.error('❌ Erreur delete unité vente:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default UniteVenteController;