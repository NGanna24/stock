// controllers/ReglagesDocumentsController.js — /api/documents-reglages
// Lecture : tous les comptes du magasin (pour imprimer). Modification : le patron.
import ReglagesDocuments, { supprimerImage } from '../models/ReglagesDocuments.js';

const espace = (req) => req.workspaceId || req.user.id;

export const reservePatron = (req, res, next) => {
    if (req.user?.type === 'employe') {
        if (req.file) supprimerImage(req.file.filename);
        return res.status(403).json({ success: false, message: 'Réservé au patron' });
    }
    return next();
};

const erreur = (res, e, ou, fichier) => {
    if (fichier) supprimerImage(fichier);
    if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
    console.error(`❌ ReglagesDocumentsController.${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

const repondre = async (req, res, message, status = 200) =>
    res.status(status).json({ success: true, message, ...(await ReglagesDocuments.lire(espace(req))) });

class ReglagesDocumentsController {
    static async lire(req, res) {
        try { res.json({ success: true, ...(await ReglagesDocuments.lire(espace(req))) }); }
        catch (e) { erreur(res, e, 'lire'); }
    }

    static async ajouterCachet(req, res) {
        const fichier = req.file?.filename;
        try {
            if (!fichier) return res.status(400).json({ success: false, message: "Choisissez l'image du cachet" });
            await ReglagesDocuments.ajouterCachet(espace(req), req.body?.nom, fichier);
            await repondre(req, res, 'Cachet ajouté', 201);
        } catch (e) { erreur(res, e, 'ajouterCachet', fichier); }
    }

    static async modifierCachet(req, res) {
        const fichier = req.file?.filename;
        try {
            await ReglagesDocuments.modifierCachet(espace(req), parseInt(req.params.id, 10) || 0, req.body || {}, fichier);
            await repondre(req, res, 'Cachet modifié');
        } catch (e) { erreur(res, e, 'modifierCachet', fichier); }
    }

    static async supprimerCachet(req, res) {
        try {
            await ReglagesDocuments.supprimerCachet(espace(req), parseInt(req.params.id, 10) || 0);
            await repondre(req, res, 'Cachet supprimé');
        } catch (e) { erreur(res, e, 'supprimerCachet'); }
    }

    static async definirSignature(req, res) {
        const fichier = req.file?.filename;
        try {
            if (!fichier) return res.status(400).json({ success: false, message: "Choisissez l'image de la signature" });
            await ReglagesDocuments.definirSignature(espace(req), fichier);
            await repondre(req, res, 'Signature enregistrée');
        } catch (e) { erreur(res, e, 'definirSignature', fichier); }
    }

    static async supprimerSignature(req, res) {
        try {
            await ReglagesDocuments.definirSignature(espace(req), null);
            await repondre(req, res, 'Signature retirée');
        } catch (e) { erreur(res, e, 'supprimerSignature'); }
    }

    static async enregistrer(req, res) {
        try {
            await ReglagesDocuments.enregistrerReglages(espace(req), req.body || {});
            await repondre(req, res, 'Réglages enregistrés');
        } catch (e) { erreur(res, e, 'enregistrer'); }
    }
}

export default ReglagesDocumentsController;
