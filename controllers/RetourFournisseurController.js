// controllers/RetourFournisseurController.js
import RetourFournisseur from '../models/RetourFournisseur.js';
import Fournisseur from '../models/Fournisseur.js';
import Produit from '../models/Produit.js';

class RetourFournisseurController {
    /**
     * ============================================================
     * POST /api/retours-fournisseurs
     * Créer un nouveau retour fournisseur
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_fournisseur,
                id_commande_achat,
                id_reception,
                date_retour,
                motif_retour,
                notes,
                lignes
            } = req.body;

            // ========== 1. VALIDATIONS DE BASE ==========
            if (!id_fournisseur) {
                return res.status(400).json({
                    success: false,
                    message: 'Le fournisseur est obligatoire'
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
            if (!Array.isArray(lignes) || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit est requis'
                });
            }

            // ========== 2. VÉRIFIER LE FOURNISSEUR ==========
            const fournisseur = await Fournisseur.findById(id_fournisseur, req.workspaceId);
            if (!fournisseur) {
                return res.status(404).json({
                    success: false,
                    message: 'Fournisseur non trouvé'
                });
            }
            if (!fournisseur.actif) {
                return res.status(400).json({
                    success: false,
                    message: 'Ce fournisseur est inactif'
                });
            }

            // ========== 3. VALIDATIONS BASIQUES DES PRODUITS ==========
            //    (la règle métier "reçu du fournisseur" est appliquée
            //     dans le modèle lors de la transaction)
            for (const ligne of lignes) {
                const { id_produit, quantite } = ligne;

                const produit = await Produit.findById(id_produit, req.workspaceId);
                if (!produit) {
                    return res.status(404).json({
                        success: false,
                        message: `Produit ID ${id_produit} non trouvé`
                    });
                }

                if (!quantite || parseFloat(quantite) <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: `La quantité pour "${produit.nom}" doit être positive`
                    });
                }
            }

            // ========== 4. CRÉATION (dans le modèle avec toutes les règles) ==========
            const retour = await RetourFournisseur.create({
                id_fournisseur,
                id_commande_achat: id_commande_achat || null,
                id_reception: id_reception || null,
                date_retour,
                motif_retour,
                notes: notes || null,
                id_utilisateur: req.workspaceId,
                lignes
            });

            return res.status(201).json({
                success: true,
                message: '✅ Retour fournisseur créé avec succès',
                data: retour
            });

        } catch (error) {
            console.error('❌ Create retour error:', error);

            const isBusinessError = error.message && (
                error.message.includes('non trouvé') ||
                error.message.includes('obligatoire') ||
                error.message.includes('positive') ||
                error.message.includes('Aucune quantité') ||
                error.message.includes('Quantité trop élevée') ||
                error.message.includes('Stock insuffisant') ||
                error.message.includes('Reçu net')
            );

            return res.status(isBusinessError ? 400 : 500).json({
                success: false,
                message: error.message || 'Erreur lors de la création du retour'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-fournisseurs
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                id_fournisseur,
                statut,
                motif_retour,
                date_debut,
                date_fin,
                page = 1,
                limit = 20
            } = req.query;

            const filters = {
                search,
                id_fournisseur,
                statut,
                motif_retour,
                date_debut,
                date_fin
            };

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            filters.limit = limitNum;
            filters.offset = offset;

            const retours = await RetourFournisseur.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: retours.length,
                data: retours,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: retours.length
                }
            });

        } catch (error) {
            console.error('❌ Get all retours error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des retours'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-fournisseurs/:id
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de retour invalide'
                });
            }

            const retour = await RetourFournisseur.findById(parseInt(id), req.workspaceId);

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
                message: 'Erreur lors de la récupération du retour'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-fournisseurs/statut/:statut
     * ============================================================
     */
    static async getByStatut(req, res) {
        try {
            const { statut } = req.params;

            const statutsValides = ['en_attente', 'envoye', 'recu_par_fournisseur', 'traite', 'annule'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const retours = await RetourFournisseur.findByStatut(statut, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: retours.length,
                data: retours
            });

        } catch (error) {
            console.error('❌ Get by statut error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des retours'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-fournisseurs/fournisseur/:id_fournisseur
     * ============================================================
     */
    static async getByFournisseur(req, res) {
        try {
            const { id_fournisseur } = req.params;

            if (!id_fournisseur || isNaN(id_fournisseur)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID fournisseur invalide'
                });
            }

            const retours = await RetourFournisseur.findByFournisseur(
                parseInt(id_fournisseur),
                req.workspaceId
            );

            return res.status(200).json({
                success: true,
                count: retours.length,
                data: retours
            });

        } catch (error) {
            console.error('❌ Get by fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des retours'
            });
        }
    }

    /**
     * ============================================================
     * PATCH /api/retours-fournisseurs/:id/statut
     * ============================================================
     */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'envoye', 'recu_par_fournisseur', 'traite', 'annule'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const retour = await RetourFournisseur.findById(id, req.workspaceId);
            if (!retour) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour non trouvé'
                });
            }

            const updated = await RetourFournisseur.updateStatut(id, statut, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du statut'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await RetourFournisseur.findById(id, req.workspaceId)
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
     * PATCH /api/retours-fournisseurs/:id/annuler
     * ============================================================
     */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            const annule = await RetourFournisseur.annuler(id, req.workspaceId);

            if (!annule) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible d\'annuler ce retour'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Retour annulé avec succès',
                data: await RetourFournisseur.findById(id, req.workspaceId)
            });

        } catch (error) {
            console.error('❌ Annuler retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'annulation du retour'
            });
        }
    }

    /**
     * ============================================================
     * DELETE /api/retours-fournisseurs/:id
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            const deleted = await RetourFournisseur.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour non trouvé ou ne peut pas être supprimé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Retour supprimé avec succès'
            });

        } catch (error) {
            console.error('❌ Delete retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression du retour'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-fournisseurs/stats
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await RetourFournisseur.getStats(req.workspaceId);

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
     * GET /api/retours-fournisseurs/export
     * ============================================================
     */
    static async export(req, res) {
        try {
            const retours = await RetourFournisseur.findAll(req.query, req.workspaceId);

            const exportData = retours.map(r => ({
                id: r.id_retour,
                numero: r.numero_retour,
                date: r.date_retour,
                fournisseur: r.fournisseur_nom || '-',
                commande: r.numero_commande || '-',
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
                message: 'Erreur lors de l\'export des retours'
            });
        }
    }
}

export default RetourFournisseurController;