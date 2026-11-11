// controllers/CompteFournisseurController.js
// Comptes fournisseurs : réservé au patron et aux gérants (rôle manager).
import path from 'path';
import fs from 'fs';
import CompteFournisseur from '../models/CompteFournisseur.js';
import { DOSSIER_JUSTIFICATIFS, typeJustificatif, supprimerJustificatif } from '../middleware/uploadJustificatif.js';

const espace = (req) => req.workspaceId || req.user.id;
const auteur = (req) => ({
    type: req.user?.type === 'employe' ? 'employe' : 'utilisateur',
    id: req.user?.type === 'employe' ? req.user?.id_employe : req.user?.id,
    nom: req.user?.fullname || null,
});

export const accesComptesFournisseurs = (req, res, next) => {
    if (req.user?.type !== 'employe') return next();
    if (String(req.user?.role || '').toLowerCase() === 'manager') return next();
    return res.status(403).json({ success: false, message: 'Réservé au patron et aux gérants' });
};

const erreur = (res, e, ou, fichier) => {
    if (fichier) supprimerJustificatif(fichier);
    if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
    console.error(`❌ CompteFournisseurController.${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

const idParam = (v) => {
    const n = parseInt(v, 10);
    if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Identifiant invalide'), { statusCode: 400 });
    return n;
};

// Fabrique les actions qui enregistrent une opération (avec justificatif éventuel)
const operation = (methode, message) => async (req, res) => {
    const fichier = req.file?.filename || null;
    try {
        const r = await CompteFournisseur[methode](espace(req), idParam(req.params.id), { ...req.body, justificatif: fichier }, auteur(req));
        const texteMessage = r.repartition ? `${message} · ${r.repartition}` : message;
        res.status(201).json({ success: true, ...r, message: texteMessage, compte: await CompteFournisseur.detail(espace(req), idParam(req.params.id)) });
    } catch (e) { erreur(res, e, methode, fichier); }
};

class CompteFournisseurController {
    static async tableau(req, res) {
        try { res.json({ success: true, ...(await CompteFournisseur.tableauDeBord(espace(req))) }); }
        catch (e) { erreur(res, e, 'tableau'); }
    }

    static async creer(req, res) {
        try {
            const id = await CompteFournisseur.creer(espace(req), req.body || {});
            res.status(201).json({ success: true, message: 'Compte créé', compte: await CompteFournisseur.detail(espace(req), id) });
        } catch (e) { erreur(res, e, 'creer'); }
    }

    static async detail(req, res) {
        try { res.json({ success: true, compte: await CompteFournisseur.detail(espace(req), idParam(req.params.id)) }); }
        catch (e) { erreur(res, e, 'detail'); }
    }

    static async modifier(req, res) {
        try {
            await CompteFournisseur.modifier(espace(req), idParam(req.params.id), req.body || {});
            res.json({ success: true, message: 'Compte mis à jour', compte: await CompteFournisseur.detail(espace(req), idParam(req.params.id)) });
        } catch (e) { erreur(res, e, 'modifier'); }
    }

    static async operations(req, res) {
        try { res.json({ success: true, operations: await CompteFournisseur.operations(espace(req), idParam(req.params.id), req.query) }); }
        catch (e) { erreur(res, e, 'operations'); }
    }

    static achat = operation('achat', 'Achat enregistré');
    static versement = operation('versement', 'Versement enregistré');
    static bonus = operation('bonus', 'Bonus enregistré');
    static utiliserBonus = operation('utiliserBonus', 'Utilisation du bonus enregistrée');
    static ajustement = operation('ajustement', 'Ajustement enregistré');
    static plafond = operation('plafond', 'Plafond mis à jour');

    static async annuler(req, res) {
        try {
            const r = await CompteFournisseur.annuler(espace(req), idParam(req.params.idOperation), req.body?.motif, auteur(req));
            res.json({ success: true, message: 'Opération annulée', ...r });
        } catch (e) { erreur(res, e, 'annuler'); }
    }

    static async annulerVersement(req, res) {
        try {
            await CompteFournisseur.annulerVersement(espace(req), idParam(req.params.idPaiement), req.body?.motif, auteur(req));
            res.json({ success: true, message: 'Versement annulé' });
        } catch (e) { erreur(res, e, 'annulerVersement'); }
    }

    static async commandes(req, res) {
        try { res.json({ success: true, ...(await CompteFournisseur.commandes(espace(req), idParam(req.params.id))) }); }
        catch (e) { erreur(res, e, 'commandes'); }
    }

    static async parFournisseur(req, res) {
        try { res.json({ success: true, id_compte: await CompteFournisseur.idPourFournisseur(espace(req), idParam(req.params.idFournisseur)) }); }
        catch (e) { erreur(res, e, 'parFournisseur'); }
    }

    static async justificatif(req, res) {
        try {
            const source = req.params.source === 'versements' ? 'versement' : 'operation';
            const nom = await CompteFournisseur.justificatif(espace(req), source, idParam(req.params.id));
            const chemin = nom && path.join(DOSSIER_JUSTIFICATIFS, path.basename(nom));
            if (!chemin || !fs.existsSync(chemin)) return res.status(404).json({ success: false, message: 'Justificatif introuvable' });
            res.setHeader('Content-Type', typeJustificatif(nom));
            res.setHeader('Cache-Control', 'private, no-store');
            fs.createReadStream(chemin).pipe(res);
        } catch (e) { erreur(res, e, 'justificatif'); }
    }

    static async rapprochements(req, res) {
        try { res.json({ success: true, rapprochements: await CompteFournisseur.rapprochements(espace(req), idParam(req.params.id)) }); }
        catch (e) { erreur(res, e, 'rapprochements'); }
    }

    static async rapprocher(req, res) {
        try {
            const r = await CompteFournisseur.rapprocher(espace(req), idParam(req.params.id), req.body || {}, auteur(req));
            res.status(201).json({ success: true, message: r.statut === 'conforme' ? 'Les soldes sont identiques' : 'Écart constaté', ...r });
        } catch (e) { erreur(res, e, 'rapprocher'); }
    }

    static async resoudre(req, res) {
        try {
            await CompteFournisseur.resoudreRapprochement(espace(req), idParam(req.params.idRappro), req.body?.note);
            res.json({ success: true, message: 'Écart réglé' });
        } catch (e) { erreur(res, e, 'resoudre'); }
    }
}

export default CompteFournisseurController;
