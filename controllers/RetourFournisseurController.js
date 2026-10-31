// controllers/RetourFournisseurController.js
//
// Retours fournisseurs (magasin ou entrepôt : ?destination=&id_entrepot=).
// Pour un entrepôt, seul le PROPRIÉTAIRE peut créer / lister / gérer les retours.
// `req.workspaceId` = compte (patron) : les employés agissent sous le compte de leur patron.
import RetourFournisseur from '../models/RetourFournisseur.js';
import CommandeAchat from '../models/CommandeAchat.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

const STATUTS = ['en_attente', 'envoye', 'recu_par_fournisseur', 'traite', 'annule'];

class RetourFournisseurController {
    static _sendError(res, error, fallbackMessage) {
        console.error('❌', error);
        let status = error.statusCode;
        if (!status) {
            const msg = error.message || '';
            const metier = ['non trouvé', 'obligatoire', 'positive', 'Impossible', 'insuffisant', 'trop élevée',
                'Aucune quantité', 'déjà', 'invalide', 'traité', 'requis', 'inactif']
                .some((m) => msg.includes(m));
            status = metier ? 400 : 500;
        }
        return res.status(status).json({
            success: false,
            message: status === 500 && fallbackMessage ? fallbackMessage : (error.message || fallbackMessage)
        });
    }

    /** Destination demandée -> { destination, id_entrepot } ; entrepôt = propriétaire obligatoire */
    static async _resolveScope(source, id_utilisateur) {
        const s = RetourFournisseur.scope(source?.destination, source?.id_entrepot);
        if (s.destination === 'entrepot') {
            if (!s.id_entrepot) throw fail("L'entrepôt est obligatoire");
            if (!(await CommandeAchat.estProprietaireEntrepot(s.id_entrepot, id_utilisateur))) {
                throw fail("Seul le propriétaire de l'entrepôt peut gérer les retours de cet entrepôt", 403);
            }
        }
        return s;
    }

    /** Charge un retour du compte ; s'il vient d'un entrepôt, vérifie que le compte en est propriétaire */
    static async _charger(id, id_utilisateur) {
        const retour = await RetourFournisseur.findById(id, id_utilisateur);
        if (!retour) throw fail('Retour non trouvé', 404);
        if (retour.destination === 'entrepot'
            && !(await CommandeAchat.estProprietaireEntrepot(retour.id_entrepot, id_utilisateur))) {
            throw fail("Seul le propriétaire de l'entrepôt peut gérer les retours de cet entrepôt", 403);
        }
        return retour;
    }

    static async create(req, res) {
        try {
            const scope = await RetourFournisseurController._resolveScope(req.body, req.workspaceId);
            const retour = await RetourFournisseur.create({
                ...req.body,
                id_utilisateur: req.workspaceId,
                destination: scope.destination,
                id_entrepot: scope.id_entrepot
            });
            return res.status(201).json({ success: true, message: 'Retour créé avec succès', data: retour });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la création du retour');
        }
    }

    static async getAll(req, res) {
        try {
            const scope = await RetourFournisseurController._resolveScope(req.query, req.workspaceId);
            const { page = 1, limit = 200, ...autres } = req.query;
            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 200;
            const retours = await RetourFournisseur.findAll({
                ...autres,
                destination: scope.destination,
                id_entrepot: scope.id_entrepot,
                limit: limitNum,
                offset: (pageNum - 1) * limitNum
            }, req.workspaceId);
            return res.status(200).json({ success: true, count: retours.length, data: retours });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la récupération des retours');
        }
    }

    static async getById(req, res) {
        try {
            const retour = await RetourFournisseurController._charger(req.params.id, req.workspaceId);
            return res.status(200).json({ success: true, data: retour });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la récupération du retour');
        }
    }

    static async getByStatut(req, res) {
        try {
            const { statut } = req.params;
            if (!STATUTS.includes(statut)) throw fail('Statut invalide');
            const scope = await RetourFournisseurController._resolveScope(req.query, req.workspaceId);
            const retours = await RetourFournisseur.findByStatut(statut, req.workspaceId, scope);
            return res.status(200).json({ success: true, count: retours.length, data: retours });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la récupération des retours');
        }
    }

    static async getByFournisseur(req, res) {
        try {
            const scope = await RetourFournisseurController._resolveScope(req.query, req.workspaceId);
            const retours = await RetourFournisseur.findByFournisseur(req.params.id_fournisseur, req.workspaceId, scope);
            return res.status(200).json({ success: true, count: retours.length, data: retours });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la récupération des retours');
        }
    }

    /** Produits retournables à un fournisseur pour un entrepôt (même forme que /fournisseurs/:id/produits-recu) */
    static async getProduitsRecus(req, res) {
        try {
            const scope = await RetourFournisseurController._resolveScope(req.query, req.workspaceId);
            if (scope.destination !== 'entrepot') throw fail("Utilisez la route des fournisseurs pour le magasin");
            const data = await RetourFournisseur.getProduitsRecusEntrepot(req.params.id_fournisseur, scope.id_entrepot);
            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la récupération des produits');
        }
    }

    static async getStats(req, res) {
        try {
            const scope = await RetourFournisseurController._resolveScope(req.query, req.workspaceId);
            const stats = await RetourFournisseur.getStats(req.workspaceId, scope);
            return res.status(200).json({ success: true, data: stats });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la récupération des statistiques');
        }
    }

    static async updateStatut(req, res) {
        try {
            const { statut } = req.body;
            if (!STATUTS.includes(statut)) throw fail('Statut invalide');
            await RetourFournisseurController._charger(req.params.id, req.workspaceId);
            const ok = await RetourFournisseur.updateStatut(req.params.id, statut, req.workspaceId);
            if (!ok) throw fail('Retour non trouvé ou déjà annulé', 404);
            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await RetourFournisseur.findById(req.params.id, req.workspaceId)
            });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la mise à jour du statut');
        }
    }

    static async annuler(req, res) {
        try {
            await RetourFournisseur.annuler(req.params.id, req.workspaceId);
            return res.status(200).json({ success: true, message: 'Retour annulé, stock réintégré' });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, "Erreur lors de l'annulation du retour");
        }
    }

    static async delete(req, res) {
        try {
            const ok = await RetourFournisseur.delete(req.params.id, req.workspaceId);
            if (!ok) throw fail('Retour non trouvé', 404);
            return res.status(200).json({ success: true, message: 'Retour supprimé' });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, 'Erreur lors de la suppression du retour');
        }
    }

    static async export(req, res) {
        try {
            const scope = await RetourFournisseurController._resolveScope(req.query, req.workspaceId);
            const retours = await RetourFournisseur.findAll(
                { destination: scope.destination, id_entrepot: scope.id_entrepot }, req.workspaceId
            );
            const data = retours.map((r) => ({
                id: r.id_retour,
                numero: r.numero_retour,
                date: r.date_retour,
                fournisseur: r.fournisseur_nom || '-',
                motif: r.motif_retour,
                montant: parseFloat(r.montant_total) || 0,
                statut: r.statut
            }));
            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error) {
            return RetourFournisseurController._sendError(res, error, "Erreur lors de l'export des retours");
        }
    }
}

export default RetourFournisseurController;