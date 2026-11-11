// controllers/EmplacementController.js
// Emplacements de la boutique, ou d'un entrepôt quand on précise lequel :
//   GET    /api/emplacements-magasin?entrepot=ID
//   POST   /api/emplacements-magasin            { niveau, nom, id_parent, id_entrepot? }
//   PUT    /api/emplacements-magasin/:id        { nom }
//   DELETE /api/emplacements-magasin/:id
import EmplacementMagasin from '../models/EmplacementMagasin.js';
import Entrepot from '../models/Entrepot.js';
import CommandeAchat from '../models/CommandeAchat.js';

// Le caissier consulte seulement ; les autres rôles peuvent ranger le stock
const peutModifier = (req) => !(req.user.type === 'employe' && String(req.user.role || '').toLowerCase() === 'caissier');
const espace = (req) => req.workspaceId || req.user.id;

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const repondreErreur = (res, e, ou) => {
    if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
    console.error(`❌ EmplacementController.${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

// Entrepôt demandé (ou null pour la boutique) ; vérifie que le compte en est membre ou propriétaire
async function entrepotAutorise(req, valeur) {
    if (valeur === undefined || valeur === null || valeur === '' || valeur === 'null') return null;
    const id = parseInt(valeur, 10);
    if (!Number.isInteger(id) || id <= 0) throw fail('Entrepôt invalide', 400);
    const ok = (await Entrepot.isMembre(id, espace(req))) || (await CommandeAchat.estProprietaireEntrepot(id, espace(req)));
    if (!ok) throw fail('Accès refusé à cet entrepôt', 403);
    return id;
}

// Pour modifier/supprimer : la portée vient de l'emplacement lui-même
async function porteeDe(req, id) {
    const e = await EmplacementMagasin.parId(id);
    if (!e) throw fail('Emplacement introuvable', 404);
    if (e.id_entrepot) return entrepotAutorise(req, e.id_entrepot);
    if (e.id_utilisateur !== espace(req)) throw fail('Emplacement introuvable', 404);
    return null;
}

class EmplacementController {
    static async liste(req, res) {
        try {
            const idEntrepot = await entrepotAutorise(req, req.query.entrepot);
            res.json({ success: true, emplacements: await EmplacementMagasin.liste(espace(req), idEntrepot) });
        } catch (e) { repondreErreur(res, e, 'liste'); }
    }

    static async creer(req, res) {
        try {
            if (!peutModifier(req)) return res.status(403).json({ success: false, message: 'Accès réservé' });
            const idEntrepot = await entrepotAutorise(req, req.body?.id_entrepot);
            const e = await EmplacementMagasin.creer(espace(req), req.body || {}, idEntrepot);
            res.status(201).json({ success: true, message: 'Ajouté', emplacement: e });
        } catch (e) { repondreErreur(res, e, 'creer'); }
    }

    static async renommer(req, res) {
        try {
            if (!peutModifier(req)) return res.status(403).json({ success: false, message: 'Accès réservé' });
            const id = Number(req.params.id);
            const idEntrepot = await porteeDe(req, id);
            const e = await EmplacementMagasin.renommer(espace(req), id, req.body?.nom, idEntrepot);
            res.json({ success: true, message: 'Renommé', emplacement: e });
        } catch (e) { repondreErreur(res, e, 'renommer'); }
    }

    static async supprimer(req, res) {
        try {
            if (!peutModifier(req)) return res.status(403).json({ success: false, message: 'Accès réservé' });
            const id = Number(req.params.id);
            const idEntrepot = await porteeDe(req, id);
            await EmplacementMagasin.supprimer(espace(req), id, idEntrepot);
            res.json({ success: true, message: 'Supprimé' });
        } catch (e) { repondreErreur(res, e, 'supprimer'); }
    }
}

export default EmplacementController;
