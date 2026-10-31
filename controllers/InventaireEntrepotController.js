// controllers/InventaireEntrepotController.js
// Lecture : propriétaire ou membre actif. Écriture (démarrer, compter, valider, annuler) : propriétaire seulement.
import InventaireEntrepot from '../models/InventaireEntrepot.js';
import Entrepot from '../models/Entrepot.js';
import CommandeAchat from '../models/CommandeAchat.js';

const fail = (message, statusCode) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const entier = (v, msg) => { const n = parseInt(v, 10); if (!n || n < 1) throw fail(msg, 400); return n; };

class InventaireEntrepotController {
    static async _acces(req, ecriture) {
        const id_entrepot = entier(req.params.id_entrepot, 'Entrepôt invalide');
        const proprio = await CommandeAchat.estProprietaireEntrepot(id_entrepot, req.workspaceId);
        if (ecriture) {
            if (!proprio) throw fail("Seul le propriétaire de l'entrepôt peut faire l'inventaire", 403);
        } else if (!proprio && !(await Entrepot.isMembre(id_entrepot, req.workspaceId))) {
            throw fail('Accès refusé à cet entrepôt', 403);
        }
        return { id_entrepot, proprio };
    }

    static _run(ecriture, fallback, fn) {
        return async (req, res) => {
            try {
                const ctx = await InventaireEntrepotController._acces(req, ecriture);
                await fn(req, res, ctx);
            } catch (error) {
                const status = error.statusCode || 500;
                if (status >= 500) console.error('❌ InventaireEntrepot:', error);
                res.status(status).json({ success: false, message: status >= 500 ? fallback : error.message });
            }
        };
    }

    static list = InventaireEntrepotController._run(false, 'Erreur lors du chargement des inventaires', async (req, res, { id_entrepot, proprio }) => {
        const [inventaires, zones] = await Promise.all([
            InventaireEntrepot.list(id_entrepot),
            InventaireEntrepot.zones(id_entrepot),
        ]);
        res.json({ success: true, est_proprietaire: proprio, inventaires, zones });
    });

    static get = InventaireEntrepotController._run(false, "Erreur lors du chargement de l'inventaire", async (req, res, { id_entrepot, proprio }) => {
        const data = await InventaireEntrepot.get(id_entrepot, entier(req.params.id_inventaire, 'Inventaire invalide'));
        res.json({ success: true, est_proprietaire: proprio, ...data });
    });

    static creer = InventaireEntrepotController._run(true, "Erreur lors du démarrage de l'inventaire", async (req, res, { id_entrepot }) => {
        const r = await InventaireEntrepot.creer(id_entrepot, req.workspaceId, req.body || {});
        res.status(201).json({ success: true, message: `Inventaire ${r.reference} démarré`, ...r });
    });

    static compter = InventaireEntrepotController._run(true, 'Erreur lors de l\'enregistrement du comptage', async (req, res, { id_entrepot }) => {
        const r = await InventaireEntrepot.compter(
            id_entrepot,
            entier(req.params.id_inventaire, 'Inventaire invalide'),
            entier(req.params.id_ligne, 'Ligne invalide'),
            { quantite_base: req.body?.quantite_base, conforme: req.body?.conforme === true, notes: req.body?.notes }
        );
        res.json({ success: true, ...r });
    });

    static annulerComptage = InventaireEntrepotController._run(true, 'Erreur lors de la modification du comptage', async (req, res, { id_entrepot }) => {
        await InventaireEntrepot.annulerComptage(id_entrepot, entier(req.params.id_inventaire, 'Inventaire invalide'), entier(req.params.id_ligne, 'Ligne invalide'));
        res.json({ success: true });
    });

    static toutConforme = InventaireEntrepotController._run(true, 'Erreur lors de la mise à jour', async (req, res, { id_entrepot }) => {
        const n = await InventaireEntrepot.toutConforme(id_entrepot, entier(req.params.id_inventaire, 'Inventaire invalide'));
        res.json({ success: true, message: `${n} produit(s) marqué(s) conformes`, modifies: n });
    });

    static valider = InventaireEntrepotController._run(true, "Erreur lors de la validation de l'inventaire", async (req, res, { id_entrepot }) => {
        const r = await InventaireEntrepot.valider(id_entrepot, entier(req.params.id_inventaire, 'Inventaire invalide'), req.workspaceId);
        res.json({ success: true, message: r.corriges ? `Inventaire terminé : ${r.corriges} produit(s) corrigé(s)` : 'Inventaire terminé : aucun écart', ...r });
    });

    static annuler = InventaireEntrepotController._run(true, "Erreur lors de l'annulation", async (req, res, { id_entrepot }) => {
        await InventaireEntrepot.annuler(id_entrepot, entier(req.params.id_inventaire, 'Inventaire invalide'));
        res.json({ success: true, message: 'Inventaire annulé' });
    });
}

export default InventaireEntrepotController;