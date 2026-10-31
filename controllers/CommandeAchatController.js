// controllers/CommandeAchatController.js
//
// Commandes d'achat : destination 'magasin' (défaut) ou 'entrepot'.
// Seul le PROPRIÉTAIRE d'un entrepôt peut commander pour cet entrepôt.
// `req.workspaceId` = compte (patron) : les employés agissent sous le compte de leur patron.
import CommandeAchat from '../models/CommandeAchat.js';
import Fournisseur from '../models/Fournisseur.js';
import Produit from '../models/Produit.js';
import UniteVente from '../models/UniteVente.js';
import ProduitEntrepot from '../models/ProduitEntrepot.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

class CommandeAchatController {
    /* ============================================================
       HELPERS
       ============================================================ */

    /** Réponse d'erreur homogène : les erreurs métier gardent leur code HTTP */
    static _sendError(res, error, fallbackMessage) {
        console.error('❌', error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({
            success: false,
            message: fallbackMessage || error.message || 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }

    /**
     * Destination demandée (query ou body) -> { destination, id_entrepot }
     * Pour 'entrepot' : l'entrepôt est obligatoire ET le compte doit en être propriétaire.
     */
    static async _resolveScope(source, id_utilisateur) {
        const s = CommandeAchat.scope(source?.destination, source?.id_entrepot);
        if (s.destination === 'entrepot') {
            if (!s.id_entrepot) throw fail("L'entrepôt de livraison est obligatoire");
            if (!(await CommandeAchat.estProprietaireEntrepot(s.id_entrepot, id_utilisateur))) {
                throw fail("Seul le propriétaire de l'entrepôt peut gérer les commandes de cet entrepôt", 403);
            }
        }
        return s;
    }

    /** Prix optionnel : vide OK, sinon strictement positif */
    static _prixValide(prix) {
        if (prix === null || prix === undefined || prix === '') return true;
        const p = parseFloat(prix);
        return !isNaN(p) && p > 0;
    }

    /**
     * Valide les lignes (produit, unité, quantité, prix) selon la destination.
     * Lève une erreur avec statusCode en cas de problème.
     */
    static async _validerLignes(lignes, scope, id_utilisateur) {
        for (const ligne of lignes) {
            let nomProduit;

            if (scope.destination === 'entrepot') {
                // ---------- Produit d'ENTREPÔT (ou produit du magasin à créer à l'entrepôt) ----------
                if (!ligne.id_produit_entrepot && ligne.id_produit) {
                    const produit = await Produit.findById(ligne.id_produit, id_utilisateur);
                    if (!produit) throw fail(`Produit ID ${ligne.id_produit} non trouvé`, 404);
                    nomProduit = produit.nom;
                    if (ligne.id_unite_vente) {
                        const unite = await UniteVente.findById(ligne.id_unite_vente, id_utilisateur);
                        if (!unite) throw fail(`Unité de vente ID ${ligne.id_unite_vente} non trouvée`, 404);
                    }
                    if (!ligne.quantite || parseFloat(ligne.quantite) <= 0) {
                        throw fail(`La quantité pour "${nomProduit}" doit être positive`);
                    }
                    if (!CommandeAchatController._prixValide(ligne.prix_achat)) {
                        throw fail(`Le prix d'achat pour "${nomProduit}" doit être positif ou vide`);
                    }
                    continue;
                }
                if (!ligne.id_produit_entrepot) throw fail("Produit de l'entrepôt manquant sur une ligne");

                const pe = await ProduitEntrepot.findById(ligne.id_produit_entrepot);
                if (!pe || Number(pe.id_entrepot) !== Number(scope.id_entrepot) || !pe.actif) {
                    throw fail(`Produit entrepôt ID ${ligne.id_produit_entrepot} non trouvé dans cet entrepôt`, 404);
                }
                nomProduit = pe.nom;

                if (ligne.id_unite_vente) {
                    const unite = (pe.unites_vente || []).find(
                        (u) => String(u.id_unite_vente) === String(ligne.id_unite_vente)
                    );
                    if (!unite) {
                        throw fail(`Unité de vente ID ${ligne.id_unite_vente} non trouvée pour "${pe.nom}"`, 404);
                    }
                }
            } else {
                // ---------- Produit du MAGASIN ----------
                const produit = await Produit.findById(ligne.id_produit, id_utilisateur);
                if (!produit) throw fail(`Produit ID ${ligne.id_produit} non trouvé`, 404);
                nomProduit = produit.nom;

                if (ligne.id_unite_vente) {
                    const unite = await UniteVente.findById(ligne.id_unite_vente, id_utilisateur);
                    if (!unite) throw fail(`Unité de vente ID ${ligne.id_unite_vente} non trouvée`, 404);
                    if (!unite.actif) throw fail(`L'unité "${unite.nom}" est inactive`);
                }
            }

            if (!ligne.quantite || parseFloat(ligne.quantite) <= 0) {
                throw fail(`La quantité pour "${nomProduit}" doit être positive`);
            }
            if (!CommandeAchatController._prixValide(ligne.prix_achat)) {
                throw fail(`Le prix d'achat pour "${nomProduit}" doit être positif ou vide`);
            }
        }
    }

    /* ============================================================
       GET /commandes-achat/destinations
       Entrepôts pour lesquels le compte peut commander (= propriétaire).
       Liste vide => le front n'affiche aucun choix « Entrepôt ».
       ============================================================ */
    static async getDestinations(req, res) {
        try {
            const entrepots = await CommandeAchat.getEntrepotsProprietaire(req.workspaceId);
            return res.status(200).json({ success: true, count: entrepots.length, data: entrepots });
        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors du chargement des destinations');
        }
    }

    /* ============================================================
       Créer une commande d'achat
       ------------------------------------------------------------
       - Le prix d'achat est OPTIONNEL (renseigné plus tard, à la RÉCEPTION)
       - L'unité de vente peut être NULL (= unité de base)
       - body.destination = 'magasin' (défaut) | 'entrepot' (+ id_entrepot)
       ============================================================ */
    static async create(req, res) {
        try {
            const { id_fournisseur, date_commande, notes, lignes } = req.body;

            if (!id_fournisseur) throw fail('Le fournisseur est obligatoire');
            if (!date_commande) throw fail('La date de commande est obligatoire');
            if (!lignes || lignes.length === 0) throw fail('Au moins un produit est requis');

            const scope = await CommandeAchatController._resolveScope(req.body, req.workspaceId);

            const fournisseur = await Fournisseur.findById(id_fournisseur, req.workspaceId);
            if (!fournisseur) throw fail('Fournisseur non trouvé', 404);
            if (!fournisseur.actif) throw fail('Ce fournisseur est inactif');

            await CommandeAchatController._validerLignes(lignes, scope, req.workspaceId);

            const commande = await CommandeAchat.create({
                id_fournisseur,
                date_commande,
                notes,
                id_utilisateur: req.workspaceId,
                destination: scope.destination,
                id_entrepot: scope.id_entrepot,
                lignes
            });

            return res.status(201).json({
                success: true,
                message: 'Commande créée avec succès',
                data: commande
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la création de la commande');
        }
    }

    /* ============================================================
       Toutes les commandes du workspace (?destination=&id_entrepot=)
       ============================================================ */
    static async getAll(req, res) {
        try {
            const {
                search,
                id_fournisseur,
                statut,
                date_debut,
                date_fin,
                montant_min,
                montant_max,
                page = 1,
                limit = 20
            } = req.query;

            const scope = await CommandeAchatController._resolveScope(req.query, req.workspaceId);

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;

            const filters = {
                search,
                id_fournisseur,
                statut,
                date_debut,
                date_fin,
                montant_min,
                montant_max,
                destination: scope.destination,
                id_entrepot: scope.id_entrepot,
                limit: limitNum,
                offset: (pageNum - 1) * limitNum
            };

            const commandes = await CommandeAchat.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: commandes.length,
                page: pageNum,
                limit: limitNum,
                data: commandes
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la récupération des commandes');
        }
    }

    /* ============================================================
       Une commande par ID
       ============================================================ */
    static async getById(req, res) {
        try {
            const commande = await CommandeAchat.findById(req.params.id, req.workspaceId);

            if (!commande) throw fail('Commande non trouvée', 404);

            return res.status(200).json({ success: true, data: commande });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la récupération de la commande');
        }
    }

    /* ============================================================
       Par statut (?destination=&id_entrepot=)
       ============================================================ */
    static async getByStatut(req, res) {
        try {
            const scope = await CommandeAchatController._resolveScope(req.query, req.workspaceId);
            const commandes = await CommandeAchat.findByStatut(req.params.statut, req.workspaceId, scope);

            return res.status(200).json({ success: true, count: commandes.length, data: commandes });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la récupération des commandes');
        }
    }

    /* ============================================================
       Commandes d'un fournisseur
       ============================================================ */
    static async getByFournisseur(req, res) {
        try {
            const scope = await CommandeAchatController._resolveScope(req.query, req.workspaceId);
            const commandes = await CommandeAchat.findByFournisseur(req.params.id_fournisseur, req.workspaceId, scope);

            return res.status(200).json({ success: true, count: commandes.length, data: commandes });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la récupération des commandes');
        }
    }

    /* ============================================================
       Commandes du mois en cours
       ============================================================ */
    static async getCurrentMonth(req, res) {
        try {
            const scope = await CommandeAchatController._resolveScope(req.query, req.workspaceId);
            const commandes = await CommandeAchat.getCurrentMonth(req.workspaceId, scope);

            return res.status(200).json({ success: true, count: commandes.length, data: commandes });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la récupération des commandes');
        }
    }

    /* ============================================================
       Mettre à jour une commande (la destination ne change pas)
       ============================================================ */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const { date_commande, id_fournisseur, notes, lignes } = req.body;

            const existing = await CommandeAchat.findById(id, req.workspaceId);
            if (!existing) throw fail('Commande non trouvée', 404);

            if (['recue', 'annulee'].includes(existing.statut)) {
                throw fail(`Impossible de modifier une commande ${existing.statut}`);
            }

            // Destination = celle de la commande (jamais celle du body)
            const scope = await CommandeAchatController._resolveScope(
                { destination: existing.destination, id_entrepot: existing.id_entrepot },
                req.workspaceId
            );

            if (id_fournisseur && id_fournisseur !== existing.id_fournisseur) {
                const fournisseur = await Fournisseur.findById(id_fournisseur, req.workspaceId);
                if (!fournisseur) throw fail('Fournisseur non trouvé', 404);
                if (!fournisseur.actif) throw fail('Ce fournisseur est inactif');
            }

            if (lignes) {
                if (lignes.length === 0) throw fail('La commande doit contenir au moins un produit');
                await CommandeAchatController._validerLignes(lignes, scope, req.workspaceId);
            }

            const commande = await CommandeAchat.update(id, {
                date_commande,
                id_fournisseur,
                notes,
                lignes
            }, req.workspaceId);

            return res.status(200).json({
                success: true,
                message: 'Commande mise à jour avec succès',
                data: commande
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la mise à jour de la commande');
        }
    }

    /* ============================================================
       Ajouter des produits à une commande
       ============================================================ */
    static async addLignes(req, res) {
        try {
            const { id } = req.params;
            const { lignes } = req.body;

            if (!lignes || lignes.length === 0) throw fail('Au moins un produit est requis');

            const existing = await CommandeAchat.findById(id, req.workspaceId);
            if (!existing) throw fail('Commande non trouvée', 404);

            const scope = await CommandeAchatController._resolveScope(
                { destination: existing.destination, id_entrepot: existing.id_entrepot },
                req.workspaceId
            );

            await CommandeAchatController._validerLignes(lignes, scope, req.workspaceId);

            const commande = await CommandeAchat.addLignes(id, lignes, req.workspaceId);

            return res.status(200).json({
                success: true,
                message: 'Produits ajoutés à la commande',
                data: commande
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, "Erreur lors de l'ajout des produits");
        }
    }

    /* ============================================================
       Changer le statut
       ============================================================ */
    static async updateStatut(req, res) {
        try {
            const { id } = req.params;
            const { statut } = req.body;

            const statutsValides = ['en_attente', 'envoyee', 'partiellement_recue', 'recue', 'annulee'];
            if (!statutsValides.includes(statut)) throw fail('Statut invalide');

            const commande = await CommandeAchat.findById(id, req.workspaceId);
            if (!commande) throw fail('Commande non trouvée', 404);

            if (commande.statut === 'recue' && statut !== 'recue') {
                throw fail('Une commande reçue ne peut pas changer de statut');
            }
            if (commande.statut === 'annulee' && statut !== 'annulee') {
                throw fail('Une commande annulée ne peut pas changer de statut');
            }

            const updated = await CommandeAchat.updateStatut(id, statut, req.workspaceId);
            if (!updated) throw new Error('Erreur lors de la mise à jour du statut');

            return res.status(200).json({
                success: true,
                message: `Statut mis à jour: ${statut}`,
                data: await CommandeAchat.findById(id, req.workspaceId)
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la mise à jour du statut');
        }
    }

    /* ============================================================
       Annuler
       ============================================================ */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            const peutAnnuler = await CommandeAchat.canAnnuler(id, req.workspaceId);
            if (!peutAnnuler) throw fail('Cette commande ne peut pas être annulée');

            const updated = await CommandeAchat.updateStatut(id, 'annulee', req.workspaceId);
            if (!updated) throw new Error("Erreur lors de l'annulation de la commande");

            return res.status(200).json({
                success: true,
                message: 'Commande annulée avec succès',
                data: await CommandeAchat.findById(id, req.workspaceId)
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, "Erreur lors de l'annulation de la commande");
        }
    }

    /* ============================================================
       Supprimer (seulement si en attente)
       ============================================================ */
    static async delete(req, res) {
        try {
            const deleted = await CommandeAchat.delete(req.params.id, req.workspaceId);

            if (!deleted) throw fail('Commande non trouvée ou ne peut pas être supprimée', 404);

            return res.status(200).json({ success: true, message: 'Commande supprimée avec succès' });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la suppression de la commande');
        }
    }

    /* ============================================================
       Statistiques (?destination=&id_entrepot=)
       ============================================================ */
    static async getStats(req, res) {
        try {
            const scope = await CommandeAchatController._resolveScope(req.query, req.workspaceId);
            const stats = await CommandeAchat.getStats(req.workspaceId, scope);

            return res.status(200).json({ success: true, data: stats });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, 'Erreur lors de la récupération des statistiques');
        }
    }

    /* ============================================================
       Export (?destination=&id_entrepot=)
       ============================================================ */
    static async export(req, res) {
        try {
            const scope = await CommandeAchatController._resolveScope(req.query, req.workspaceId);
            const commandes = await CommandeAchat.findAll(
                { ...req.query, destination: scope.destination, id_entrepot: scope.id_entrepot },
                req.workspaceId
            );

            const exportData = commandes.map(c => ({
                id: c.id_commande_achat,
                numero: c.numero_commande,
                date: c.date_commande,
                fournisseur: c.fournisseur_nom,
                montant: parseFloat(c.montant_total) || 0,
                statut: c.statut,
                notes: c.notes || ''
            }));

            return res.status(200).json({
                success: true,
                count: exportData.length,
                data: exportData
            });

        } catch (error) {
            return CommandeAchatController._sendError(res, error, "Erreur lors de l'export des commandes");
        }
    }
}

export default CommandeAchatController;