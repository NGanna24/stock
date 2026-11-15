// controllers/SuiviAdminController.js
// Pages de suivi de la console Super Admin.
import Suivi from '../models/Suivi.js';
import JournalSuperAdmin from '../models/JournalSuperAdmin.js';

const erreur = (res, e, ou) => {
    console.error(`❌ Suivi ${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

class SuiviAdminController {
    static async alertes(req, res) {
        try { return res.json({ success: true, ...(await Suivi.alertes()) }); } catch (e) { return erreur(res, e, 'alertes'); }
    }
    static async nombreAlertes(req, res) {
        try { return res.json({ success: true, total: await Suivi.nombreAlertes() }); } catch (e) { return erreur(res, e, 'nombreAlertes'); }
    }
    static async activite(req, res) {
        try {
            const { type, q, jours, limite, page, patron } = req.query;
            return res.json({ success: true, ...(await Suivi.activite({ type, q: String(q || '').trim().slice(0, 80), jours, limite, page, id_utilisateur: patron })) });
        } catch (e) { return erreur(res, e, 'activite'); }
    }
    static async revenus(req, res) {
        try { return res.json({ success: true, ...(await Suivi.revenus()) }); } catch (e) { return erreur(res, e, 'revenus'); }
    }
    static async apercu(req, res) {
        try { return res.json({ success: true, ...(await Suivi.apercu()) }); } catch (e) { return erreur(res, e, 'apercu'); }
    }
    static async rapport(req, res) {
        try {
            const { du, au } = req.query;
            return res.json({ success: true, ...(await Suivi.rapport({ du, au })) });
        } catch (e) { return erreur(res, e, 'rapport'); }
    }
    static async statistiques(req, res) {
        try { return res.json({ success: true, ...(await Suivi.statistiques()) }); } catch (e) { return erreur(res, e, 'statistiques'); }
    }
    static async journal(req, res) {
        try {
            const { action, q, jours, limite, page } = req.query;
            return res.json({ success: true, ...(await JournalSuperAdmin.liste({ action, q: String(q || '').trim().slice(0, 80), jours, limite, page })) });
        } catch (e) { return erreur(res, e, 'journal'); }
    }
    static async securite(req, res) {
        try { return res.json({ success: true, ...(await Suivi.securite()) }); } catch (e) { return erreur(res, e, 'securite'); }
    }
    static async debloquer(req, res) {
        try {
            const type = req.params.type === 'employe' ? 'employe' : 'patron';
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Compte invalide' });
            const ok = await Suivi.debloquer(type, id);
            if (!ok) return res.status(404).json({ success: false, message: 'Compte introuvable' });
            return res.json({ success: true, message: 'Compte débloqué' });
        } catch (e) { return erreur(res, e, 'debloquer'); }
    }
}

export default SuiviAdminController;
