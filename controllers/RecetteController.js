// controllers/RecetteController.js
import Recette from '../models/Recette.js';

class RecetteController {
    /**
     * ============================================================
     * LISTE DE TOUTES LES RECETTES
     * ============================================================
     */
    static async getAllRecettes(req, res) {
        try {
            const filters = {
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin,
                modePaiement: req.query.modePaiement,
                search: req.query.search
            };

            const [
                recettes,
                stats,
                parJour,
                parMode,
                topClients
            ] = await Promise.all([
                Recette.findAll(req.workspaceId, filters),
                Recette.getStats(req.workspaceId, filters),
                Recette.getRecettesParJour(req.workspaceId, filters),
                Recette.getRecettesParMode(req.workspaceId, filters),
                Recette.getTopClients(req.workspaceId, filters, 10)
            ]);

            res.status(200).json({
                success: true,
                count: recettes.length,
                data: {
                    recettes,
                    stats,
                    par_jour: parJour,
                    par_mode: parMode,
                    top_clients: topClients
                }
            });
        } catch (error) {
            console.error('❌ Erreur getAllRecettes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des recettes',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * CRÉER UNE RECETTE
     * ============================================================
     */
    static async createRecette(req, res) {
        try {
            const data = req.body;

            // Validations
            if (!data.id_facture) {
                return res.status(400).json({
                    success: false,
                    message: 'La facture est obligatoire'
                });
            }

            if (!data.montant || data.montant <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Le montant doit être supérieur à 0'
                });
            }

            if (!data.date_paiement) {
                return res.status(400).json({
                    success: false,
                    message: 'La date de paiement est obligatoire'
                });
            }

            const id = await Recette.create(data, req.workspaceId);

            // Récupérer la recette créée
            const recettes = await Recette.findAll(req.workspaceId, {});
            const newRecette = recettes.find(r => r.id_paiement === id);

            res.status(201).json({
                success: true,
                message: 'Recette créée avec succès',
                data: newRecette
            });
        } catch (error) {
            console.error('❌ Erreur createRecette:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la recette',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * SUPPRIMER UNE RECETTE
     * ============================================================
     */
    static async deleteRecette(req, res) {
        try {
            const { id } = req.params;

            const exists = await Recette.exists(id, req.workspaceId);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Recette non trouvée'
                });
            }

            const deleted = await Recette.delete(id, req.workspaceId);

            if (deleted) {
                res.status(200).json({
                    success: true,
                    message: 'Recette supprimée avec succès'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Erreur lors de la suppression'
                });
            }
        } catch (error) {
            console.error('❌ Erreur deleteRecette:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de la recette',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * STATISTIQUES DES RECETTES
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const filters = {
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin
            };

            const stats = await Recette.getStats(req.workspaceId, filters);

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getStats recettes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * FACTURES IMPAYÉES (pour créer une recette)
     * ============================================================
     */
    static async getFacturesImpayees(req, res) {
        try {
            const factures = await Recette.getFacturesImpayees(req.workspaceId);

            res.status(200).json({
                success: true,
                count: factures.length,
                data: factures
            });
        } catch (error) {
            console.error('❌ Erreur getFacturesImpayees:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des factures impayées',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * EXPORT CSV DES RECETTES
     * ============================================================
     */
    static async exportRecettes(req, res) {
        try {
            const filters = {
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin
            };

            const recettes = await Recette.findAll(req.workspaceId, filters);
            const stats = await Recette.getStats(req.workspaceId, filters);

            const headers = [
                'Date', 'N° Facture', 'N° Commande', 'Client',
                'Téléphone', 'Montant', 'Mode paiement', 'Référence', 'Note'
            ];

            const rows = recettes.map(r => [
                r.date_formatee || r.date_paiement,
                r.numero_facture || '',
                r.numero_commande || '',
                r.nomclient || '',
                r.telephone || '',
                r.montant,
                r.mode_paiement,
                r.reference || '',
                r.note || ''
            ]);

            const csvContent = [
                `"Rapport des recettes du ${filters.dateDebut || 'début'} au ${filters.dateFin || 'aujourd\'hui'}"`,
                '',
                `"Nombre de paiements: ${stats.nombre_paiements}"`,
                `"Total recettes: ${stats.total_recettes} FCFA"`,
                `"Moyenne paiement: ${stats.moyenne_paiement.toFixed(2)} FCFA"`,
                '',
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=recettes_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportRecettes:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default RecetteController;