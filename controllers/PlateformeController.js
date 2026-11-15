// controllers/PlateformeController.js
import Plateforme from '../models/Plateforme.js';

const erreur = (res, e, ou) => {
    console.error(`PlateformeController.${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

class PlateformeController {
    /** GET /api/plateforme/etat (public) */
    static async etat(req, res) {
        try {
            res.set('Cache-Control', 'no-store');
            return res.json({ success: true, ...(await Plateforme.etatPublic()) });
        } catch (e) { return erreur(res, e, 'etat'); }
    }
    /** GET /api/super-admin/plateforme */
    static async reglages(req, res) {
        try { return res.json({ success: true, reglages: await Plateforme.reglages() }); } catch (e) { return erreur(res, e, 'reglages'); }
    }
    /** PUT /api/super-admin/plateforme */
    static async modifier(req, res) {
        try {
            return res.json({ success: true, message: 'Réglages enregistrés', reglages: await Plateforme.modifier(req.body || {}) });
        } catch (e) { return erreur(res, e, 'modifier'); }
    }
}

export default PlateformeController;
