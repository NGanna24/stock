// controllers/AbonnementController.js
import Abonnement from '../models/Abonnement.js';

const idValide = (v) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) || n < 1 ? null : n;
};

const erreur = (res, e, ou) => {
    console.error(`❌ AbonnementController.${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

class AbonnementController {
    // ==================== CÔTÉ PATRON ====================
    /** GET /api/abonnement : statut, prix du mois et numéros de paiement */
    static async monAbonnement(req, res) {
        try {
            // Seul le patron voit et règle l'abonnement
            if (req.user.type === 'employe') {
                return res.json({ success: true, visible: false });
            }
            const [statut] = await Abonnement.statuts(req.user.id);
            if (!statut) return res.status(404).json({ success: false, message: 'Compte introuvable' });
            const r = await Abonnement.reglages();
            const { fullname, telephone, slug, compte_actif, nb_paiements, ...reste } = statut;
            return res.json({
                success: true,
                visible: true,
                abonnement: reste,
                moyens: Abonnement.moyensPublics(r),
                contact: r.contact || null,
                rappel_expire_minutes: r.rappel_expire_minutes ?? 60,
                tarif: r.tarif,
            });
        } catch (e) { return erreur(res, e, 'monAbonnement'); }
    }

    // ==================== CÔTÉ SUPER-ADMIN ====================
    /** GET /api/super-admin/abonnements */
    static async liste(req, res) {
        try {
            const liste = await Abonnement.statuts();
            const compte = (f) => liste.filter(f).length;
            return res.json({
                success: true,
                abonnements: liste,
                stats: {
                    total: liste.length,
                    actifs: compte((a) => a.statut === 'actif'),
                    essai: compte((a) => a.statut === 'essai'),
                    expires: compte((a) => a.statut === 'expire'),
                    bientot: compte((a) => a.jours_restants >= 0 && a.jours_restants <= 5),
                    revenu_mensuel: liste.filter((a) => a.statut === 'actif').reduce((s, a) => s + a.montant_mensuel, 0),
                },
            });
        } catch (e) { return erreur(res, e, 'liste'); }
    }

    /** GET /api/super-admin/abonnements/reglages */
    static async lireReglages(req, res) {
        try {
            return res.json({ success: true, reglages: await Abonnement.reglages() });
        } catch (e) { return erreur(res, e, 'lireReglages'); }
    }

    /** PUT /api/super-admin/abonnements/reglages */
    static async modifierReglages(req, res) {
        try {
            const reglages = await Abonnement.modifierReglages(req.body || {});
            return res.json({ success: true, message: 'Réglages enregistrés', reglages });
        } catch (e) { return erreur(res, e, 'modifierReglages'); }
    }

    /** GET /api/super-admin/abonnements/:id */
    static async detail(req, res) {
        try {
            const id = idValide(req.params.id);
            if (!id) return res.status(400).json({ success: false, message: 'id invalide' });
            const [statut] = await Abonnement.statuts(id);
            if (!statut) return res.status(404).json({ success: false, message: 'Patron introuvable' });
            return res.json({ success: true, abonnement: statut, historique: await Abonnement.historique(id) });
        } catch (e) { return erreur(res, e, 'detail'); }
    }

    /** POST /api/super-admin/abonnements/:id/prolonger
     *  Body: { nb_mois, montant?, moyen_paiement, reference?, note? } */
    static async prolonger(req, res) {
        try {
            const id = idValide(req.params.id);
            if (!id) return res.status(400).json({ success: false, message: 'id invalide' });
            const statut = await Abonnement.prolonger(id, req.body || {}, req.superAdmin?.id_super_admin);
            if (!statut) return res.status(404).json({ success: false, message: 'Patron introuvable' });
            return res.status(201).json({
                success: true,
                message: 'Abonnement prolongé',
                abonnement: statut,
                historique: await Abonnement.historique(id),
            });
        } catch (e) { return erreur(res, e, 'prolonger'); }
    }

    /** DELETE /api/super-admin/abonnements/:id/paiements/:idAbonnement */
    static async supprimerPaiement(req, res) {
        try {
            const id = idValide(req.params.id);
            const idAbo = idValide(req.params.idAbonnement);
            if (!id || !idAbo) return res.status(400).json({ success: false, message: 'id invalide' });
            const ok = await Abonnement.supprimer(id, idAbo);
            if (!ok) return res.status(404).json({ success: false, message: 'Paiement introuvable' });
            const [statut] = await Abonnement.statuts(id);
            return res.json({ success: true, message: 'Paiement annulé', abonnement: statut, historique: await Abonnement.historique(id) });
        } catch (e) { return erreur(res, e, 'supprimerPaiement'); }
    }
}

export default AbonnementController;
