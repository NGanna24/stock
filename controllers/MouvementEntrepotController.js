// controllers/MouvementEntrepotController.js
import MouvementEntrepot from '../models/MouvementEntrepot.js';
import Entrepot from '../models/Entrepot.js';
import CommandeAchat from '../models/CommandeAchat.js';

class MouvementEntrepotController {
    static async _checkAccess(id_entrepot, id_utilisateur) {
        const ok = (await Entrepot.isMembre(id_entrepot, id_utilisateur))
            || (await CommandeAchat.estProprietaireEntrepot(id_entrepot, id_utilisateur));
        if (!ok) {
            const err = new Error('Accès refusé à cet entrepôt');
            err.statusCode = 403;
            throw err;
        }
    }

    static _id(v) {
        const n = parseInt(v, 10);
        if (!n || n < 1) {
            const err = new Error('Entrepôt invalide');
            err.statusCode = 400;
            throw err;
        }
        return n;
    }

    static _error(res, error, fallback) {
        const status = error.statusCode || 500;
        if (status >= 500) console.error('❌ MouvementEntrepot:', error);
        return res.status(status).json({ success: false, message: status >= 500 ? fallback : error.message });
    }

    /** GET /entrepots/:id_entrepot/mouvements?type=&q=&date_debut=&date_fin=&id_produit_entrepot=&page=&limit= */
    static async list(req, res) {
        try {
            const id_entrepot = MouvementEntrepotController._id(req.params.id_entrepot);
            await MouvementEntrepotController._checkAccess(id_entrepot, req.workspaceId);
            const data = await MouvementEntrepot.list(id_entrepot, req.query);
            res.json({ success: true, ...data });
        } catch (error) {
            MouvementEntrepotController._error(res, error, 'Erreur lors du chargement des mouvements');
        }
    }

    /** GET /entrepots/:id_entrepot/synthese?jours=30 */
    static async synthese(req, res) {
        try {
            const id_entrepot = MouvementEntrepotController._id(req.params.id_entrepot);
            await MouvementEntrepotController._checkAccess(id_entrepot, req.workspaceId);
            const jours = [7, 30, 90].includes(parseInt(req.query.jours, 10)) ? parseInt(req.query.jours, 10) : 30;
            const data = await MouvementEntrepot.synthese(id_entrepot, jours);
            res.json({ success: true, data });
        } catch (error) {
            MouvementEntrepotController._error(res, error, "Erreur lors du chargement de l'aperçu");
        }
    }
}

export default MouvementEntrepotController;