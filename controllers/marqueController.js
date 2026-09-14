// controllers/MarqueController.js
import Marque from '../models/Marque.js';

class MarqueController {
    /**
     * ============================================================
     * Récupérer toutes les marques du workspace
     * ============================================================
     */
    static async getAllMarques(req, res) {
        try {
            // ✅ req.workspaceId
            const marques = await Marque.findAll(req.workspaceId);
            res.status(200).json({
                success: true,
                count: marques.length,
                data: marques
            });
        } catch (error) {
            console.error('❌ Erreur getAllMarques:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des marques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les marques actives uniquement
     * ============================================================
     */
    static async getActiveMarques(req, res) {
        try {
            // ✅ req.workspaceId
            const marques = await Marque.findActive(req.workspaceId);
            res.status(200).json({
                success: true,
                count: marques.length,
                data: marques
            });
        } catch (error) {
            console.error('❌ Erreur getActiveMarques:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des marques actives',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une marque par ID
     * ============================================================
     */
    static async getMarqueById(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const marque = await Marque.findById(id, req.workspaceId);

            if (!marque) {
                return res.status(404).json({
                    success: false,
                    message: 'Marque non trouvée'
                });
            }

            res.status(200).json({
                success: true,
                data: marque
            });
        } catch (error) {
            console.error('❌ Erreur getMarqueById:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la marque',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une marque par son nom
     * ============================================================
     */
    static async getMarqueByNom(req, res) {
        try {
            const { nom } = req.params;

            // ✅ req.workspaceId en 2e argument
            const marque = await Marque.findByNom(nom, req.workspaceId);

            if (!marque) {
                return res.status(404).json({
                    success: false,
                    message: 'Marque non trouvée'
                });
            }

            res.status(200).json({
                success: true,
                data: marque
            });
        } catch (error) {
            console.error('❌ Erreur getMarqueByNom:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la marque',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Créer une nouvelle marque
     * ============================================================
     */
    static async createMarque(req, res) {
        try {
            const { nom, description } = req.body;

            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom de la marque est requis'
                });
            }

            // ✅ Vérifier doublon DANS le workspace
            const nomExiste = await Marque.nomExists(nom.trim(), req.workspaceId);
            if (nomExiste) {
                return res.status(409).json({
                    success: false,
                    message: 'Une marque avec ce nom existe déjà'
                });
            }

            // ✅ create(data, id_utilisateur)
            const id = await Marque.create(
                {
                    nom: nom.trim(),
                    description: description ? description.trim() : null
                },
                req.workspaceId
            );

            const newMarque = await Marque.findById(id, req.workspaceId);

            res.status(201).json({
                success: true,
                message: 'Marque créée avec succès',
                data: newMarque
            });
        } catch (error) {
            console.error('❌ Erreur createMarque:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la marque',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour une marque
     * ============================================================
     */
    static async updateMarque(req, res) {
        try {
            const { id } = req.params;
            const { nom, description } = req.body;

            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom de la marque est requis'
                });
            }

            // ✅ Vérifier existence DANS le workspace
            const exists = await Marque.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Marque non trouvée'
                });
            }

            // ✅ Vérifier unicité du nom (en excluant la marque actuelle)
            const nomExiste = await Marque.nomExists(nom.trim(), req.workspaceId, parseInt(id));
            if (nomExiste) {
                return res.status(409).json({
                    success: false,
                    message: 'Une autre marque avec ce nom existe déjà'
                });
            }

            // ✅ update(id, data, id_utilisateur)
            const updated = await Marque.update(
                id,
                {
                    nom: nom.trim(),
                    description: description ? description.trim() : null
                },
                req.workspaceId
            );

            if (updated) {
                const marque = await Marque.findById(id, req.workspaceId);
                res.status(200).json({
                    success: true,
                    message: 'Marque mise à jour avec succès',
                    data: marque
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Aucune modification effectuée'
                });
            }
        } catch (error) {
            console.error('❌ Erreur updateMarque:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de la marque',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une marque
     * ============================================================
     */
    static async updateMarqueStatus(req, res) {
        try {
            const { id } = req.params;
            const { actif } = req.body;

            // Validation
            if (actif === undefined || (actif !== 0 && actif !== 1 && actif !== true && actif !== false)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le statut doit être 0 (inactif) ou 1 (actif)'
                });
            }

            // ✅ Vérifier existence DANS le workspace
            const existingMarque = await Marque.findById(id, req.workspaceId);
            if (!existingMarque) {
                return res.status(404).json({
                    success: false,
                    message: 'Marque non trouvée'
                });
            }

            // ✅ updateStatus(id, actif, id_utilisateur)
            const updated = await Marque.updateStatus(id, actif, req.workspaceId);

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    message: 'Marque non trouvée'
                });
            }

            const marque = await Marque.findById(id, req.workspaceId);

            return res.status(200).json({
                success: true,
                message: `Marque ${actif === 1 || actif === true ? 'activée' : 'désactivée'} avec succès`,
                data: marque
            });
        } catch (error) {
            console.error('❌ Erreur updateMarqueStatus:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du statut',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Supprimer une marque
     * ============================================================
     */
    static async deleteMarque(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier existence DANS le workspace
            const exists = await Marque.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Marque non trouvée'
                });
            }

            // ✅ delete(id, id_utilisateur)
            const deleted = await Marque.delete(id, req.workspaceId);

            if (deleted) {
                res.status(200).json({
                    success: true,
                    message: 'Marque supprimée avec succès'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Erreur lors de la suppression de la marque'
                });
            }
        } catch (error) {
            console.error('❌ Erreur deleteMarque:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de la marque',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Rechercher des marques
     * ============================================================
     */
    static async searchMarques(req, res) {
        try {
            const { keyword } = req.query;

            // Si pas de mot-clé, retourner toutes les marques
            if (!keyword || keyword.trim() === '') {
                // ✅ req.workspaceId
                const marques = await Marque.findAll(req.workspaceId);
                return res.status(200).json({
                    success: true,
                    count: marques.length,
                    data: marques
                });
            }

            // ✅ search(keyword, id_utilisateur)
            const marques = await Marque.search(keyword.trim(), req.workspaceId);

            res.status(200).json({
                success: true,
                count: marques.length,
                data: marques
            });
        } catch (error) {
            console.error('❌ Erreur searchMarques:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche des marques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des marques (workspace)
     * ============================================================
     */
    static async getMarquesStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Marque.getStats(req.workspaceId);
            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getMarquesStats:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Exporter les marques du workspace en CSV
     * ============================================================
     */
    static async exportMarques(req, res) {
        try {
            // ✅ req.workspaceId
            const marques = await Marque.findAll(req.workspaceId);

            const headers = ['ID', 'Nom', 'Description', 'Statut', 'Date de création'];
            const rows = marques.map(m => [
                m.id_marque,
                m.nom,
                m.description || '',
                m.actif === 1 ? 'Actif' : 'Inactif',
                m.date_creation ? new Date(m.date_creation).toLocaleDateString('fr-FR') : ''
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=marques_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportMarques:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation des marques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default MarqueController;