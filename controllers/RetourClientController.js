// controllers/RetourClientController.js
import RetourClient from '../models/RetourClient.js';
import { pool } from '../config/db.js';
import { permissionsDe, peut, reglagesRole } from '../utils/permissions.js';
import { notifierRetourAValider, notifierDecisionRetour } from '../Services/notificationsPush.js';

// Valider un retour fait bouger le stock et sortir de l'argent : patron, ou rôle qu'il a autorisé
const DROIT_VALIDER = 'retours.valider';

/** Employés (actifs) à qui le patron a donné le droit de valider les retours */
async function idsValideurs(id_utilisateur) {
    try {
        const [emps] = await pool.query(
            `SELECT e.id_employe, r.nom AS role, e.role_personnalise
               FROM employes e LEFT JOIN roles r ON r.id_role = e.id_role
              WHERE e.id_utilisateur = ? AND e.actif = 1`,
            [id_utilisateur]
        );
        const ids = [];
        for (const e of emps) {
            if (e.role === 'admin') { ids.push(e.id_employe); continue; }
            const perso = e.role_personnalise ? await reglagesRole(id_utilisateur, e.role_personnalise) : null;
            const r = perso || (await reglagesRole(id_utilisateur, e.role));
            if (r?.actions?.includes(DROIT_VALIDER)) ids.push(e.id_employe);
        }
        return ids;
    } catch (e) {
        console.warn('[Retours] valideurs :', e.message);
        return [];
    }
}

class RetourClientController {
    /**
     * ============================================================
     * GET /api/retours-clients/search-commande?q=CV-2024
     * Rechercher une commande pour faire un retour
     * ============================================================
     */
    static async searchCommande(req, res) {
        try {
            const { q, jours } = req.query;

            // Recherche vide : les dernières ventes qui peuvent encore être retournées
            const texte = String(q || '').trim();
            if (texte.length === 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum 2 caractères pour la recherche'
                });
            }

            const commandes = await RetourClient.searchCommandes(
                texte,
                req.workspaceId,
                jours
            );

