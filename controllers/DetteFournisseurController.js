// controllers/DetteFournisseurController.js
import DetteFournisseur from '../models/DetteFournisseur.js';

const sendError = (res, error, fallback) => {
    console.error('❌', error);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return res.status(500).json({
        success: false,
        message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

const auteur = (req) => ({
    type: req.user?.type === 'employe' ? 'employe' : 'utilisateur',
    id: req.user?.type === 'employe' ? req.user?.id_employe : req.user?.id,
    nom: req.user?.fullname || null,
});

class DetteFournisseurController {
    /* GET /api/dettes-fournisseurs */
    static async liste(req, res) {
        try {
            res.json({ success: true, data: await DetteFournisseur.liste(req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement des dettes fournisseurs');
        }
    }

    /* GET /api/dettes-fournisseurs/fournisseurs/:id */
    static async detail(req, res) {
        try {
            res.json({ success: true, data: await DetteFournisseur.detail(parseInt(req.params.id, 10) || 0, req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du chargement du fournisseur');
        }
    }

    /* POST /api/dettes-fournisseurs/paiements
       { id_fournisseur, id_commande_achat?, montant, date_paiement?, mode_paiement?, reference?, note? } */
    static async payer(req, res) {
        try {
            const b = req.body || {};
            const id_fournisseur = parseInt(b.id_fournisseur, 10);
            if (!id_fournisseur) return res.status(400).json({ success: false, message: 'Le fournisseur est requis' });
            const result = await DetteFournisseur.payer({
                id_utilisateur: req.workspaceId,
                id_fournisseur,
                id_commande_achat: b.id_commande_achat ? parseInt(b.id_commande_achat, 10) : null,
                montant: b.montant,
                date_paiement: b.date_paiement,
                mode_paiement: b.mode_paiement,
                reference: b.reference,
                note: b.note,
                par: auteur(req),
            });
            const nbCmd = result.affectations.filter((a) => a.id_commande_achat).length;
            const avance = result.affectations.find((a) => !a.id_commande_achat);
            let message = 'Paiement enregistré';
            if (nbCmd > 1) message += ` et réparti sur ${nbCmd} commandes`;
            if (avance) message += `${nbCmd ? ',' : ' :'} ${Math.round(avance.montant)} FCFA gardés en avance`;
            res.status(201).json({ success: true, message, data: result });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'enregistrement du paiement");
        }
    }

    /* POST /api/dettes-fournisseurs/paiements/:id/annuler  { motif } — on n'efface jamais un versement */
    static async annuler(req, res) {
        try {
            await DetteFournisseur.annulerPaiement(parseInt(req.params.id, 10) || 0, req.workspaceId, req.body?.motif, auteur(req));
            res.json({ success: true, message: 'Versement annulé' });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'annulation du paiement");
        }
    }

    /* DELETE /api/dettes-fournisseurs/paiements/:id — anciennes versions : devient une annulation */
    static async supprimer(req, res) {
        try {
            await DetteFournisseur.annulerPaiement(parseInt(req.params.id, 10) || 0, req.workspaceId, 'Supprimé depuis une ancienne version', auteur(req));
            res.json({ success: true, message: 'Paiement annulé' });
        } catch (error) {
            sendError(res, error, "Erreur lors de l'annulation du paiement");
        }
    }
}

export default DetteFournisseurController;
