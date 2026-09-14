// controllers/InventaireController.js
import Inventaire from '../models/Inventaire.js';

class InventaireController {
    /**
     * ============================================================
     * Récupérer tous les inventaires du workspace
     * ============================================================
     */
    static async getAllInventaires(req, res) {
        try {
            // ✅ req.workspaceId en 2e argument
            const inventaires = await Inventaire.findAll(req.query, req.workspaceId);
            res.status(200).json({
                success: true,
                count: inventaires.length,
                data: inventaires
            });
        } catch (error) {
            console.error('❌ Erreur getAllInventaires:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des inventaires',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un inventaire par ID
     * ============================================================
     */
    static async getInventaireById(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const inventaire = await Inventaire.findById(id, req.workspaceId);

            if (!inventaire) {
                return res.status(404).json({
                    success: false,
                    message: 'Inventaire non trouvé'
                });
            }
            res.status(200).json({ success: true, data: inventaire });
        } catch (error) {
            console.error('❌ Erreur getInventaireById:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération de l\'inventaire',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Créer un inventaire
     * ============================================================
     */
    static async createInventaire(req, res) {
        try {
            const data = req.body;

            // ✅ CORRIGÉ : req.workspaceId au lieu de req.user.id_utilisateur
            data.id_utilisateur = req.workspaceId;

            const inventaire = await Inventaire.create(data);
            res.status(201).json({
                success: true,
                message: 'Inventaire créé avec succès',
                data: inventaire
            });
        } catch (error) {
            console.error('❌ Erreur createInventaire:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de la création de l\'inventaire'
            });
        }
    }

    /**
     * ============================================================
     * Démarrer un inventaire
     * ============================================================
     */
    static async demarrerInventaire(req, res) {
        try {
            const { id } = req.params;

            // ✅ CORRIGÉ : req.workspaceId
            const inventaire = await Inventaire.demarrer(id, req.workspaceId);

            res.status(200).json({
                success: true,
                message: 'Inventaire démarré',
                data: inventaire
            });
        } catch (error) {
            console.error('❌ Erreur demarrerInventaire:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors du démarrage'
            });
        }
    }

    /**
     * ============================================================
     * Saisir une ligne (quantité réelle)
     * ============================================================
     */
    static async saisirLigne(req, res) {
        try {
            const { id, id_ligne } = req.params;
            const { quantite_reelle, notes } = req.body;

            // ✅ req.workspaceId en 5e argument
            const result = await Inventaire.saisirLigne(
                id,
                id_ligne,
                quantite_reelle,
                notes,
                req.workspaceId
            );

            res.status(200).json({
                success: true,
                message: 'Ligne enregistrée',
                data: result
            });
        } catch (error) {
            console.error('❌ Erreur saisirLigne:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de la saisie'
            });
        }
    }

    /**
     * ============================================================
     * Saisie en masse
     * ============================================================
     */
    static async saisirLignesEnMasse(req, res) {
        try {
            const { id } = req.params;
            const { lignes } = req.body;

            if (!Array.isArray(lignes)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le tableau "lignes" est requis'
                });
            }

            // ✅ req.workspaceId en 3e argument
            const result = await Inventaire.saisirLignesEnMasse(id, lignes, req.workspaceId);

            res.status(200).json({
                success: true,
                message: 'Saisie en masse enregistrée',
                data: result
            });
        } catch (error) {
            console.error('❌ Erreur saisirLignesEnMasse:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de la saisie'
            });
        }
    }

    /**
     * ============================================================
     * Valider un inventaire (crée les ajustements)
     * ============================================================
     */
    static async validerInventaire(req, res) {
        try {
            const { id } = req.params;

            // ✅ CORRIGÉ : req.workspaceId
            const inventaire = await Inventaire.valider(id, req.workspaceId);

            res.status(200).json({
                success: true,
                message: 'Inventaire validé, ajustements créés',
                data: inventaire
            });
        } catch (error) {
            console.error('❌ Erreur validerInventaire:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de la validation'
            });
        }
    }

    /**
     * ============================================================
     * Annuler un inventaire
     * ============================================================
     */
    static async annulerInventaire(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            const inventaire = await Inventaire.annuler(id, req.workspaceId);

            res.status(200).json({
                success: true,
                message: 'Inventaire annulé',
                data: inventaire
            });
        } catch (error) {
            console.error('❌ Erreur annulerInventaire:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de l\'annulation'
            });
        }
    }

    /**
     * ============================================================
     * Supprimer un inventaire
     * ============================================================
     */
    static async deleteInventaire(req, res) {
        try {
            const { id } = req.params;

            // ✅ req.workspaceId en 2e argument
            await Inventaire.delete(id, req.workspaceId);

            res.status(200).json({
                success: true,
                message: 'Inventaire supprimé'
            });
        } catch (error) {
            console.error('❌ Erreur deleteInventaire:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de la suppression'
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des inventaires (workspace)
     * ============================================================
     */
    static async getInventaireStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Inventaire.getStats(req.workspaceId);

            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            console.error('❌ Erreur getInventaireStats:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }
    }
}

export default InventaireController;