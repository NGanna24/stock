// controllers/CategorieController.js
import Categorie from '../models/Categorie.js';

class CategorieController {
    /**
     * Récupérer toutes les catégories
     */
    static async getAllCategories(req, res) {
        try {
            // ✅ Toujours req.workspaceId
            const categories = await Categorie.findAll(req.workspaceId);

            return res.status(200).json({
                success: true,
                count: categories.length,
                data: categories          // ← "data" au lieu de "categories" (cohérence)
            });
        } catch (error) {
            console.error('❌ GetAllCategories error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des catégories',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Récupérer une catégorie par son ID
     */
    static async getCategoryById(req, res) {
        try {
            const { id } = req.params;
            // ✅ req.workspaceId
            const category = await Categorie.findById(id, req.workspaceId);

            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                data: category
            });
        } catch (error) {
            console.error('❌ GetCategoryById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la catégorie'
            });
        }
    }

    /**
     * Créer une nouvelle catégorie
     */
    static async createCategory(req, res) {
        try {
            const { nom, description } = req.body;
            

            if (!nom) {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom de la catégorie est obligatoire'
                });
            }

            // ✅ idUtilisateur = req.workspaceId
            const categoryId = await Categorie.create({
                idUtilisateur: req.workspaceId,
                nom,
                description
            });

            const newCategory = await Categorie.findById(categoryId, req.workspaceId);

            return res.status(201).json({
                success: true,
                message: 'Catégorie créée avec succès',
                data: newCategory
            });
        } catch (error) {
            console.error('❌ CreateCategory error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la catégorie',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Mettre à jour une catégorie
     */
    static async updateCategory(req, res) {
        try {
            const { id } = req.params;
            const { nom, description } = req.body;

            // ✅ Vérifier existence avec req.workspaceId
            const existingCategory = await Categorie.findById(id, req.workspaceId);
            if (!existingCategory) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            const updatedCategory = await Categorie.update(id, req.workspaceId, {
                nom,
                description
            });

            if (!updatedCategory) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Catégorie mise à jour avec succès',
                data: updatedCategory
            });
        } catch (error) {
            console.error('❌ UpdateCategory error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de la catégorie',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Supprimer une catégorie
     */
    static async deleteCategory(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier existence
            const existingCategory = await Categorie.findById(id, req.workspaceId);
            if (!existingCategory) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            // ✅ Vérifier si elle a des produits DANS LE WORKSPACE
            const hasProducts = await Categorie.hasProducts(id, req.workspaceId);
            if (hasProducts) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible de supprimer la catégorie car elle contient des produits'
                });
            }

            const deleted = await Categorie.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Catégorie supprimée avec succès'
            });
        } catch (error) {
            console.error('❌ DeleteCategory error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de la catégorie',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Rechercher des catégories
     */
    static async searchCategories(req, res) {
        try {
            const { keyword } = req.query;

            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Le terme de recherche doit contenir au moins 2 caractères'
                });
            }

            // ✅ Modèle attend (idUtilisateur, keyword) → ordre respecté
            const categories = await Categorie.search(req.workspaceId, keyword);

            return res.status(200).json({
                success: true,
                count: categories.length,
                data: categories
            });
        } catch (error) {
            console.error('❌ SearchCategories error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche'
            });
        }
    }

    /**
     * Exporter les catégories en CSV
     */
    static async exportCategories(req, res) {
        try {
            // ✅ req.workspaceId
            const categories = await Categorie.findAll(req.workspaceId);

            const headers = ['ID', 'Nom', 'Description', 'Date création', 'Date modification'];
            const data = categories.map(c => [
                c.id_categorie,
                c.nom,
                c.description || '',
                c.date_creation,
                c.date_modification || ''
            ]);

            let csv = headers.join(',') + '\n';
            data.forEach(row => {
                csv += row.map(cell => `"${cell}"`).join(',') + '\n';
            });

            return res.status(200).json({
                success: true,
                data: csv
            });
        } catch (error) {
            console.error('❌ ExportCategories error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation'
            });
        }
    }

    /**
     * Récupérer les statistiques des catégories
     */
    static async getCategoryStats(req, res) {
        try {
            // ✅ req.workspaceId
            const total = await Categorie.count(req.workspaceId);
            const categories = await Categorie.findAll(req.workspaceId);

            const withProducts = categories.filter(c => c.nb_produits > 0).length;

            return res.status(200).json({
                success: true,
                data: {
                    total,
                    withProducts,
                    withoutProducts: total - withProducts
                }
            });
        } catch (error) {
            console.error('❌ GetCategoryStats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }
    }

    /**
     * Mettre à jour le statut d'une catégorie
     */
    static async updateCategoryStatus(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            // Valider le statut
            if (!statut || !['actif', 'inactif'].includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le statut doit être "actif" ou "inactif"'
                });
            }

            // ✅ Vérifier existence
            const existingCategory = await Categorie.findById(id, req.workspaceId);
            if (!existingCategory) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            // ✅ Modèle attend (id, userId, statut) → ordre respecté
            const updatedCategory = await Categorie.updateStatus(id, req.workspaceId, statut);

            if (!updatedCategory) {
                return res.status(404).json({
                    success: false,
                    message: 'Catégorie non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Statut de la catégorie mis à jour avec succès',
                data: updatedCategory
            });
        } catch (error) {
            console.error('❌ UpdateCategoryStatus error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du statut',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default CategorieController;