            return res.status(200).json({
                success: true,
                count: commandes.length,
                data: commandes
            });

        } catch (error) {
            console.error('Search commande retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la recherche'
            });
        }
    }

    /**
     * ============================================================
     * POST /api/retours-clients
     * Créer un nouveau retour client
     * ============================================================
     */
    static async create(req, res) {
        try {
            const {
                id_commande_vente,
                motif_retour,
                type_resolution,
                notes,
                lignes
            } = req.body;

            // Validations
            if (!id_commande_vente) {
                return res.status(400).json({
                    success: false,
                    message: 'La commande est obligatoire'
                });
            }
            if (!motif_retour) {
                return res.status(400).json({
                    success: false,
                    message: 'Le motif de retour est obligatoire'
                });
            }
            if (!lignes || !Array.isArray(lignes) || lignes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Au moins un produit doit être retourné'
                });
            }

            await permissionsDe(req);
            const valider = peut(req, DROIT_VALIDER);
            const retour = await RetourClient.create({
                id_commande_vente: parseInt(id_commande_vente),
                motif_retour,
                type_resolution: type_resolution || 'remboursement_especes',
                notes: notes || null,
                lignes,
                id_utilisateur: req.workspaceId,
                auteur: {
                    nom: req.user?.fullname || null,
                    id_employe: req.user?.type === 'employe' ? req.user.id_employe : null,
                },
                valider,
            });

            if (!valider) {
                notifierRetourAValider(req.workspaceId, retour, {
                    auteur: req.user?.fullname || null,
                    idsValideurs: await idsValideurs(req.workspaceId),
                    jetonExclu: req.get('x-miyo-appareil') || null,
                });
            }

            return res.status(201).json({
                success: true,
                en_attente: !valider,
                message: valider
                    ? 'Retour enregistré avec succès'
                    : 'Retour envoyé au patron pour validation : le stock et l\'argent ne bougeront qu\'après sa validation',
                data: retour
            });

        } catch (error) {
            console.error('Create retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création du retour'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-clients
     * Liste des retours
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                statut,
                type_resolution,
                date_debut,
                date_fin,
                page = 1,
                limit = 20
            } = req.query;

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            const retours = await RetourClient.findAll({
                search,
                statut,
                type_resolution,
                date_debut,
                date_fin,
                limit: limitNum,
                offset
            }, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: retours.length,
                data: retours,
                pagination: {
                    page: pageNum,
                    limit: limitNum
                }
            });

        } catch (error) {
            console.error('Get all retours error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération'
            });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-clients/:id
     * Détail d'un retour
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            if (!id || isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID invalide'
                });
            }

            const retour = await RetourClient.findById(
                parseInt(id),
                req.workspaceId
            );

            if (!retour) {
                return res.status(404).json({
                    success: false,
                    message: 'Retour non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                data: retour
            });

        } catch (error) {
            console.error('Get retour by ID error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération'
            });
        }
    }

    /**
     * ============================================================
     * PATCH /api/retours-clients/:id/annuler
     * Annuler un retour
     * ============================================================
     */
    static async annuler(req, res) {
        try {
            const { id } = req.params;

            // Défaire un retour déjà appliqué fait ressortir du stock et de l'argent : même droit que valider
            await permissionsDe(req);
            if (!peut(req, DROIT_VALIDER)) {
                const actuel = await RetourClient.findById(parseInt(id), req.workspaceId);
                if (actuel && Number(actuel.effets_appliques) === 1) {
                    return res.status(403).json({
                        success: false,
                        code: 'PERMISSION_REFUSEE',
                        message: 'Seul le patron (ou un rôle qu\'il autorise) peut annuler un retour déjà validé'
                    });
                }
            }

            const annule = await RetourClient.annuler(
                parseInt(id),
                req.workspaceId
            );

            if (!annule) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible d\'annuler ce retour'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Retour annulé avec succès'
            });

        } catch (error) {
            console.error('Annuler retour error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de l\'annulation'
            });
        }
    }

    /**
     * ============================================================
     * PATCH /api/retours-clients/:id/approuver
     * Le patron (ou un rôle autorisé) valide : stock, facture et espèces passent
     * ============================================================
     */
    static async approuver(req, res) {
        try {
            const par = req.user?.fullname || null;
            const retour = await RetourClient.approuver(parseInt(req.params.id), req.workspaceId, par);
            notifierDecisionRetour(req.workspaceId, retour, { approuve: true, par });
            const rendu = parseFloat(retour.montant_rendu) || 0;
            return res.status(200).json({
                success: true,
                message: rendu > 0.009
                    ? `Retour ${retour.numero_retour} validé : rendre ${Math.round(rendu).toLocaleString('fr-FR')} FCFA au client`
                    : `Retour ${retour.numero_retour} validé`,
                data: retour
            });
        } catch (error) {
            console.error('Approuver retour error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Validation impossible' });
        }
    }

    /**
     * ============================================================
     * PATCH /api/retours-clients/:id/refuser   { motif }
     * ============================================================
     */
    static async refuser(req, res) {
        try {
            const par = req.user?.fullname || null;
            const retour = await RetourClient.refuser(parseInt(req.params.id), req.workspaceId, { par, motif: req.body?.motif });
            notifierDecisionRetour(req.workspaceId, retour, { approuve: false, par });
            return res.status(200).json({ success: true, message: `Retour ${retour.numero_retour} refusé`, data: retour });
        } catch (error) {
            console.error('Refuser retour error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Refus impossible' });
        }
    }

    /**
     * ============================================================
     * GET /api/retours-clients/stats
     * Statistiques des retours
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            const stats = await RetourClient.getStats(req.workspaceId);

            return res.status(200).json({
                success: true,
                data: stats
            });

        } catch (error) {
            console.error('Get stats retours error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la récupération'
            });
        }
    }
}

export default RetourClientController;