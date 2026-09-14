// controllers/UniteController.js
import Unite from '../models/Unite.js';

class UniteController {
    /**
     * ============================================================
     * Récupérer toutes les unités de l'utilisateur connecté
     * ============================================================
     */ 
    static async getAllUnites(req, res) {
        try {
            // ✅ Filtre par workspace
            const unites = await Unite.findAll(req.workspaceId);

            res.status(200).json({
                success: true,
                count: unites.length,
                data: unites
            });
        } catch (error) {
            console.error('❌ Erreur getAllUnites:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des unités',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une unité par ID (vérifiée dans le workspace)
     * ============================================================
     */
    static async getUniteById(req, res) {
        try {
            const { id } = req.params;
            // ✅ Vérifie que l'unité appartient bien à l'utilisateur
            const unite = await Unite.findById(id, req.workspaceId);

            if (!unite) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité non trouvée'
                });
            }

            res.status(200).json({
                success: true,
                data: unite
            });
        } catch (error) {
            console.error('❌ Erreur getUniteById:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de l\'unité',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une unité par son nom (dans le workspace)
     * ============================================================
     */
    static async getUniteByNom(req, res) {
        try {
            const { nom } = req.params;
            // ✅ Filtre par workspace
            const unite = await Unite.findByNom(nom, req.workspaceId);

            if (!unite) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité non trouvée'
                });
            }

            res.status(200).json({
                success: true,
                data: unite
            });
        } catch (error) {
            console.error('❌ Erreur getUniteByNom:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de l\'unité',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Créer une nouvelle unité dans le workspace
     * ============================================================
     */
    static async createUnite(req, res) {
        try {
            const { nom, symbole, description } = req.body;

            console.log('📥 createUnite - workspaceId:', req.workspaceId);

            // Validations
            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom de l\'unité est requis'
                });
            }

            if (!symbole || symbole.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le symbole de l\'unité est requis'
                });
            }

            // ✅ Vérifier si le nom existe DANS ce workspace
            const nomExists = await Unite.nomExists(nom.trim(), req.workspaceId);
            if (nomExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Une unité avec ce nom existe déjà'
                });
            }

            // ✅ Vérifier si le symbole existe DANS ce workspace
            const symboleExists = await Unite.symboleExists(symbole.trim(), req.workspaceId);
            if (symboleExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Une unité avec ce symbole existe déjà'
                });
            }

            // ✅ Créer avec l'id_utilisateur du workspace
            const id = await Unite.create(
                {
                    nom: nom.trim(),
                    symbole: symbole.trim(),
                    description: description ? description.trim() : null
                },
                req.workspaceId
            );

            const newUnite = await Unite.findById(id, req.workspaceId);

            res.status(201).json({
                success: true,
                message: 'Unité créée avec succès',
                data: newUnite
            });
        } catch (error) {
            console.error('❌ Erreur createUnite:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de l\'unité',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour une unité du workspace
     * ============================================================
     */
    static async updateUnite(req, res) {
        try {
            const { id } = req.params;
            const { nom, symbole, description } = req.body;

            // Validations
            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom de l\'unité est requis'
                });
            }

            if (!symbole || symbole.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le symbole de l\'unité est requis'
                });
            }

            // ✅ Vérifier que l'unité appartient au workspace
            const exists = await Unite.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité non trouvée'
                });
            }

            // ✅ Vérifier l'unicité du nom dans le workspace (excluant l'unité actuelle)
            const nomExists = await Unite.nomExists(nom.trim(), req.workspaceId, parseInt(id));
            if (nomExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Une unité avec ce nom existe déjà'
                });
            }

            // ✅ Vérifier l'unicité du symbole dans le workspace
            const symboleExists = await Unite.symboleExists(symbole.trim(), req.workspaceId, parseInt(id));
            if (symboleExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Une unité avec ce symbole existe déjà'
                });
            }

            // ✅ Mise à jour filtrée par workspace
            const updated = await Unite.update(
                id,
                {
                    nom: nom.trim(),
                    symbole: symbole.trim(),
                    description: description ? description.trim() : null
                },
                req.workspaceId
            );

            if (updated) {
                const unite = await Unite.findById(id, req.workspaceId);
                res.status(200).json({
                    success: true,
                    message: 'Unité mise à jour avec succès',
                    data: unite
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Aucune modification effectuée'
                });
            }
        } catch (error) {
            console.error('❌ Erreur updateUnite:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de l\'unité',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Supprimer une unité du workspace
     * ============================================================
     */
    static async deleteUnite(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier que l'unité appartient au workspace
            const exists = await Unite.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Unité non trouvée'
                });
            }

            // ✅ Suppression filtrée par workspace
            const deleted = await Unite.delete(id, req.workspaceId);
            if (deleted) {
                res.status(200).json({
                    success: true,
                    message: 'Unité supprimée avec succès'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Erreur lors de la suppression de l\'unité'
                });
            }
        } catch (error) {
            console.error('❌ Erreur deleteUnite:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de l\'unité',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Rechercher des unités dans le workspace
     * ============================================================
     */
    static async searchUnites(req, res) {
        try {
            const { keyword } = req.query;

            if (!keyword || keyword.trim() === '') {
                const unites = await Unite.findAll(req.workspaceId);
                return res.status(200).json({
                    success: true,
                    data: unites
                });
            }

            // ✅ Recherche filtrée par workspace
            const unites = await Unite.search(keyword.trim(), req.workspaceId);

            res.status(200).json({
                success: true,
                count: unites.length,
                data: unites
            });
        } catch (error) {
            console.error('❌ Erreur searchUnites:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche des unités',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des unités du workspace
     * ============================================================
     */
    static async getUnitesStats(req, res) {
        try {
            // ✅ Stats filtrées par workspace
            const stats = await Unite.getStats(req.workspaceId);

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getUnitesStats:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Exporter les unités du workspace en CSV
     * ============================================================
     */
    static async exportUnites(req, res) {
        try {
            // ✅ Export filtré par workspace
            const unites = await Unite.findAll(req.workspaceId);

            const headers = ['ID', 'Nom', 'Symbole', 'Description', 'Date de création'];
            const rows = unites.map(u => [
                u.id_unite,
                u.nom,
                u.symbole,
                u.description || '',
                u.date_creation ? new Date(u.date_creation).toLocaleDateString('fr-FR') : ''
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=unites_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportUnites:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation des unités',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * SEED MANUEL — Réinsérer les unités par défaut
     * ============================================================
     * Utile si l'utilisateur a perdu ses unités ou pour les anciens comptes.
     */
    static async seedUnites(req, res) {
        try {
            // ✅ Vérifier si l'utilisateur a déjà des unités
            const dejaDesUnites = await Unite.utilisateurAUneUnite(req.workspaceId);

            if (dejaDesUnites) {
                return res.status(400).json({
                    success: false,
                    message: 'Vous avez déjà des unités. Supprimez-les d\'abord si vous voulez re-seed.'
                });
            }

            // ✅ Insérer les unités par défaut
            const count = await Unite.seedDefaultUnites(req.workspaceId);

            res.status(200).json({
                success: true,
                message: `${count} unités par défaut insérées`,
                count
            });
        } catch (error) {
            console.error('❌ Erreur seedUnites:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors du seed des unités',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    
}

export default UniteController;