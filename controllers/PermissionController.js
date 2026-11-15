// controllers/PermissionController.js
// Rôles et permissions : lecture pour la personne connectée, réglage par le propriétaire.
import {
    MODULES, ACTIONS, DEFAUTS, ROLES_REGLABLES, LIBELLES_ROLES,
    permissionsDe, reglagesTousRoles, reglagesRole, enregistrerRole, retablirRole, estProprietaire,
} from '../utils/permissions.js';

const erreur = (res, e, ou) => {
    if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
    console.error(`❌ PermissionController.${ou}:`, e);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
};

class PermissionController {
    /** GET /api/permissions/moi : ce que la personne connectée peut voir et faire */
    static async moi(req, res) {
        try {
            const p = await permissionsDe(req);
            return res.set('Cache-Control', 'no-store').json({
                success: true,
                data: {
                    role: req.user.role,
                    proprietaire: estProprietaire(req),
                    modules: p.modules,
                    actions: p.actions,
                },
            });
        } catch (e) { return erreur(res, e, 'moi'); }
    }

    /** GET /api/permissions : catalogue + réglages des 3 rôles (propriétaire) */
    static async liste(req, res) {
        try {
            const roles = await reglagesTousRoles(req.user.id_utilisateur);
            return res.set('Cache-Control', 'no-store').json({
                success: true,
                data: {
                    modules: MODULES,
                    actions: ACTIONS,
                    defauts: DEFAUTS,
                    libelles: LIBELLES_ROLES,
                    roles: ROLES_REGLABLES.map((r) => ({ role: r, libelle: LIBELLES_ROLES[r], ...roles[r] })),
                },
            });
        } catch (e) { return erreur(res, e, 'liste'); }
    }

    /** PUT /api/permissions/:role { modules, actions } */
    static async enregistrer(req, res) {
        try {
            const { role } = req.params;
            await enregistrerRole(req.user.id_utilisateur, role, req.body || {});
            const r = await reglagesRole(req.user.id_utilisateur, role);
            return res.json({ success: true, message: `Permissions du rôle ${LIBELLES_ROLES[role] || role} enregistrées`, data: { role, ...r } });
        } catch (e) { return erreur(res, e, 'enregistrer'); }
    }

    /** DELETE /api/permissions/:role : retour aux réglages par défaut */
    static async retablir(req, res) {
        try {
            const { role } = req.params;
            await retablirRole(req.user.id_utilisateur, role);
            const r = await reglagesRole(req.user.id_utilisateur, role);
            return res.json({ success: true, message: `Rôle ${LIBELLES_ROLES[role] || role} remis par défaut`, data: { role, ...r } });
        } catch (e) { return erreur(res, e, 'retablir'); }
    }
}

export default PermissionController;
