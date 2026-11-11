// controllers/TransfertStockController.js
//
// Transferts ENTREPÔT -> catalogue du demandeur, avec approbation du propriétaire.
// `req.workspaceId` = compte (patron) : les employés agissent sous le compte de leur patron.
import TransfertStock from '../models/TransfertStock.js';
import Entrepot from '../models/Entrepot.js';
import CommandeAchat from '../models/CommandeAchat.js';

const STATUTS = ['en_attente', 'valide', 'refuse', 'annule'];

class TransfertStockController {

    /* ---------- helpers ---------- */
    static _parseId(value, label) {
        const id = parseInt(value, 10);
        if (!Number.isInteger(id) || id <= 0) {
            const err = new Error(`${label} invalide`);
            err.statusCode = 400;
            throw err;
        }
        return id;
    }

    static async _checkAccess(id_entrepot, id_utilisateur) {
        // Le propriétaire a toujours accès (même s'il n'a pas de ligne dans membres_entrepot)
        const estMembre = (await Entrepot.isMembre(id_entrepot, id_utilisateur))
            || (await CommandeAchat.estProprietaireEntrepot(id_entrepot, id_utilisateur));
        if (!estMembre) {
            const err = new Error("Accès refusé à cet entrepôt");
            err.statusCode = 403;
            throw err;
        }
    }

    static _statut(req) {
        const s = (req.query.statut || '').trim();
        return STATUTS.includes(s) ? s : null;
    }

