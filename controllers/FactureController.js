// controllers/FactureController.js
import Facture from '../models/Facture.js';
import CommandeVente from '../models/CommandeVente.js';

class FactureController {
    /**
     * ============================================================
     * Créer une facture
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_commande,
                date_facture,
                date_echeance,
                montant_total,
                mode_paiement,
                notes
            } = req.body;

            // Validations
            if (!date_facture) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de facture est obligatoire'
                });
            }
            if (!montant_total || parseFloat(montant_total) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le montant total doit être positif'
                });
            }

            // ✅ Vérifier la commande DANS le workspace
            if (id_commande) {
                const commande = await CommandeVente.findById(id_commande, req.workspaceId);
                if (!commande) {
                    return res.status(404).json({
                        success: false,
                        message: 'Commande non trouvée'
                    });
                }
            }

            const date_echeance_facture = date_echeance
                || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            // ✅ Créer avec id_utilisateur = req.workspaceId
            const facture = await Facture.create({
                id_commande: id_commande || null,
                date_facture,
                date_echeance: date_echeance_facture,
                montant_total: parseFloat(montant_total),
                mode_paiement: mode_paiement || 'especes',
                notes: notes || null,
                id_utilisateur: req.workspaceId   // ← CORRIGÉ (avant : req.user.id)
            });

            return res.status(201).json({
                success: true,
                message: '✅ Facture créée avec succès',
                data: facture
            });

        } catch (error) {
            console.error('❌ Create facture error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création de la facture',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer toutes les factures du workspace
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                statut,
                id_commande,
                date_debut,
                date_fin,
                montant_min,
                montant_max,
                page = 1,
                limit = 20
            } = req.query;

            const filters = {
                search,
                statut,
                id_commande,
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
            const factures = await Facture.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                data: factures,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: factures.length
                }
            });

        } catch (error) {
            console.error('❌ Get all factures error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des factures'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une facture par ID
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de facture invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const facture = await Facture.findById(parseInt(id), req.workspaceId);

            if (!facture) {
                return res.status(404).json({
                    success: false,
                    message: 'Facture non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                data: facture
            });

        } catch (error) {
            console.error('❌ Get facture by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la facture'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les factures par statut
     * ============================================================
     */
    static async getByStatut(req, res) {
        try {
            const { statut } = req.params;

            const statutsValides = ['en_attente', 'payee', 'partiellement_payee', 'en_retard', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const factures = await Facture.findByStatut(statut, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: factures.length,
                data: factures
            });

        } catch (error) {
            console.error('❌ Get by statut error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des factures'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les factures d'une commande
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
            const factures = await Facture.findByCommande(parseInt(id_commande), req.workspaceId);

            return res.status(200).json({
                success: true,
                count: factures.length,
                data: factures
            });

        } catch (error) {
            console.error('❌ Get by commande error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des factures'
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une facture
     * ============================================================
     */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'payee', 'partiellement_payee', 'en_retard', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            // ✅ Vérifier existence DANS le workspace
            const facture = await Facture.findById(id, req.workspaceId);
            if (!facture) {
                return res.status(404).json({
                    success: false,
                    message: 'Facture non trouvée'
                });
            }

            // ✅ req.workspaceId en 3e argument
            const updated = await Facture.updateStatut(id, statut, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du statut'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await Facture.findById(id, req.workspaceId)
            });

        } catch (error) {
            console.error('❌ Update statut error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la mise à jour du statut'
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour la date d'échéance
     * ============================================================
     */
    static async updateEcheance(req, res) {
        try {
            const { id } = req.params;
            const { date_echeance } = req.body;

            if (!date_echeance) {
                return res.status(400).json({
                    success: false,
                    message: 'La date d\'échéance est obligatoire'
                });
            }

            // ✅ Vérifier existence DANS le workspace
            const facture = await Facture.findById(id, req.workspaceId);
            if (!facture) {
                return res.status(404).json({
                    success: false,
                    message: 'Facture non trouvée'
                });
            }

            // ✅ req.workspaceId en 3e argument
            const updated = await Facture.updateEcheance(id, date_echeance, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour de la date d\'échéance'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Date d\'échéance mise à jour',
                data: await Facture.findById(id, req.workspaceId)
            });

        } catch (error) {
            console.error('❌ Update echeance error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la mise à jour de la date d\'échéance'
            });
        }
    }

    /**
     * ============================================================
     * Supprimer une facture
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const deleted = await Facture.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Facture non trouvée ou ne peut pas être supprimée'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Facture supprimée avec succès'
            });

        } catch (error) {
            console.error('❌ Delete facture error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression de la facture'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les statistiques des factures
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Facture.getStats(req.workspaceId);

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
     * Exporter les factures du workspace
     * ============================================================
     */
    static async export(req, res) {
        try {
            const { search, statut, date_debut, date_fin } = req.query;

            const filters = { search, statut, date_debut, date_fin };

            // ✅ req.workspaceId en 2e argument
            const data = await Facture.export(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: data.length,
                data
            });

        } catch (error) {
            console.error('❌ Export error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'export des factures'
            });
        }
    }
}

export default FactureController;