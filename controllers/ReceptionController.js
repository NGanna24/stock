// controllers/ReceptionController.js
//
// Réceptions : la destination (magasin / entrepôt) est celle de la commande.
// Seul le PROPRIÉTAIRE d'un entrepôt peut réceptionner dans cet entrepôt.
// `req.workspaceId` = compte (patron) : les employés agissent sous le compte de leur patron.
import Reception from '../models/Reception.js';
import CommandeAchat from '../models/CommandeAchat.js';
import Produit from '../models/Produit.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

class ReceptionController {
    /* ============================================================
       HELPERS
       ============================================================ */

    /** Réponse d'erreur : code HTTP explicite, sinon détection des erreurs métier */
    static _sendError(res, error, fallbackMessage) {
        console.error('❌', error);

        let status = error.statusCode;
        if (!status) {
            const msg = error.message || '';
            const isBusinessError = [
                'non trouvé', 'obligatoire', 'positive', 'déjà été', 'annulée',
                'existe déjà', 'requis', 'Impossible de supprimer'
            ].some((m) => msg.includes(m));
            status = isBusinessError ? 400 : 500;
        }

        return res.status(status).json({
            success: false,
            message: status === 500 && fallbackMessage ? fallbackMessage : (error.message || fallbackMessage),
            error: status === 500 && process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }

    /**
     * Destination demandée (query) -> { destination, id_entrepot }
     * Pour 'entrepot' : le compte doit être propriétaire de l'entrepôt.
     */
    static async _resolveScope(source, id_utilisateur) {
        const s = CommandeAchat.scope(source?.destination, source?.id_entrepot);
        if (s.destination === 'entrepot') {
            if (!s.id_entrepot) throw fail("L'entrepôt est obligatoire");
            if (!(await CommandeAchat.estProprietaireEntrepot(s.id_entrepot, id_utilisateur))) {
                throw fail("Seul le propriétaire de l'entrepôt peut gérer les réceptions de cet entrepôt", 403);
            }
        }
        return s;
    }

    /* ============================================================
       Créer une réception
         - ACCEPTE les réceptions partielles
         - ACCEPTE les surplus
       ============================================================ */
    static async create(req, res) {
        try {
            const { id_commande_achat, date_reception, notes, lignes } = req.body;

            // 1. Validations de base
            if (!date_reception) throw fail('La date de réception est obligatoire');
            if (!lignes || lignes.length === 0) throw fail('Au moins un produit est requis');

            // 2. Commande -> destination
            let scope;
            if (id_commande_achat) {
                const commande = await CommandeAchat.findById(id_commande_achat, req.workspaceId);
                if (!commande) throw fail('Commande non trouvée', 404);
                if (commande.statut === 'recue') throw fail('Cette commande a déjà été entièrement reçue');
                if (commande.statut === 'annulee') throw fail('Cette commande est annulée, impossible de la recevoir');

                scope = await ReceptionController._resolveScope(
                    { destination: commande.destination, id_entrepot: commande.id_entrepot },
                    req.workspaceId
                );
            } else {
                scope = await ReceptionController._resolveScope(req.body, req.workspaceId);
            }

            // 3. Lignes (l'existence des produits d'entrepôt est vérifiée dans le modèle, sous transaction)
            for (const ligne of lignes) {
                if (!ligne.quantite_recue || parseFloat(ligne.quantite_recue) <= 0) {
                    throw fail('La quantité reçue doit être positive');
                }
                if (scope.destination === 'magasin') {
                    const produit = await Produit.findById(ligne.id_produit, req.workspaceId);
                    if (!produit) throw fail(`Produit ID ${ligne.id_produit} non trouvé`, 404);
                }
            }

            // 4. Création
            const reception = await Reception.create({
                id_commande_achat,
                date_reception,
                notes,
                id_utilisateur: req.workspaceId,
                destination: scope.destination,
                id_entrepot: scope.id_entrepot,
                lignes
            });

            return res.status(201).json({
                success: true,
                message: 'Réception créée avec succès',
                data: reception
            });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la création de la réception');
        }
    }

    /* ============================================================
       Toutes les réceptions (?destination=&id_entrepot=)
       ============================================================ */
    static async getAll(req, res) {
        try {
            const {
                search,
                id_commande_achat,
                statut,
                date_debut,
                date_fin,
                page = 1,
                limit = 20
            } = req.query;

            const scope = await ReceptionController._resolveScope(req.query, req.workspaceId);

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;

            const filters = {
                search,
                id_commande_achat,
                statut,
                date_debut,
                date_fin,
                destination: scope.destination,
                id_entrepot: scope.id_entrepot,
                limit: limitNum,
                offset: (pageNum - 1) * limitNum
            };

            const receptions = await Reception.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: receptions.length,
                page: pageNum,
                limit: limitNum,
                data: receptions
            });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la récupération des réceptions');
        }
    }