    static _sendError(res, error, fallbackMessage = "Erreur serveur") {
        console.error("❌", error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code || undefined,
            });
        }
        return res.status(500).json({
            success: false,
            message: fallbackMessage,
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }

    /* ---------- GET /entrepots/:id_entrepot/transferts?statut= ---------- */
    static async list(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);

            const { est_proprietaire, transferts } = await TransfertStock.getByEntrepot(
                id_entrepot, req.workspaceId, TransfertStockController._statut(req)
            );
            res.json({ success: true, est_proprietaire, count: transferts.length, transferts });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors du chargement des transferts");
        }
    }

    /* ---------- GET /transferts?statut=  (vue centrale, tous mes entrepôts) ---------- */
    static async listMesTransferts(req, res) {
        try {
            const transferts = await TransfertStock.getMesTransferts(
                req.workspaceId, TransfertStockController._statut(req)
            );
            res.json({ success: true, count: transferts.length, transferts });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors du chargement des transferts");
        }
    }

    /* ---------- GET /entrepots/:id_entrepot/transferts/en-attente/count ---------- */
    static async countEnAttente(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);

            const data = await TransfertStock.countEnAttente(id_entrepot, req.workspaceId);
            res.json({ success: true, ...data });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors du comptage");
        }
    }

    /* ---------- GET /entrepots/:id_entrepot/transferts/produits-magasin?q=&id_produit_entrepot= ---------- */
    static async produitsMagasin(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);

            const id_pe = req.query.id_produit_entrepot ? parseInt(req.query.id_produit_entrepot, 10) : null;
            const data = await TransfertStock.getProduitsMagasin(id_entrepot, req.workspaceId, id_pe, req.query.q || '');
            res.json({ success: true, ...data });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors de la recherche des produits");
        }
    }

    /* ---------- POST /entrepots/:id_entrepot/transferts ----------
       { id_produit_entrepot, id_unite_vente?, quantite, mode: 'existant'|'creer',
         id_produit_destination?, forcer?, date_transfert?, motif?, notes? } */
    static async create(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;
            const data = req.body || {};
            await TransfertStockController._checkAccess(id_entrepot, id_utilisateur);

            if (!data.id_produit_entrepot) {
                return res.status(400).json({ success: false, message: "Le produit est requis" });
            }
            if (!(parseFloat(data.quantite) > 0)) {
                return res.status(400).json({ success: false, message: "La quantité doit être supérieure à 0" });
            }

            const result = await TransfertStock.create({
                id_entrepot,
                id_utilisateur,
                id_produit_entrepot: parseInt(data.id_produit_entrepot, 10),
                id_unite_vente_entrepot: data.id_unite_vente ? parseInt(data.id_unite_vente, 10) : null,
                quantite_saisie: data.quantite,
                mode: data.mode,
                id_produit_destination: data.id_produit_destination ? parseInt(data.id_produit_destination, 10) : null,
                forcer: data.forcer === true,
                date_transfert: data.date_transfert || null,
                motif: data.motif || null,
                notes: data.notes || null,
            });

            res.status(201).json({
                success: true,
                message: result.a_valider_par_vous
                    ? "Transfert enregistré : validez-le dans la liste des transferts pour mettre le stock à jour et obtenir le bon"
                    : "Demande envoyée : le propriétaire de l'entrepôt doit l'approuver",
                data: result,
            });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors de la demande de transfert");
        }
    }

    /* ---------- POST /entrepots/:id_entrepot/transferts/lot (panier) ----------
       body : { items: [{ id_produit_entrepot, id_unite_vente?, quantite, forcer? }], date_transfert?, motif?, notes? } */
    static async createLot(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;
            const data = req.body || {};
            await TransfertStockController._checkAccess(id_entrepot, id_utilisateur);

            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) {
                return res.status(400).json({ success: false, message: "Le panier est vide" });
            }
            for (const it of items) {
                if (!it.id_produit_entrepot) {
                    return res.status(400).json({ success: false, message: "Produit manquant dans le panier" });
                }
                if (!(parseFloat(it.quantite) > 0)) {
                    return res.status(400).json({ success: false, message: "Chaque quantité doit être supérieure à 0" });
                }
            }

            const resultats = await TransfertStock.createLot({
                id_entrepot,
                id_utilisateur,
                items: items.map((it) => ({
                    id_produit_entrepot: parseInt(it.id_produit_entrepot, 10),
                    id_unite_vente_entrepot: it.id_unite_vente ? parseInt(it.id_unite_vente, 10) : null,
                    quantite_saisie: it.quantite,
                    forcer: it.forcer === true,
                })),
                date_transfert: data.date_transfert || null,
                motif: data.motif || null,
                notes: data.notes || null,
            });

            const aValider = resultats.length > 0 && resultats.every((r) => r.a_valider_par_vous);
            res.status(201).json({
                success: true,
                message: aValider
                    ? `${resultats.length} transfert(s) enregistré(s) : validez-les dans la liste des transferts pour mettre le stock à jour et obtenir le bon`
                    : `${resultats.length} demande(s) envoyée(s) : le propriétaire de l'entrepôt doit les approuver`,
                data: resultats,
            });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors du transfert groupé");
        }
    }

    /* ---------- PATCH .../transferts/lot/:numero_lot/(approuver|refuser|annuler) : tout le panier ---------- */
    static async _actionLot(req, res, nom, fn, message) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);
            const n = await fn({
                numero_lot: req.params.numero_lot,
                id_entrepot,
                id_utilisateur: req.workspaceId,
                motif: req.body?.motif || null,
            });
            res.json({ success: true, message: message(n), data: { lignes: n } });
        } catch (error) {
            TransfertStockController._sendError(res, error, `Erreur lors de l'opération (${nom})`);
        }
    }

    static approuverLot(req, res) {
        return TransfertStockController._actionLot(req, res, 'approbation', (p) => TransfertStock.approuverLot(p),
            (n) => `${n} transfert(s) approuvé(s) : les stocks ont été mis à jour`);
    }

    static refuserLot(req, res) {
        return TransfertStockController._actionLot(req, res, 'refus', (p) => TransfertStock.refuserLot(p),
            (n) => `${n} transfert(s) refusé(s)`);
    }

    static annulerLot(req, res) {
        return TransfertStockController._actionLot(req, res, 'annulation', (p) => TransfertStock.annulerLot(p),
            (n) => `${n} transfert(s) annulé(s)`);
    }

    /* ---------- PATCH .../transferts/:id_transfert/approuver ---------- */
    static async approuver(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_transfert = TransfertStockController._parseId(req.params.id_transfert, "Demande");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);

            const result = await TransfertStock.approuver({
                id_transfert, id_entrepot, id_utilisateur: req.workspaceId,
            });
            res.json({
                success: true,
                message: "Demande approuvée : les stocks ont été mis à jour",
                data: result,
            });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors de l'approbation");
        }
    }

    /* ---------- PATCH .../transferts/:id_transfert/refuser   { motif? } ---------- */
    static async refuser(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_transfert = TransfertStockController._parseId(req.params.id_transfert, "Demande");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);

            await TransfertStock.refuser({
                id_transfert, id_entrepot, id_utilisateur: req.workspaceId,
                motif: (req.body || {}).motif || null,
            });
            res.json({ success: true, message: "Demande refusée" });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors du refus");
        }
    }

    /* ---------- PATCH .../transferts/:id_transfert/annuler ---------- */
    static async annuler(req, res) {
        try {
            const id_entrepot = TransfertStockController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_transfert = TransfertStockController._parseId(req.params.id_transfert, "Demande");
            await TransfertStockController._checkAccess(id_entrepot, req.workspaceId);

            await TransfertStock.annuler({ id_transfert, id_entrepot, id_utilisateur: req.workspaceId });
            res.json({ success: true, message: "Demande annulée" });
        } catch (error) {
            TransfertStockController._sendError(res, error, "Erreur lors de l'annulation");
        }
    }
}

export default TransfertStockController;