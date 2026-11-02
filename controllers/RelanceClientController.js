// controllers/RelanceClientController.js
import RelanceClient from '../models/RelanceClient.js';

const sendError = (res, error, fallback) => {
    console.error('❌', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

/** Qui relance (pour un employé, req.user.id contient l'id du patron : on prend id_employe) */
const auteur = (req) => ({
    type: req.user?.type === 'employe' ? 'employe' : 'utilisateur',
    id: req.user?.type === 'employe' ? req.user?.id_employe : req.user?.id,
    nom: req.user?.fullname || null,
});

class RelanceClientController {
    /* GET /api/relances */
    static async liste(req, res) {
        try {
            res.json({ success: true, data: await RelanceClient.liste(req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement des clients à relancer');
        }
    }

    /* GET /api/relances/client?telephone=... (le téléphone peut contenir « + » : on le passe en paramètre) */
    static async detail(req, res) {
        try {
            res.json({ success: true, data: await RelanceClient.detail(req.workspaceId, req.query.telephone) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement du client');
        }
    }

    /* POST /api/relances  { telephone, canal, message?, note? } */
    static async enregistrer(req, res) {
        try {
            const data = await RelanceClient.enregistrer(req.workspaceId, req.body || {}, auteur(req));
            res.status(201).json({ success: true, message: 'Relance enregistrée', data });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'enregistrement de la relance");
        }
    }
}

export default RelanceClientController;
