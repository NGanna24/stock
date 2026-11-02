// controllers/DepenseController.js
import Depense, { CategorieDepense } from '../models/Depense.js';

const sendError = (res, error, fallback) => {
    console.error('❌', error);
    if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

const filtres = (q) => ({
    dateDebut: q.dateDebut,
    dateFin: q.dateFin,
    id_categorie: q.id_categorie,
    mode_paiement: q.mode_paiement,
    search: q.search,
});

/**
 * Période de comparaison, juste avant [debut, fin] :
 *   - mois entiers (du 1er au dernier jour) -> les mêmes nombre de mois juste avant
 *     (octobre -> septembre, T4 -> T3, année -> année précédente)
 *   - sinon -> même nombre de jours juste avant
 */
const periodePrecedente = (debut, fin) => {
    if (!debut || !fin) return null;
    const d = new Date(`${String(debut).slice(0, 10)}T00:00:00Z`);
    const f = new Date(`${String(fin).slice(0, 10)}T00:00:00Z`);
    if (isNaN(d) || isNaN(f) || f < d) return null;

    const lendemainFin = new Date(f.getTime() + 86400000);
    if (d.getUTCDate() === 1 && lendemainFin.getUTCDate() === 1) {
        const nbMois = (lendemainFin.getUTCFullYear() - d.getUTCFullYear()) * 12
            + (lendemainFin.getUTCMonth() - d.getUTCMonth());
        const debutPrec = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - nbMois, 1));
        const finPrec = new Date(d.getTime() - 86400000);
        return { dateDebut: debutPrec.toISOString().slice(0, 10), dateFin: finPrec.toISOString().slice(0, 10) };
    }

    const jours = Math.round((f - d) / 86400000) + 1;
    const finPrec = new Date(d.getTime() - 86400000);
    const debutPrec = new Date(finPrec.getTime() - (jours - 1) * 86400000);
    return { dateDebut: debutPrec.toISOString().slice(0, 10), dateFin: finPrec.toISOString().slice(0, 10) };
};

class DepenseController {
    /* GET /api/depenses?dateDebut&dateFin&id_categorie&mode_paiement&search */
    static async list(req, res) {
        try {
            const f = filtres(req.query);
            const prec = periodePrecedente(f.dateDebut, f.dateFin);
            const [depenses, stats, statsPrec] = await Promise.all([
                Depense.findAll(req.workspaceId, f),
                Depense.getStats(req.workspaceId, f),
                prec ? Depense.getStats(req.workspaceId, { ...f, ...prec }) : null,
            ]);
            res.json({
                success: true,
                count: depenses.length,
                data: {
                    depenses,
                    stats,
                    periode_precedente: prec ? { ...prec, total: statsPrec.total, nombre: statsPrec.nombre } : null,
                },
            });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement des dépenses');
        }
    }

    /* GET /api/depenses/:id */
    static async getById(req, res) {
        try {
            const d = await Depense.findById(parseInt(req.params.id, 10) || 0, req.workspaceId);
            if (!d) return res.status(404).json({ success: false, message: 'Dépense introuvable' });
            res.json({ success: true, data: d });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement de la dépense');
        }
    }

    /* POST /api/depenses */
    static async create(req, res) {
        try {
            const d = await Depense.create(req.body || {}, req.workspaceId);
            res.status(201).json({ success: true, message: 'Dépense enregistrée', data: d });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'enregistrement de la dépense");
        }
    }

    /* POST /api/depenses/lot   { depenses: [...] }  (reprise des dépenses fixes) */
    static async createLot(req, res) {
        try {
            const ids = await Depense.createMany(req.body?.depenses, req.workspaceId);
            res.status(201).json({
                success: true,
                message: `${ids.length} dépense(s) enregistrée(s)`,
                data: { ids },
            });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'enregistrement des dépenses");
        }
    }

    /* PUT /api/depenses/:id */
    static async update(req, res) {
        try {
            const d = await Depense.update(parseInt(req.params.id, 10) || 0, req.body || {}, req.workspaceId);
            res.json({ success: true, message: 'Dépense modifiée', data: d });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la modification de la dépense');
        }
    }

    /* DELETE /api/depenses/:id   (admin uniquement) */
    static async remove(req, res) {
        try {
            await Depense.delete(parseInt(req.params.id, 10) || 0, req.workspaceId);
            res.json({ success: true, message: 'Dépense supprimée' });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la suppression de la dépense');
        }
    }

    /* GET /api/depenses/reprise?mois=YYYY-MM  → dépenses du mois précédent */
    static async reprise(req, res) {
        try {
            const data = await Depense.getMoisPrecedent(req.workspaceId, req.query.mois);
            res.json({ success: true, data });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement des dépenses du mois précédent');
        }
    }

    /* ---------- Catégories ---------- */

    /* GET /api/depenses/categories  (crée les catégories par défaut au premier accès) */
    static async listCategories(req, res) {
        try {
            await CategorieDepense.initialiserSiVide(req.workspaceId);
            const categories = await CategorieDepense.findAll(req.workspaceId);
            res.json({ success: true, data: categories });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement des catégories');
        }
    }

    /* POST /api/depenses/categories   (admin) */
    static async createCategorie(req, res) {
        try {
            const id = await CategorieDepense.create(req.body || {}, req.workspaceId);
            res.status(201).json({ success: true, message: 'Catégorie créée', data: { id_categorie_depense: id } });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la création de la catégorie');
        }
    }

    /* PUT /api/depenses/categories/:id   (admin) { nom?, description?, actif? } */
    static async updateCategorie(req, res) {
        try {
            await CategorieDepense.update(parseInt(req.params.id, 10) || 0, req.body || {}, req.workspaceId);
            res.json({ success: true, message: 'Catégorie modifiée' });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la modification de la catégorie');
        }
    }
}

export default DepenseController;