    /* ============================================================
       Une réception par ID
       ============================================================ */
    static async getById(req, res) {
        try {
            const reception = await Reception.findById(req.params.id, req.workspaceId);

            if (!reception) throw fail('Réception non trouvée', 404);

            return res.status(200).json({ success: true, data: reception });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la récupération de la réception');
        }
    }

    /* ============================================================
       Par statut (?destination=&id_entrepot=)
       ============================================================ */
    static async getByStatut(req, res) {
        try {
            const { statut } = req.params;

            const statutsValides = ['en_attente', 'partielle', 'complete', 'annulee'];
            if (!statutsValides.includes(statut)) throw fail('Statut invalide');

            const scope = await ReceptionController._resolveScope(req.query, req.workspaceId);
            const receptions = await Reception.findByStatut(statut, req.workspaceId, scope);

            return res.status(200).json({ success: true, count: receptions.length, data: receptions });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la récupération des réceptions');
        }
    }

    /* ============================================================
       Réceptions d'une commande
       ============================================================ */
    static async getByCommande(req, res) {
        try {
            const receptions = await Reception.findByCommande(req.params.id_commande, req.workspaceId);

            return res.status(200).json({ success: true, count: receptions.length, data: receptions });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la récupération des réceptions');
        }
    }

    /* ============================================================
       Statistiques (?destination=&id_entrepot=)
       ============================================================ */
    static async getStats(req, res) {
        try {
            const scope = await ReceptionController._resolveScope(req.query, req.workspaceId);
            const stats = await Reception.getStats(req.workspaceId, scope);

            return res.status(200).json({ success: true, data: stats });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la récupération des statistiques');
        }
    }

    /* ============================================================
       Changer le statut d'une réception
       ============================================================ */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'partielle', 'complete', 'annulee'];
            if (!statutsValides.includes(statut)) throw fail('Statut invalide');

            const reception = await Reception.findById(id, req.workspaceId);
            if (!reception) throw fail('Réception non trouvée', 404);

            const updated = await Reception.updateStatut(id, statut, req.workspaceId);
            if (!updated) throw new Error('Erreur lors de la mise à jour du statut');

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await Reception.findById(id, req.workspaceId)
            });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la mise à jour du statut');
        }
    }

    /* ============================================================
       Supprimer une réception
       ============================================================ */
    static async delete(req, res) {
        try {
            const deleted = await Reception.delete(req.params.id, req.workspaceId);

            if (!deleted) throw fail('Réception non trouvée ou ne peut pas être supprimée', 404);

            return res.status(200).json({ success: true, message: 'Réception supprimée avec succès' });

        } catch (error) {
            return ReceptionController._sendError(res, error, 'Erreur lors de la suppression de la réception');
        }
    }

    /* ============================================================
       Export (?destination=&id_entrepot=)
       ============================================================ */
    static async export(req, res) {
        try {
            const scope = await ReceptionController._resolveScope(req.query, req.workspaceId);
            const receptions = await Reception.findAll(
                { ...req.query, destination: scope.destination, id_entrepot: scope.id_entrepot },
                req.workspaceId
            );

            const exportData = receptions.map(r => ({
                id: r.id_reception,
                numero: r.numero_reception,
                date: r.date_reception,
                fournisseur: r.fournisseur_nom || '-',
                commande: r.numero_commande || '-',
                montant: parseFloat(r.montant_total) || 0,
                statut: r.statut,
                notes: r.notes || ''
            }));

            return res.status(200).json({
                success: true,
                count: exportData.length,
                data: exportData
            });

        } catch (error) {
            return ReceptionController._sendError(res, error, "Erreur lors de l'export des réceptions");
        }
    }
}

export default ReceptionController;