// controllers/CommandeVenteController.js
import CommandeVente from '../models/CommandeVente.js';
import Produit from '../models/Produit.js';

class CommandeVenteController {
    /**
     * ============================================================
     * ✅ Créer une nouvelle commande client (avec unités de vente)
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                nomclient = null,
                telephone = null,
                date_commande,
                notes,
                mode_paiement,
                date_echeance,
                lignes
            } = req.body;

            // ========== 1. VALIDATIONS DE BASE ==========
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

            // ========== 2. VÉRIFICATIONS PRODUITS + STOCK + UNITÉS ==========
            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_unite_vente = null,
                    quantite,
                    quantite_base = 1,
                    quantite_totale_base = null,
                    prix_vente = 0
                } = ligne;

                // --- Vérifier le produit (workspace) ---
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

                // --- Déterminer quantite_base ---
                let qteBase = parseFloat(quantite_base) || 1;

                // Si id_unite_vente est fourni mais quantite_base absent,
                // on pourrait le récupérer depuis unites_vente.
                // Le modèle CommandeVente.create le fera de toute façon,
                // mais on a besoin de la valeur ici pour valider le stock.

                // --- Calculer la quantité en unité de base ---
                const qteTotaleBase = quantite_totale_base !== null
                    ? parseFloat(quantite_totale_base)
                    : parseFloat(quantite) * qteBase;

                // --- Vérifier le stock EN UNITÉ DE BASE ---
                const stockDisponible = parseFloat(produit.quantite_stock) || 0;
                if (qteTotaleBase > stockDisponible) {
                    return res.status(400).json({
                        success: false,
                        message:
                            `Stock insuffisant pour "${produit.nom}". ` +
                            `Disponible: ${stockDisponible} unité(s) de base, ` +
                            `Demandé: ${qteTotaleBase} unité(s) de base ` +
                            `(${quantite} × ${qteBase})`
                    });
                }

                // --- Vérifier qu'un prix de vente est disponible ---
                // Priorité : prix fourni > prix unité de vente > prix produit
                let prixEffectif = parseFloat(prix_vente) || 0;
                if (!prixEffectif) {
                    // Si pas de prix fourni, on laisse le modèle gérer
                    // (il récupérera depuis unites_vente ou produits.prix_vente)
                    // Mais on vérifie au moins que produits.prix_vente existe
                    if (!produit.prix_vente || parseFloat(produit.prix_vente) <= 0) {
                        return res.status(400).json({
                            success: false,
                            message: `Le prix de vente du produit "${produit.nom}" n'est pas défini`
                        });
                    }
                }
            }

            // ========== 3. CRÉATION ==========
            const commande = await CommandeVente.create({
                nomclient: nomclient || null,
                telephone: telephone || null,
                date_commande,
                notes: notes || null,
                id_utilisateur: req.workspaceId,
                mode_paiement: mode_paiement || 'especes',
                date_echeance: date_echeance || null,
                lignes  // ✅ On transmet les lignes telles quelles (avec id_unite_vente, quantite_base, etc.)
            });

            return res.status(201).json({
                success: true,
                message: 'Commande client créée avec succès',
                data: commande
            });

        } catch (error) {
            console.error('❌ Create commande vente error:', error);
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
                statut,
                date_debut,
                date_fin,
                page = 1,
                limit = 20
            } = req.query;

            const filters = { search, statut, date_debut, date_fin };

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            filters.limit = limitNum;
            filters.offset = offset;

            const commandes = await CommandeVente.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                data: commandes,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: commandes.length
                }
            });

        } catch (error) {
            console.error('❌ Get all commandes vente error:', error);
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

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de commande invalide'
                });
            }

            const commande = await CommandeVente.findById(parseInt(id), req.workspaceId);

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
            console.error('❌ Get commande vente by ID error:', error);
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

            const statutsValides = ['en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const commandes = await CommandeVente.findByStatut(statut, req.workspaceId);

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
     * Récupérer les commandes d'un client par téléphone
     * ============================================================
     */
    static async getByTelephone(req, res) {
        try {
            const { telephone } = req.params;

            if (!telephone || telephone.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le téléphone est obligatoire'
                });
            }

            const commandes = await CommandeVente.findByTelephone(telephone.trim(), req.workspaceId);

            return res.status(200).json({
                success: true,
                count: commandes.length,
                data: commandes
            });

        } catch (error) {
            console.error('❌ Get by telephone error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des commandes'
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

            const statutsValides = ['en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const commande = await CommandeVente.findById(id, req.workspaceId);
            if (!commande) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée'
                });
            }

            if (commande.statut === 'livree' && statut !== 'livree') {
                return res.status(400).json({
                    success: false,
                    message: 'Une commande livrée ne peut pas changer de statut'
                });
            }
            if (commande.statut === 'annulee' && statut !== 'annulee') {
                return res.status(400).json({
                    success: false,
                    message: 'Une commande annulée ne peut pas changer de statut'
                });
            }

            const updated = await CommandeVente.updateStatut(id, statut, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du statut'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await CommandeVente.findById(id, req.workspaceId)
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
     * Ajouter un paiement sur une commande
     * ============================================================
     */
    static async addPaiement(req, res) {
        try {
            const { id } = req.params;
            const {
                id_facture,
                date_paiement,
                montant,
                mode_paiement,
                note,
                reference
            } = req.body;

            // Validations
            if (!date_paiement) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de paiement est obligatoire'
                });
            }
            if (!montant || parseFloat(montant) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le montant doit être positif'
                });
            }

            // Vérifier commande DANS le workspace
            const commande = await CommandeVente.findById(id, req.workspaceId);
            if (!commande) {
                return res.status(404).json({
                    success: false,
                    message: 'Commande non trouvée'
                });
            }

            const paiement = await CommandeVente.addPaiement(id, {
                id_facture: id_facture || null,
                date_paiement,
                montant: parseFloat(montant),
                mode_paiement: mode_paiement || 'especes',
                note: note || null,
                reference: reference || null
            }, req.workspaceId);

            return res.status(201).json({
                success: true,
                message: '✅ Paiement enregistré avec succès',
                data: paiement
            });

        } catch (error) {
            console.error('❌ Add paiement error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'enregistrement du paiement'
            });
        }
    }

    /**
     * ============================================================
     * Annuler une commande (avec réintégration du stock)
     * ============================================================
     */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            const annule = await CommandeVente.annuler(id, req.workspaceId);

            if (!annule) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible d\'annuler cette commande'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Commande annulée avec succès',
                data: await CommandeVente.findById(id, req.workspaceId)
            });

        } catch (error) {
            console.error('❌ Annuler commande error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'annulation de la commande'
            });
        }
    }

    /**
     * ============================================================
     * Supprimer une commande
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            const deleted = await CommandeVente.delete(id, req.workspaceId);

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
     * Récupérer les statistiques
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await CommandeVente.getStats(req.workspaceId);

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
            const commandes = await CommandeVente.findAll(req.query, req.workspaceId);

            const exportData = commandes.map(c => ({
                id: c.id_commande,
                numero: c.numero_commande,
                date: c.date_commande,
                client: c.nomclient || '-',
                telephone: c.telephone || '-',
                facture: c.numero_facture || '-',
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

export default CommandeVenteController;