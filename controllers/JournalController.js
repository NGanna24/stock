// controllers/JournalController.js
import Journal from '../models/Journal.js';

const sendError = (res, error, fallback) => {
    console.error('❌', error);
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

class JournalController {
    /* GET /api/journal?dateDebut&dateFin&acteur=employe:3&module&action&search&page&limit */
    static async lister(req, res) {
        try {
            res.json({ success: true, data: await Journal.lister(req.workspaceId, req.query) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement du journal');
        }
    }

    /* GET /api/journal/facettes?dateDebut&dateFin */
    static async facettes(req, res) {
        try {
            res.json({ success: true, data: await Journal.facettes(req.workspaceId, req.query) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement des filtres');
        }
    }

    /* GET /api/journal/export (mêmes filtres) */
    static async exporter(req, res) {
        try {
            res.json({ success: true, data: await Journal.exporter(req.workspaceId, req.query) });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'export du journal");
        }
    }

    /* GET /api/journal/:id */
    static async detail(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!id) return res.status(400).json({ success: false, message: 'Identifiant invalide' });
            const ligne = await Journal.detail(req.workspaceId, id);
            if (!ligne) return res.status(404).json({ success: false, message: 'Entrée introuvable' });
            res.json({ success: true, data: ligne });
        } catch (error) {
            sendError(res, error, "Erreur lors du chargement de l'entrée");
        }
    }
}

export default JournalController;
