// controllers/RetourClientController.js
import RetourClient from '../models/RetourClient.js';
import CommandeVente from '../models/CommandeVente.js';
import Produit from '../models/Produit.js';

class RetourClientController {

    /**
     * ============================================================
     * Rechercher une commande par numéro (pour création de retour)
     * GET /api/retours-clients/search-commande?numero=CV-202609-0001
     * ============================================================
     */
    static async searchCommandeByNumero(req, res) {
        try {
            const { numero } = req.query;

            // Validation
            if (!numero || numero.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le numéro de commande est obligatoire'
                });
            }

            // ✅ req.workspaceId en 2e argument
            const commande = await RetourClient.searchCommandeByNumero(numero, req.workspaceId);

            if (!commande) {
                return res.status(404).json({
                    success: false,
                    message: `Aucune commande trouvée avec le numéro "${numero}"`
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Commande trouvée',
                data: commande
            });

        } catch (error) {
            console.error('❌ Search commande error:', error);

            if (error.message && error.message.includes('ne peut pas faire l\'objet d\'un retour')) {
                return res.status(400).json({
                    success: false,
                    message: error.message
                });
            }

            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la recherche'
            });
        }
    }

    /**
     * ============================================================
     * Créer un nouveau retour client
     * POST /api/retours-clients
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_commande_vente,
                id_facture,
                date_retour,
                email,
                adresse,
                motif_retour,
                notes,
                lignes
            } = req.body;

            // Validations
            if (!id_commande_vente) {
                return res.status(400).json({
                    success: false,
                    message: 'Une commande est obligatoire pour créer un retour'
                });
            }
            if (!date_retour) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de retour est obligatoire'
                });
            }
            if (!motif_retour) {
                return res.status(400).json({
                    success: false,
                    message: 'Le motif de retour est obligatoire'
                });
            }
            if (!lignes || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit est requis'
                });
            }

            // ✅ Créer avec id_utilisateur = req.workspaceId
            const retour = await RetourClient.create({
                id_commande_vente,
                id_facture: id_facture || null,
                date_retour,
                email: email || null,
                adresse: adresse || null,
                motif_retour,
                notes: notes || null,
                id_utilisateur: req.workspaceId,   // ← CORRIGÉ (avant : req.user.id)
                lignes
            });

            return res.status(201).json({
                success: true,
                message: '✅ Retour client créé avec succès',
                data: retour
            });

        } catch (error) {
            console.error('❌ Create retour client error:', error);

            const erreursMetier = [
                'obligatoire',
                'non trouvée',
                'livrées ou expédiées',
                'Quantité trop élevée',
                'invalide',
                'ne correspond pas',
                'positive',
                'Au moins un produit'
            ];

            const estErreurMetier = erreursMetier.some(msg =>
                error.message && error.message.includes(msg)
            );

            return res.status(estErreurMetier ? 400 : 500).json({
                success: false,
                message: error.message || 'Erreur lors de la création du retour client'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer tous les retours clients du workspace
     * GET /api/retours-clients
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                statut,
                motif_retour,
                date_debut,
                date_fin,
                id_commande_vente,
                page = 1,
                limit = 20
            } = req.query;

            const filters = {
                search,
                statut,
                motif_retour,
                date_debut,
                date_fin,
                id_commande_vente,
                limit: parseInt(limit),
                offset: (parseInt(page) - 1) * parseInt(limit)
            };

            // ✅ req.workspaceId en 2e argument
            const retours = await RetourClient.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: retours.length,
                page: parseInt(page),
                limit: parseInt(limit),
                data: retours
            });

        } catch (error) {
            console.error('❌ Get all retours clients error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des retours clients'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un retour client par ID
     * GET /api/retours-clients/:id
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const retour = await RetourClient.findById(id, req.workspaceId);

            if (!retour) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour client non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                data: retour
            });

        } catch (error) {
            console.error('❌ Get retour client by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du retour client'
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'un retour client
     * PATCH /api/retours-clients/:id/statut
     * ============================================================
     */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'recu', 'controle', 'accepte', 'refuse', 'rembourse', 'echange', 'annule'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            // ✅ Vérifier existence DANS le workspace
            const retour = await RetourClient.findById(id, req.workspaceId);
            if (!retour) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour client non trouvé'
                });
            }

            // ✅ req.workspaceId en 3e argument
            const updated = await RetourClient.updateStatut(id, statut, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du statut'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await RetourClient.findById(id, req.workspaceId)
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
     * Supprimer un retour client
     * DELETE /api/retours-clients/:id
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const deleted = await RetourClient.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour client non trouvé ou ne peut pas être supprimé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Retour client supprimé avec succès'
            });

        } catch (error) {
            console.error('❌ Delete retour client error:', error);

            if (error.message && error.message.includes('Impossible de supprimer')) {
                return res.status(400).json({
                    success: false,
                    message: error.message
                });
            }

            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression du retour client'
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des retours clients (workspace)
     * GET /api/retours-clients/stats
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await RetourClient.getStats(req.workspaceId);

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
     * Exporter les retours clients du workspace
     * GET /api/retours-clients/export
     * ============================================================
     */
    static async export(req, res) {
        try {
            // ✅ req.workspaceId en 2e argument
            const retours = await RetourClient.findAll(req.query, req.workspaceId);

            const exportData = retours.map(r => ({
                id: r.id_retour_client,
                numero: r.numero_retour,
                date: r.date_retour,
                client: r.nomclient || '-',
                telephone: r.telephone || '-',
                commande: r.numero_commande || '-',
                facture: r.numero_facture || '-',
                motif: r.motif_retour,
                montant: parseFloat(r.montant_total) || 0,
                statut: r.statut,
                notes: r.notes || ''
            }));

            return res.status(200).json({
                success: true,
                count: exportData.length,
                data: exportData
            });

        } catch (error) {
            console.error('❌ Export error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'export des retours clients'
            });
        }
    }
}

export default RetourClientController;