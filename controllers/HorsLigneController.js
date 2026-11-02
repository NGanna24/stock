// controllers/HorsLigneController.js
import HorsLigne from '../models/HorsLigne.js';

const sendError = (res, error, fallback) => {
    console.error('❌', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

/** Vendeur (pour un employé, req.user.id contient l'id du patron : on prend id_employe) */
const vendeur = (req) => ({
    type: req.user?.type === 'employe' ? 'employe' : 'utilisateur',
    id: req.user?.type === 'employe' ? req.user?.id_employe : req.user?.id,
    nom: req.user?.fullname || null,
});

class HorsLigneController {
    /* GET /api/hors-ligne/catalogue */
    static async catalogue(req, res) {
        try {
            res.json({ success: true, data: await HorsLigne.catalogue(req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la préparation du mode hors ligne');
        }
    }

    /*
     * POST /api/hors-ligne/ventes  { ventes: [ { id_local, numero_provisoire, date_vente, nomclient,
     *   telephone, lignes: [...], paiements: [{ montant, mode_paiement, date }] } ] }
     * Chaque vente est traitée séparément : une vente refusée n'empêche pas les autres.
     */
    static async synchroniser(req, res) {
        const ventes = Array.isArray(req.body?.ventes) ? req.body.ventes : [];
        if (!ventes.length) return res.status(400).json({ success: false, message: 'Aucune vente à envoyer' });
        if (ventes.length > 50) return res.status(400).json({ success: false, message: 'Maximum 50 ventes par envoi' });

        const resultats = [];
        for (const v of ventes) {
            try {
                resultats.push(await HorsLigne.synchroniser(req.workspaceId, v, vendeur(req)));
            } catch (error) {
                if (!error.statusCode) console.error('❌ Synchro vente hors ligne :', error);
                resultats.push({
                    id_local: v?.id_local || null,
                    statut: error.statusCode ? 'rejetee' : 'erreur',
                    message: error.statusCode ? error.message : 'Erreur du serveur, nouvel essai plus tard',
                });
            }
        }
        const nb = (s) => resultats.filter((r) => r.statut === s).length;
        res.json({
            success: true,
            message: `${nb('synchronisee') + nb('deja_recue')} vente(s) enregistrée(s)`,
            data: { resultats },
        });
    }

    /* GET /api/hors-ligne/historique */
    static async historique(req, res) {
        try {
            res.json({ success: true, data: await HorsLigne.historique(req.workspaceId, req.query.limit) });
        } catch (error) {
            sendError(res, error, "Erreur lors du chargement de l'historique");
        }
    }
}

export default HorsLigneController;
