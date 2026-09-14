// controllers/CommandeAchatController.js
import CommandeAchat from '../models/CommandeAchat.js';
import Fournisseur from '../models/Fournisseur.js';
import Produit from '../models/Produit.js';
import UniteVente from '../models/UniteVente.js';

class CommandeAchatController {
    /**
     * ============================================================
     * ✅ Créer une nouvelle commande d'achat (NIVEAU 3)
     * ============================================================
     * Règles métier :
     *  - Le prix d'achat est OPTIONNEL (NULL si non fourni)
     *  - Il sera renseigné plus tard, à la RÉCEPTION
     *  - L'unité de vente peut être NULL (= unité de base, ex: bidon)
     */
    static async create(req, res) {
        try {
            const {
                id_fournisseur,
                date_commande,
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
            if (!date_commande) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de commande est obligatoire'
                });
            }
            if (!lignes || lignes.length === 0) {
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

            // ========== 3. VÉRIFIER LES PRODUITS + UNITÉS ==========
            for (const ligne of lignes) {
                const produit = await Produit.findById(ligne.id_produit, req.workspaceId);
                if (!produit) {
                    return res.status(404).json({
                        success: false,
                        message: `Produit ID ${ligne.id_produit} non trouvé`
                    });
                }

                // ✅ Vérifier l'unité de vente SI fournie (peut être null = unité de base)
                if (ligne.id_unite_vente) {
                    const unite = await UniteVente.findById(ligne.id_unite_vente, req.workspaceId);
                    if (!unite) {
                        return res.status(404).json({
                            success: false,
                            message: `Unité de vente ID ${ligne.id_unite_vente} non trouvée`
                        });
                    }
                    if (!unite.actif) {
                        return res.status(400).json({
                            success: false,
                            message: `L'unité "${unite.nom}" est inactive`
                        });
                    }
                }

                // ✅ Quantité obligatoire et positive
                if (!ligne.quantite || parseFloat(ligne.quantite) <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: `La quantité pour "${produit.nom}" doit être positive`
                    });
                }

