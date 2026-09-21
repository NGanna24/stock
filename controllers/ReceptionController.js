// controllers/ReceptionController.js
import Reception from '../models/Reception.js';
import CommandeAchat from '../models/CommandeAchat.js';
import Produit from '../models/Produit.js';
import Fournisseur from '../models/Fournisseur.js';

class ReceptionController {
    /**
     * ============================================================
     * ✅ Créer une nouvelle réception
     *    - ACCEPTE les réceptions partielles
     *    - ACCEPTE les surplus
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_commande_achat,
                date_reception,
                notes,
                lignes
            } = req.body;

            // ========== 1. VALIDATIONS DE BASE ==========
            if (!date_reception) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de réception est obligatoire'
                });
            }
            if (!lignes || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit est requis'
                });
            }

            // ========== 2. VÉRIFIER LA COMMANDE ==========
            if (id_commande_achat) {
                const commande = await CommandeAchat.findById(id_commande_achat, req.workspaceId);
                if (!commande) {
                    return res.status(404).json({
                        success: false,
                        message: 'Commande non trouvée'
                    });
                }

                if (commande.statut === 'recue') {
                    return res.status(400).json({
                        success: false,
                        message: 'Cette commande a déjà été entièrement reçue'
                    });
                }
                if (commande.statut === 'annulee') {
                    return res.status(400).json({
                        success: false,
                        message: 'Cette commande est annulée, impossible de la recevoir'
                    });
                }
            }

            // ========== 3. VÉRIFIER LES PRODUITS ==========
            for (const ligne of lignes) {
                const {
                    id_produit,
                    id_unite_vente = null,
                    quantite_base = 1,
                    quantite_commandee = 0,
                    quantite_recue,
                    quantite_totale_base = null
                } = ligne;

                const produit = await Produit.findById(id_produit, req.workspaceId);
                if (!produit) {
                    return res.status(404).json({
                        success: false,
                        message: `Produit ID ${id_produit} non trouvé`
                    });
                }

                if (!quantite_recue || parseFloat(quantite_recue) <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: `La quantité reçue pour "${produit.nom}" doit être positive`
                    });
                }

                // ============================================================
                // ✅ SURPLUS AUTORISÉ : on log juste un avertissement
                // ============================================================
                let qteBase = parseFloat(quantite_base) || 1;
                const qteTotaleBase = quantite_totale_base !== null
                    ? parseFloat(quantite_totale_base)
                    : parseFloat(quantite_recue) * qteBase;

                if (quantite_commandee && parseFloat(quantite_commandee) > 0) {
                    const qteCommandeeBase = parseFloat(quantite_commandee) * qteBase;
                    if (qteTotaleBase > qteCommandeeBase) {
                        console.log(
                            `⚠️ Surplus détecté pour "${produit.nom}" : ` +
                            `commandé ${qteCommandeeBase}, reçu ${qteTotaleBase}`
                        );
                        // ✅ On continue, pas d'erreur
                    }
                }
            }

            // ========== 4. CRÉATION ==========
            const reception = await Reception.create({
                id_commande_achat,
                date_reception,
                notes,
                id_utilisateur: req.workspaceId,
                lignes
            });

            return res.status(201).json({
                success: true,
                message: 'Réception créée avec succès',
                data: reception
            });

        } catch (error) {
            console.error('❌ Create reception error:', error);

            const isBusinessError = error.message && (
                error.message.includes('non trouvé') ||
                error.message.includes('obligatoire') ||
                error.message.includes('positive') ||
                error.message.includes('déjà été') ||
                error.message.includes('annulée') ||
                error.message.includes('existe déjà') ||
                error.message.includes('requis')
            );

            return res.status(isBusinessError ? 400 : 500).json({
                success: false,
                message: error.message || 'Erreur lors de la création de la réception',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer toutes les réceptions
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                id_commande_achat,
                statut,
                date_debut,
                date_fin,
                page = 1,
                limit = 20
            } = req.query;

            const filters = {
                search,
                id_commande_achat,
                statut,
                date_debut,
                date_fin
            };

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            filters.limit = limitNum;
            filters.offset = offset;

            const receptions = await Reception.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: receptions.length,
                page: pageNum,
                limit: limitNum,
                data: receptions
            });

        } catch (error) {
            console.error('❌ Get all receptions error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des réceptions'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer une réception par ID
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const reception = await Reception.findById(id, req.workspaceId);

            if (!reception) {
                return res.status(404).json({
                    success: false,
                    message: 'Réception non trouvée'
                });
            }

            return res.status(200).json({
                success: true,
                data: reception
            });

        } catch (error) {
            console.error('❌ Get reception by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de la réception'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les réceptions par statut
     * ============================================================
     */
    static async getByStatut(req, res) {
        try {
            const { statut } = req.params;

            const statutsValides = ['en_attente', 'partielle', 'complete', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const receptions = await Reception.findByStatut(statut, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: receptions.length,
                data: receptions
            });

        } catch (error) {
            console.error('❌ Get by statut error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des réceptions'
            });
        }
    }

    /**
     * ============================================================
     * Récupérer les réceptions d'une commande
     * ============================================================
     */
    static async getByCommande(req, res) {
        try {
            const { id_commande } = req.params;
            const receptions = await Reception.findByCommande(id_commande, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: receptions.length,
                data: receptions
            });

        } catch (error) {
            console.error('❌ Get by commande error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des réceptions'
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des réceptions
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await Reception.getStats(req.workspaceId);

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
     * Mettre à jour le statut d'une réception
     * ============================================================
     */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'partielle', 'complete', 'annulee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({
                    success: false,
                    message: 'Statut invalide'
                });
            }

            const reception = await Reception.findById(id, req.workspaceId);
            if (!reception) {
                return res.status(404).json({
                    success: false,
                    message: 'Réception non trouvée'
                });
            }

            const updated = await Reception.updateStatut(id, statut, req.workspaceId);

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour du statut'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await Reception.findById(id, req.workspaceId)
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
     * Supprimer une réception
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            const deleted = await Reception.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Réception non trouvée ou ne peut pas être supprimée'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Réception supprimée avec succès'
            });

        } catch (error) {
            console.error('❌ Delete reception error:', error);

            const isBusinessError = error.message && (
                error.message.includes('non trouvée') ||
                error.message.includes('Impossible de supprimer')
            );

            return res.status(isBusinessError ? 400 : 500).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression de la réception'
            });
        }
    }

    /**
     * ============================================================
     * Exporter les réceptions
     * ============================================================
     */
    static async export(req, res) {
        try {
            const receptions = await Reception.findAll(req.query, req.workspaceId);

            const exportData = receptions.map(r => ({
                id: r.id_reception,
                numero: r.numero_reception,
                date: r.date_reception,
                fournisseur: r.fournisseur_nom || '-',
                commande: r.numero_commande || '-',
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
                message: 'Erreur lors de l\'export des réceptions'
            });
        }
    }
}

export default ReceptionController; 