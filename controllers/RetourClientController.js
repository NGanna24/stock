// controllers/RetourClientController.js
import RetourClient from '../models/RetourClient.js';

class RetourClientController {
    /**
     * ============================================================
     * GET /api/retours-clients/search-commande?q=CV-2024
     * Rechercher une commande pour faire un retour
     * ============================================================
     */
    static async searchCommande(req, res) {
        try {
            const { q, jours } = req.query;

            if (!q || q.trim().length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum 2 caractères pour la recherche'
                });
            }

            const commandes = await RetourClient.searchCommandes(
                q.trim(),
                req.workspaceId,
                jours
            );

            return res.status(200).json({
                success: true,
                count: commandes.length,
                data: commandes
            });

        } catch (error) {
            console.error('❌ Search commande retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la recherche'
            });
        }
    }

    /**
     * ============================================================
     * POST /api/retours-clients
     * Créer un nouveau retour client
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_commande_vente,
                motif_retour,
                type_resolution,
                notes,
                lignes
            } = req.body;

            // Validations
            if (!id_commande_vente) {
                return res.status(400).json({
                    success: false,
                    message: 'La commande est obligatoire'
                });
            }
            if (!motif_retour) {
                return res.status(400).json({
                    success: false,
                    message: 'Le motif de retour est obligatoire'
                });
            }
            if (!lignes || !Array.isArray(lignes) || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit doit être retourné'
                });
            }

            const retour = await RetourClient.create({
                id_commande_vente: parseInt(id_commande_vente),
                motif_retour,
                type_resolution: type_resolution || 'remboursement_especes',
                notes: notes || null,
                lignes,
                id_utilisateur: req.workspaceId
            });

            return res.status(201).json({
                success: true,
                message: 'Retour enregistré avec succès',
                data: retour
            });

        } catch (error) {
            console.error('❌ Create retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création du retour'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-clients
     * Liste des retours
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                statut,
                type_resolution,
                date_debut,
                date_fin,
                page = 1,
                limit = 20
            } = req.query;

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            const retours = await RetourClient.findAll({
                search,
                statut,
                type_resolution,
                date_debut,
                date_fin,
                limit: limitNum,
                offset
            }, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: retours.length,
                data: retours,
                pagination: {
                    page: pageNum,
                    limit: limitNum
                }
            });

        } catch (error) {
            console.error('❌ Get all retours error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-clients/:id
     * Détail d'un retour
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID invalide'
                });
            }

            const retour = await RetourClient.findById(
                parseInt(id),
                req.workspaceId
            );

            if (!retour) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                data: retour
            });

        } catch (error) {
            console.error('❌ Get retour by ID error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération'
            });
        }
    }

    /**
     * ============================================================
     * PATCH /api/retours-clients/:id/annuler
     * Annuler un retour
     * ============================================================
     */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            const annule = await RetourClient.annuler(
                parseInt(id),
                req.workspaceId
            );

            if (!annule) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible d\'annuler ce retour'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Retour annulé avec succès'
            });

        } catch (error) {
            console.error('❌ Annuler retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'annulation'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-clients/stats
     * Statistiques des retours
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await RetourClient.getStats(req.workspaceId);

            return res.status(200).json({
                success: true,
                data: stats
            });

        } catch (error) {
            console.error('❌ Get stats retours error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération'
            });
        }
    }
}

export default RetourClientController;