                // ✅ NOUVEAU : prix d'achat OPTIONNEL
                // - Si absent (null, undefined, '') → OK, on laisse NULL
                // - Si fourni → doit être > 0
                if (
                    ligne.prix_achat !== null &&
                    ligne.prix_achat !== undefined &&
                    ligne.prix_achat !== ''
                ) {
                    const prix = parseFloat(ligne.prix_achat);
                    if (isNaN(prix) || prix <= 0) {
                        return res.status(400).json({
                            success: false,
                            message: `Le prix d'achat pour "${produit.nom}" doit être positif ou vide`
                        });
                    }
                }
            }

            // ========== 4. CRÉATION ==========
            const commande = await CommandeAchat.create({
                id_fournisseur,
                date_commande,
                notes,
                id_utilisateur: req.workspaceId,
                lignes: lignes || []
            });

            return res.status(201).json({
                success: true,
                message: 'Commande créée avec succès',
                data: commande
            });

        } catch (error) {
            console.error('❌ Create commande error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création de la commande',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer toutes les commandes du workspace
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                id_fournisseur,
                statut,
                date_debut,
                date_fin,
                montant_min,
                montant_max,
                page = 1,
                limit = 20
            } = req.query;

            const filters = {
                search,
                id_fournisseur,
                statut,
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

            const commandes = await CommandeAchat.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: commandes.length,
                page: pageNum,
                limit: limitNum,
                data: commandes
            });

        } catch (error) {
            console.error('❌ Get all commandes error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une commande par ID
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            const commande = await CommandeAchat.findById(id, req.workspaceId);

            if (!commande) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                data: commande
            });

        } catch (error) {
            console.error('❌ Get commande by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la commande'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les commandes par statut
     * ============================================================
     */
    static async getByStatut(req, res) {
        try {
            const { statut } = req.params;

            const commandes = await CommandeAchat.findByStatut(statut, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: commandes.length,
                data: commandes
            });

        } catch (error) {
            console.error('❌ Get by statut error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les commandes d'un fournisseur
     * ============================================================
     */
    static async getByFournisseur(req, res) {
        try {
            const { id_fournisseur } = req.params;

            const commandes = await CommandeAchat.findByFournisseur(id_fournisseur, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: commandes.length,
                data: commandes
            });

        } catch (error) {
            console.error('❌ Get by fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les commandes du mois en cours
     * ============================================================
     */
    static async getCurrentMonth(req, res) {
        try {
            const commandes = await CommandeAchat.getCurrentMonth(req.workspaceId);

            return res.status(200).json({
                success: true,
                count: commandes.length,
                data: commandes
            });

        } catch (error) {
            console.error('❌ Get current month error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes'
            });
        }
    }

    /**
     * ============================================================
     * ✅ Mettre à jour une commande (NIVEAU 3)
     * ============================================================
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const { date_commande, id_fournisseur, notes, lignes } = req.body;

            // Vérifier existence
            const existing = await CommandeAchat.findById(id, req.workspaceId);
            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée'
                });
            }

            if (['recue', 'annulee'].includes(existing.statut)) {
                return res.status(400).json({
                    success: false,
                    message: `Impossible de modifier une commande ${existing.statut}`
                });
            }

            // Vérifier le fournisseur si modifié
            if (id_fournisseur && id_fournisseur !== existing.id_fournisseur) {
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
            }

            // Vérifier les lignes si modifiées
            if (lignes) {
                if (lignes.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'La commande doit contenir au moins un produit'
                    });
                }
                for (const ligne of lignes) {
                    const produit = await Produit.findById(ligne.id_produit, req.workspaceId);
                    if (!produit) {
                        return res.status(404).json({
                            success: false,
                            message: `Produit ID ${ligne.id_produit} non trouvé`
                        });
                    }

                    if (ligne.id_unite_vente) {
                        const unite = await UniteVente.findById(ligne.id_unite_vente, req.workspaceId);
                        if (!unite) {
                            return res.status(404).json({
                                success: false,
                                message: `Unité de vente ID ${ligne.id_unite_vente} non trouvée`
                            });
                        }
                    }

                    if (!ligne.quantite || parseFloat(ligne.quantite) <= 0) {
                        return res.status(400).json({
                            success: false,
                            message: `Quantité invalide pour "${produit.nom}"`
                        });
                    }

                    // ✅ Prix OPTIONNEL
                    if (
                        ligne.prix_achat !== null &&
                        ligne.prix_achat !== undefined &&
                        ligne.prix_achat !== ''
                    ) {
                        const prix = parseFloat(ligne.prix_achat);
                        if (isNaN(prix) || prix <= 0) {
                            return res.status(400).json({
                                success: false,
                                message: `Prix d'achat invalide pour "${produit.nom}"`
                            });
                        }
                    }
                }
            }

            const commande = await CommandeAchat.update(id, {
                date_commande,
                id_fournisseur,
                notes,
                lignes
            }, req.workspaceId);

            return res.status(200).json({
                success: true,
                message: 'Commande mise à jour avec succès',
                data: commande
            });

        } catch (error) {
            console.error('❌ Update commande error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la mise à jour de la commande'
            });
        }
    }

    /**
     * ============================================================
     * ✅ Ajouter des produits à une commande (NIVEAU 3)
     * ============================================================
     */
    static async addLignes(req, res) {
        try {
            const { id } = req.params;
            const { lignes } = req.body;

            if (!lignes || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit est requis'
                });
            }

            for (const ligne of lignes) {
                const produit = await Produit.findById(ligne.id_produit, req.workspaceId);
                if (!produit) {
                    return res.status(404).json({
                        success: false,
                        message: `Produit ID ${ligne.id_produit} non trouvé`
                    });
                }

                if (ligne.id_unite_vente) {
                    const unite = await UniteVente.findById(ligne.id_unite_vente, req.workspaceId);
                    if (!unite) {
                        return res.status(404).json({
                            success: false,
                            message: `Unité de vente ID ${ligne.id_unite_vente} non trouvée`
                        });
                    }
                }

                if (!ligne.quantite || parseFloat(ligne.quantite) <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Quantité invalide pour "${produit.nom}"`
                    });
                }

                // ✅ Prix OPTIONNEL
                if (
                    ligne.prix_achat !== null &&
                    ligne.prix_achat !== undefined &&
                    ligne.prix_achat !== ''
                ) {
                    const prix = parseFloat(ligne.prix_achat);
                    if (isNaN(prix) || prix <= 0) {
                        return res.status(400).json({
                            success: false,
                            message: `Prix d'achat invalide pour "${produit.nom}"`
                        });
                    }
                }
            }

            const commande = await CommandeAchat.addLignes(id, lignes, req.workspaceId);

            return res.status(200).json({
                success: true,
                message: 'Produits ajoutés à la commande',
                data: commande
            });

        } catch (error) {
            console.error('❌ Add lignes error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'ajout des produits'
            });
        }
    }

    /**
     * ============================================================
     * Mettre à jour le statut d'une commande
     * ============================================================
     */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'envoyee', 'partiellement_recue', 'recue', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const commande = await CommandeAchat.findById(id, req.workspaceId);
            if (!commande) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée'
                });
            }

            if (commande.statut === 'recue' && statut !== 'recue') {
                return res.status(400).json({
                    success: false,
                    message: 'Une commande reçue ne peut pas changer de statut'
                });
            }
            if (commande.statut === 'annulee' && statut !== 'annulee') {
                return res.status(400).json({
                    success: false,
                    message: 'Une commande annulée ne peut pas changer de statut'
                });
            }

            const updated = await CommandeAchat.updateStatut(id, statut, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du statut'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await CommandeAchat.findById(id, req.workspaceId)
            });

        } catch (error) {
            console.error('❌ Update statut error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du statut'
            });
        }
    }

    /**
     * ============================================================
     * Annuler une commande
     * ============================================================
     */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            const peutAnnuler = await CommandeAchat.canAnnuler(id, req.workspaceId);
            if (!peutAnnuler) {
                return res.status(400).json({
                    success: false,
                    message: 'Cette commande ne peut pas être annulée'
                });
            }

            const updated = await CommandeAchat.updateStatut(id, 'annulee', req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de l\'annulation de la commande'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Commande annulée avec succès',
                data: await CommandeAchat.findById(id, req.workspaceId)
            });

        } catch (error) {
            console.error('❌ Annuler commande error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'annulation de la commande'
            });
        }
    }

    /**
     * ============================================================
     * Supprimer une commande (seulement si en attente)
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            const deleted = await CommandeAchat.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée ou ne peut pas être supprimée'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Commande supprimée avec succès'
            });

        } catch (error) {
            console.error('❌ Delete commande error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression de la commande'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les statistiques des commandes
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await CommandeAchat.getStats(req.workspaceId);

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
     * Exporter les commandes du workspace
     * ============================================================
     */
    static async export(req, res) {
        try {
            const commandes = await CommandeAchat.findAll(req.query, req.workspaceId);

            const exportData = commandes.map(c => ({
                id: c.id_commande_achat,
                numero: c.numero_commande,
                date: c.date_commande,
                fournisseur: c.fournisseur_nom,
                montant: parseFloat(c.montant_total) || 0,
                statut: c.statut,
                notes: c.notes || ''
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
                message: 'Erreur lors de l\'export des commandes'
            });
        }
    }
}

export default CommandeAchatController;