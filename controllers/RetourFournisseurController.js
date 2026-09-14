// controllers/RetourFournisseurController.js
import RetourFournisseur from '../models/RetourFournisseur.js';
import Fournisseur from '../models/Fournisseur.js';
import Produit from '../models/Produit.js';
import CommandeAchat from '../models/CommandeAchat.js';
import Reception from '../models/Reception.js';

class RetourFournisseurController {
    /**
     * ============================================================
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

            // 1. Validations
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
            if (!lignes || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit est requis'
                });
            }

            // 2. ✅ Vérifier le fournisseur DANS le workspace
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

            // 3. ✅ Vérifier la commande DANS le workspace
            if (id_commande_achat) {
                const commande = await CommandeAchat.findById(id_commande_achat, req.workspaceId);
                if (!commande) {
                    return res.status(404).json({
                        success: false,
                        message: 'Commande d\'achat non trouvée'
                    });
                }
            }

            // 4. ✅ Vérifier la réception DANS le workspace
            if (id_reception) {
                const reception = await Reception.findById(id_reception, req.workspaceId);
                if (!reception) {
                    return res.status(404).json({
                        success: false,
                        message: 'Réception non trouvée'
                    });
                }
            }

            // 5. ✅ Vérifier les produits DANS le workspace
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

                const stockDisponible = parseFloat(produit.quantite_stock) || 0;
                if (parseFloat(quantite) > stockDisponible) {
                    return res.status(400).json({
                        success: false,
                        message: `Stock insuffisant pour "${produit.nom}". ` +
                                `Disponible: ${stockDisponible}, Demandé: ${quantite}`
                    });
                }
            }

            // 6. ✅ Créer avec id_utilisateur = req.workspaceId
            const retour = await RetourFournisseur.create({
                id_fournisseur,
                id_commande_achat: id_commande_achat || null,
                id_reception: id_reception || null,
                date_retour,
                motif_retour,
                notes: notes || null,
                id_utilisateur: req.workspaceId,   // ← CORRIGÉ (avant : req.user.id)
                lignes
            });

            return res.status(201).json({
                success: true,
                message: '✅ Retour fournisseur créé avec succès',
                data: retour
            });

        } catch (error) {
            console.error('❌ Create retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création du retour',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer tous les retours du workspace
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

            // ✅ req.workspaceId en 2e argument
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
     * Récupérer un retour par ID
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

            // ✅ req.workspaceId en 2e argument
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
     * Récupérer les retours par statut
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

            // ✅ req.workspaceId en 2e argument
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
     * Récupérer les retours d'un fournisseur
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

            // ✅ req.workspaceId en 2e argument
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
     * Mettre à jour le statut d'un retour
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

            // ✅ Vérifier existence DANS le workspace
            const retour = await RetourFournisseur.findById(id, req.workspaceId);
            if (!retour) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour non trouvé'
                });
            }

            // ✅ req.workspaceId en 3e argument
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
     * Annuler un retour (réintègre le stock)
     * ============================================================
     */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
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
     * Supprimer un retour (seulement si en attente)
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
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
     * Statistiques des retours fournisseurs (workspace)
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
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
     * Exporter les retours fournisseurs du workspace
     * ============================================================
     */
    static async export(req, res) {
        try {
            // ✅ req.workspaceId en 2e argument
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