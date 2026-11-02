// controllers/CaisseController.js
import Caisse from '../models/Caisse.js';

const sendError = (res, error, fallback) => {
    console.error('❌', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

/** Qui agit (compte principal ou employé) — posé par authenticateToken */
const auteur = (req) => ({
    type: req.user?.type === 'employe' ? 'employe' : 'utilisateur',
    id: req.user?.type === 'employe' ? req.user?.id_employe : req.user?.id,
    nom: req.user?.fullname || null,
});

class CaisseController {
    /* GET /api/caisse/courante */
    static async courante(req, res) {
        try {
            res.json({ success: true, data: await Caisse.getCourante(req.workspaceId) });
        } catch (error) {
            sendError(res, error, "Erreur lors du chargement de la caisse");
        }
    }

    /* POST /api/caisse/ouvrir  { fond_initial, note? } */
    static async ouvrir(req, res) {
        try {
            await Caisse.ouvrir({
                id_utilisateur: req.workspaceId,
                fond_initial: req.body?.fond_initial,
                note: req.body?.note,
                par: auteur(req),
            });
            res.status(201).json({ success: true, message: 'Caisse ouverte', data: await Caisse.getCourante(req.workspaceId) });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'ouverture de la caisse");
        }
    }

    /* POST /api/caisse/:id/cloturer  { montant_compte, detail_comptage?, note? } */
    static async cloturer(req, res) {
        try {
            const data = await Caisse.cloturer({
                id_session: parseInt(req.params.id, 10) || 0,
                id_utilisateur: req.workspaceId,
                montant_compte: req.body?.montant_compte,
                detail_comptage: req.body?.detail_comptage || null,
                note: req.body?.note,
                par: auteur(req),
            });
            res.json({ success: true, message: 'Caisse clôturée', data });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la clôture de la caisse');
        }
    }

    /* GET /api/caisse/historique?dateDebut&dateFin   (admin, manager) */
    static async historique(req, res) {
        try {
            res.json({ success: true, data: await Caisse.historique(req.workspaceId, req.query) });
        } catch (error) {
            sendError(res, error, "Erreur lors du chargement de l'historique");
        }
    }

    /* GET /api/caisse/:id   (admin, manager) */
    static async detail(req, res) {
        try {
            res.json({ success: true, data: await Caisse.getById(parseInt(req.params.id, 10) || 0, req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement de la session');
        }
    }
}

export default CaisseController;
