// controllers/InventaireController.js
import Inventaire from '../models/Inventaire.js';

class InventaireController {
    static async getAllInventaires(req, res) {
        try {
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
                message: 'Erreur lors de la récupération des inventaires'
            });
        }
    }

    static async getInventaireById(req, res) {
        try {
            const { id } = req.params;
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
                message: 'Erreur lors de la récupération de l\'inventaire'
            });
        }
    }

    static async createInventaire(req, res) {
        try {
            const data = req.body;
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
                message: error.message || 'Erreur lors de la création'
            });
        }
    }

    static async demarrerInventaire(req, res) {
        try {
            const { id } = req.params;
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

    static async saisirLigne(req, res) {
        try {
            const { id, id_ligne } = req.params;
            const { quantite_reelle, notes } = req.body;

            const result = await Inventaire.saisirLigne(
                id, id_ligne, quantite_reelle, notes, req.workspaceId
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

    static async validerInventaire(req, res) {
        try {
            const { id } = req.params;
            const valide_par_nom = req.user?.fullname || req.user?.email || 'Système';

            const result = await Inventaire.valider(id, req.workspaceId, valide_par_nom);

            res.status(200).json({
                success: true,
                message: `Inventaire validé. ${result.nb_ajustements} ajustement(s) créé(s).`,
                data: result
            });
        } catch (error) {
            console.error('❌ Erreur validerInventaire:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erreur lors de la validation'
            });
        }
    }

    static async annulerInventaire(req, res) {
        try {
            const { id } = req.params;
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

    static async deleteInventaire(req, res) {
        try {
            const { id } = req.params;
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

    static async getInventaireStats(req, res) {
        try {
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