// controllers/RecetteController.js
import Recette from '../models/Recette.js';

const sendError = (res, error, fallback) => {
    if (!error.statusCode) console.error('❌', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

const filtresDe = (q) => ({
    dateDebut: q.dateDebut || undefined,
    dateFin: q.dateFin || undefined,
    modePaiement: q.modePaiement || undefined,
    type: q.type || undefined,          // 'encaissements' | 'remboursements'
    search: q.search || undefined,
});

class RecetteController {
    /* GET /api/recettes?dateDebut&dateFin&modePaiement&type&search
       → { recettes, stats, par_jour, par_mode, top_clients } (chiffres = même filtre que la liste) */
    static async getAllRecettes(req, res) {
        try {
            const filtres = filtresDe(req.query);
            const recettes = await Recette.findAll(req.workspaceId, filtres);
            const resume = Recette.resumer(recettes, filtres);
            res.status(200).json({ success: true, count: recettes.length, data: { recettes, ...resume } });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la récupération des recettes');
        }
    }

    /* POST /api/recettes { id_facture, montant, date_paiement, mode_paiement, reference?, note? } */
    static async createRecette(req, res) {
        try {
            const id = await Recette.create(req.body || {}, req.workspaceId);
            res.status(201).json({
                success: true,
                message: 'Recette enregistrée',
                data: await Recette.findById(id, req.workspaceId),
            });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'enregistrement de la recette");
        }
    }

    /* DELETE /api/recettes/:id (admin, manager) */
    static async deleteRecette(req, res) {
        try {
            await Recette.delete(parseInt(req.params.id, 10) || 0, req.workspaceId);
            res.status(200).json({ success: true, message: 'Recette supprimée, facture mise à jour' });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la suppression de la recette');
        }
    }

    /* GET /api/recettes/stats */
    static async getStats(req, res) {
        try {
            res.status(200).json({ success: true, data: await Recette.getStats(req.workspaceId, filtresDe(req.query)) });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la récupération des statistiques');
        }
    }

    /* GET /api/recettes/factures-impayees */
    static async getFacturesImpayees(req, res) {
        try {
            const factures = await Recette.getFacturesImpayees(req.workspaceId);
            res.status(200).json({ success: true, count: factures.length, data: factures });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la récupération des factures impayées');
        }
    }

    /* GET /api/recettes/export (mêmes filtres que la liste) → CSV lisible par Excel (point-virgule, accents) */
    static async exportRecettes(req, res) {
        try {
            const filtres = filtresDe(req.query);
            const recettes = await Recette.findAll(req.workspaceId, filtres);
            const { stats } = Recette.resumer(recettes, filtres);
            const MODES = { especes: 'Espèces', carte: 'Carte', virement: 'Virement', cheque: 'Chèque', autre: 'Autre' };
            const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const fr = (d) => (d ? d.split('-').reverse().join('/') : '');
            const lignes = [
                [`Recettes du ${fr(filtres.dateDebut) || 'début'} au ${fr(filtres.dateFin) || "aujourd'hui"}`],
                [],
                ['Encaissé', stats.total_encaisse],
                ['Remboursé', stats.total_rembourse],
                ['Net', stats.net],
                [],
                ['Date', 'Type', 'N° facture', 'N° vente', 'Client', 'Téléphone', 'Montant', 'Mode', 'Référence', 'Note'],
                ...recettes.map((r) => [
                    fr(r.date_paiement),
                    r.type === 'remboursement' ? 'Remboursement' : 'Encaissement',
                    r.numero_facture || '',
                    r.numero_commande || (r.vente_supprimee ? 'vente supprimée' : ''),
                    r.nomclient || '',
                    r.telephone || '',
                    r.montant,
                    MODES[r.mode_paiement] || r.mode_paiement,
                    r.reference || '',
                    r.note || '',
                ]),
            ];
            const csv = '﻿' + lignes.map((l) => l.map(cell).join(';')).join('\r\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=recettes_${filtres.dateDebut || ''}_${filtres.dateFin || ''}.csv`);
            res.status(200).send(csv);
        } catch (error) {
            sendError(res, error, "Erreur lors de l'exportation");
        }
    }
}

export default RecetteController;
