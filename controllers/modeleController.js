// controllers/ModeleController.js
import Modele from '../models/Modele.js';

class ModeleController {
    /**
     * ============================================================
     * Récupérer tous les modèles du workspace
     * ============================================================
     */
    static async getAllModeles(req, res) {
        try {
            // ✅ req.workspaceId
            const modeles = await Modele.findAll(req.workspaceId);
            res.status(200).json({
                success: true,
                count: modeles.length,
                data: modeles
            });
        } catch (error) {
            console.error('❌ Erreur getAllModeles:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des modèles',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un modèle par ID
     * ============================================================
     */
    static async getModeleById(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const modele = await Modele.findById(id, req.workspaceId);

            if (!modele) {
                return res.status(404).json({
                    success: false,
                    message: 'Modèle non trouvé'
                });
            }

            res.status(200).json({
                success: true,
                data: modele
            });
        } catch (error) {
            console.error('❌ Erreur getModeleById:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du modèle',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un modèle par son nom
     * ============================================================
     */
    static async getModeleByNom(req, res) {
        try {
            const { nom } = req.params;

            // ✅ req.workspaceId en 2e argument
            const modele = await Modele.findByNom(nom, req.workspaceId);

            if (!modele) {
                return res.status(404).json({
                    success: false,
                    message: 'Modèle non trouvé'
                });
            }

            res.status(200).json({
                success: true,
                data: modele
            });
        } catch (error) {
            console.error('❌ Erreur getModeleByNom:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du modèle',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Créer un nouveau modèle
     * ============================================================
     */
    static async createModele(req, res) {
        try {
            const { nom } = req.body;

            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom du modèle est requis'
                });
            }

            // ✅ Vérifier doublon DANS le workspace
            const nomExiste = await Modele.nomExists(nom.trim(), req.workspaceId);
            if (nomExiste) {
                return res.status(409).json({
                    success: false,
                    message: 'Un modèle avec ce nom existe déjà'
                });
            }

            // ✅ create({ nom }, id_utilisateur)
            const id = await Modele.create({ nom: nom.trim() }, req.workspaceId);

            const newModele = await Modele.findById(id, req.workspaceId);

            res.status(201).json({
                success: true,
                message: 'Modèle créé avec succès',
                data: newModele
            });
        } catch (error) {
            console.error('❌ Erreur createModele:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du modèle',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour un modèle
     * ============================================================
     */
    static async updateModele(req, res) {
        try {
            const { id } = req.params;
            const { nom } = req.body;

            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom du modèle est requis'
                });
            }

            // ✅ Vérifier existence DANS le workspace
            const exists = await Modele.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Modèle non trouvé'
                });
            }

            // ✅ Vérifier unicité du nom (en excluant le modèle actuel)
            const nomExiste = await Modele.nomExists(nom.trim(), req.workspaceId, parseInt(id));
            if (nomExiste) {
                return res.status(409).json({
                    success: false,
                    message: 'Un autre modèle avec ce nom existe déjà'
                });
            }

            // ✅ update(id, { nom }, id_utilisateur)
            const updated = await Modele.update(id, { nom: nom.trim() }, req.workspaceId);

            if (updated) {
                const modele = await Modele.findById(id, req.workspaceId);
                res.status(200).json({
                    success: true,
                    message: 'Modèle mis à jour avec succès',
                    data: modele
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Aucune modification effectuée'
                });
            }
        } catch (error) {
            console.error('❌ Erreur updateModele:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du modèle',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Supprimer un modèle
     * ============================================================
     */
    static async deleteModele(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier existence DANS le workspace
            const exists = await Modele.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Modèle non trouvé'
                });
            }

            // ✅ delete(id, id_utilisateur)
            const deleted = await Modele.delete(id, req.workspaceId);

            if (deleted) {
                res.status(200).json({
                    success: true,
                    message: 'Modèle supprimé avec succès'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Erreur lors de la suppression du modèle'
                });
            }
        } catch (error) {
            console.error('❌ Erreur deleteModele:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du modèle',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Rechercher des modèles
     * ============================================================
     */
    static async searchModeles(req, res) {
        try {
            const { keyword } = req.query;

            // Si pas de mot-clé, retourner tous les modèles
            if (!keyword || keyword.trim() === '') {
                // ✅ req.workspaceId
                const modeles = await Modele.findAll(req.workspaceId);
                return res.status(200).json({
                    success: true,
                    count: modeles.length,
                    data: modeles
                });
            }

            // ✅ search(keyword, id_utilisateur)
            const modeles = await Modele.search(keyword.trim(), req.workspaceId);

            res.status(200).json({
                success: true,
                count: modeles.length,
                data: modeles
            });
        } catch (error) {
            console.error('❌ Erreur searchModeles:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche des modèles',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des modèles (workspace)
     * ============================================================
     */
    static async getModelesStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Modele.getStats(req.workspaceId);

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getModelesStats:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Exporter les modèles du workspace en CSV
     * ============================================================
     */
    static async exportModeles(req, res) {
        try {
            // ✅ req.workspaceId
            const modeles = await Modele.findAll(req.workspaceId);

            const headers = ['ID', 'Nom', 'Date de création'];
            const rows = modeles.map(m => [
                m.id_modele,
                m.nom,
                m.date_creation ? new Date(m.date_creation).toLocaleDateString('fr-FR') : ''
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=modeles_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportModeles:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation des modèles',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default ModeleController;