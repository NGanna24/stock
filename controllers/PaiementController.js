// controllers/PaiementController.js
import Paiement from '../models/Paiement.js';
import Facture from '../models/Facture.js';

class PaiementController {
    /**
     * ============================================================
     * Créer un nouveau paiement
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_facture,
                date_paiement,
                montant,
                mode_paiement,
                note,
                reference
            } = req.body;

            // Validations
            if (!id_facture) {
                return res.status(400).json({
                    success: false,
                    message: 'La facture est obligatoire'
                });
            }
            if (!date_paiement) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de paiement est obligatoire'
                });
            }
            if (!montant || parseFloat(montant) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le montant du paiement doit être positif'
                });
            }

            // ✅ Vérifier que la facture appartient au workspace
            const facture = await Facture.findById(id_facture, req.workspaceId);
            if (!facture) {
                return res.status(404).json({
                    success: false,
                    message: 'Facture non trouvée'
                });
            }

            // ✅ Créer avec id_utilisateur = req.workspaceId
            const paiement = await Paiement.create({
                id_facture,
                date_paiement,
                montant: parseFloat(montant),
                mode_paiement: mode_paiement || 'especes',
                note: note || null,
                reference: reference || null,
                id_utilisateur: req.workspaceId   // ← CORRIGÉ (avant : req.user.id)
            });

            return res.status(201).json({
                success: true,
                message: '✅ Paiement enregistré avec succès',
                data: paiement
            });

        } catch (error) {
            console.error('❌ Create paiement error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'enregistrement du paiement',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer tous les paiements du workspace
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                id_facture,
                id_commande,
                mode_paiement,
                date_debut,
                date_fin,
                montant_min,
                montant_max,
                page = 1,
                limit = 20
            } = req.query;

            const filters = {
                search,
                id_facture,
                id_commande,
                mode_paiement,
                date_debut,
                date_fin,
                montant_min,
                montant_max
            };

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            filters.limit = limitNum;
            filters.offset = offset;

            // ✅ req.workspaceId en 2e argument
            const paiements = await Paiement.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                data: paiements,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: paiements.length
                }
            });

        } catch (error) {
            console.error('❌ Get all paiements error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des paiements'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un paiement par ID
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de paiement invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const paiement = await Paiement.findById(parseInt(id), req.workspaceId);

            if (!paiement) {
                return res.status(404).json({
                    success: false,
                    message: 'Paiement non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                data: paiement
            });

        } catch (error) {
            console.error('❌ Get paiement by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du paiement'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les paiements d'une facture
     * ============================================================
     */
    static async getByFacture(req, res) {
        try {
            const { id_facture } = req.params;

            if (!id_facture || isNaN(id_facture)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de facture invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const paiements = await Paiement.findByFacture(parseInt(id_facture), req.workspaceId);

            return res.status(200).json({
                success: true,
                count: paiements.length,
                data: paiements
            });

        } catch (error) {
            console.error('❌ Get by facture error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des paiements'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les paiements d'une commande
     * ============================================================
     */
    static async getByCommande(req, res) {
        try {
            const { id_commande } = req.params;

            if (!id_commande || isNaN(id_commande)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de commande invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const paiements = await Paiement.findByCommande(parseInt(id_commande), req.workspaceId);

            return res.status(200).json({
                success: true,
                count: paiements.length,
                data: paiements
            });

        } catch (error) {
            console.error('❌ Get by commande error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des paiements'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les paiements par mode
     * ============================================================
     */
    static async getByMode(req, res) {
        try {
            const { mode } = req.params;

            const modesValides = ['especes', 'carte', 'virement', 'cheque', 'autre'];
            if (!modesValides.includes(mode)) {
                return res.status(400).json({
                    success: false,
                    message: 'Mode de paiement invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const paiements = await Paiement.findByMode(mode, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: paiements.length,
                data: paiements
            });

        } catch (error) {
            console.error('❌ Get by mode error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des paiements'
            });
        }
    }

    /**
     * ============================================================
     * Supprimer un paiement
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const deleted = await Paiement.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Paiement non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Paiement supprimé avec succès'
            });

        } catch (error) {
            console.error('❌ Delete paiement error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression du paiement'
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des paiements (workspace)
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Paiement.getStats(req.workspaceId);

            return res.status(200).json({
                success: true,
                data: stats
            });

        } catch (error) {
            console.error('❌ Get stats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }
    }

    /**
     * ============================================================
     * Exporter les paiements du workspace
     * ============================================================
     */
    static async export(req, res) {
        try {
            const { search, date_debut, date_fin } = req.query;

            const filters = { search, date_debut, date_fin };

            // ✅ req.workspaceId en 2e argument
            const data = await Paiement.export(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: data.length,
                data
            });

        } catch (error) {
            console.error('❌ Export error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'export des paiements'
            });
        }
    }
}

export default PaiementController;