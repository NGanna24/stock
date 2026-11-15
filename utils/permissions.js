// utils/permissions.js
//
// Rôles et permissions réglables par le propriétaire.
//
//   - Le propriétaire (compte principal) a toujours accès à tout.
//   - Pour chaque rôle d'employé (manager, caissier, magasinier), le propriétaire choisit :
//       * les pages (modules) visibles,
//       * les actions sensibles autorisées.
//   - Tant qu'il n'a rien changé, les réglages par défaut ci-dessous s'appliquent
//     (identiques au fonctionnement d'avant).
//   - Réglages enregistrés dans la table permissions_roles (une ligne par patron et par rôle).
//
// Le serveur vérifie lui-même ces droits : cacher une page du menu ne suffit pas.
// Même catalogue côté web (src/config/rolePermissions.js) et mobile.
import { pool } from '../config/db.js';
import { authenticateToken } from '../middleware/middleware.js';

export const ROLES_REGLABLES = ['manager', 'caissier', 'magasinier'];

export const LIBELLES_ROLES = {
    admin: 'Propriétaire',
    manager: 'Manager',
    caissier: 'Caissier',
    magasinier: 'Magasinier',
};

// Pages réglables (id = identifiant du menu). Le tableau de bord et les paramètres restent toujours ouverts.
export const MODULES = [
    { id: 'alertes', libelle: 'Alertes', groupe: 'Principal' },
    { id: 'assistantachat', libelle: 'Assistant achat', groupe: 'Principal' },

    { id: 'commandes-clients', libelle: 'Vente', groupe: 'Ventes et clients' },
    { id: 'clients', libelle: 'Clients', groupe: 'Ventes et clients' },
    { id: 'caisse', libelle: 'Caisse', groupe: 'Ventes et clients' },
    { id: 'factures', libelle: 'Factures', groupe: 'Ventes et clients' },
    { id: 'relances', libelle: 'Relances clients', groupe: 'Ventes et clients' },
    { id: 'recettes', libelle: 'Recettes', groupe: 'Ventes et clients' },
    { id: 'depenses', libelle: 'Dépenses', groupe: 'Ventes et clients' },
    { id: 'retours-clients', libelle: 'Retours clients', groupe: 'Ventes et clients' },

    { id: 'produits', libelle: 'Produits', groupe: 'Catalogue et stock' },
    { id: 'categories', libelle: 'Catégories', groupe: 'Catalogue et stock' },
    { id: 'marques', libelle: 'Marques', groupe: 'Catalogue et stock' },
    { id: 'modeles', libelle: 'Modèles', groupe: 'Catalogue et stock' },
    { id: 'unites', libelle: 'Unités', groupe: 'Catalogue et stock' },
    { id: 'mouvements', libelle: 'Mouvements de stock', groupe: 'Catalogue et stock' },
    { id: 'inventaires', libelle: 'Inventaires', groupe: 'Catalogue et stock' },
    { id: 'emplacements', libelle: 'Emplacements', groupe: 'Catalogue et stock' },

    { id: 'fournisseurs', libelle: 'Fournisseurs', groupe: 'Approvisionnement' },
    { id: 'commandes-achat', libelle: 'Commandes fournisseurs', groupe: 'Approvisionnement' },
    { id: 'receptions', libelle: 'Réceptions', groupe: 'Approvisionnement' },
    { id: 'comptes-fournisseurs', libelle: 'Comptes fournisseurs', groupe: 'Approvisionnement' },
    { id: 'retours-fournisseurs', libelle: 'Retours fournisseurs', groupe: 'Approvisionnement' },
    { id: 'transferts', libelle: 'Transferts', groupe: 'Approvisionnement' },
    { id: 'entrepot', libelle: 'Entrepôt', groupe: 'Approvisionnement' },

    { id: 'rapport-ventes', libelle: 'Rapport des ventes', groupe: 'Rapports' },
    { id: 'rapport-achats', libelle: 'Rapport des achats', groupe: 'Rapports' },
    { id: 'rapport-stocks', libelle: 'Rapport des stocks', groupe: 'Rapports' },
    { id: 'benefices', libelle: 'Bénéfices et marges', groupe: 'Rapports' },

    { id: 'paiements', libelle: 'Paiements', groupe: 'Administration' },
    { id: 'journal', libelle: "Journal d'activité", groupe: 'Administration' },
];

// Actions sensibles, en plus de l'accès aux pages
export const ACTIONS = [
    { id: 'ventes.annuler', libelle: 'Annuler une vente', aide: 'Les articles reviennent en stock.' },
    { id: 'ventes.modifier_prix', libelle: 'Modifier le prix pendant la vente', aide: 'Sans ce droit, le prix du catalogue est appliqué.' },
    { id: 'ventes.rembourser', libelle: 'Rembourser en annulant une vente payée', aide: "De l'argent sort de la caisse." },
    { id: 'encaissements.supprimer', libelle: 'Supprimer un encaissement', aide: 'Recette ou paiement déjà enregistré.' },
    { id: 'clients.credit', libelle: 'Gérer le crédit des clients', aide: 'Plafond de crédit, désactiver ou fusionner un client.' },
    { id: 'caisse.historique', libelle: "Voir l'historique des caisses", aide: 'Anciennes caisses et leurs écarts.' },
    { id: 'produits.modifier', libelle: 'Créer et modifier les produits', aide: 'Prix, stock, fiche produit, suppression.' },
    { id: 'approvisionnement.gerer', libelle: 'Passer et valider les achats', aide: 'Commandes fournisseurs, réceptions, retours fournisseurs.' },
    { id: 'inventaires.gerer', libelle: 'Faire et valider les inventaires', aide: 'Le stock est corrigé à la validation.' },
];

export const MODULES_IDS = MODULES.map((m) => m.id);
export const ACTIONS_IDS = ACTIONS.map((a) => a.id);

// Réglages par défaut : exactement le fonctionnement d'avant
export const DEFAUTS = {
    manager: {
        modules: [
            'alertes',
            'clients', 'commandes-clients', 'caisse', 'factures', 'recettes', 'retours-clients', 'relances', 'depenses',
            'produits', 'categories', 'marques', 'modeles', 'unites', 'mouvements', 'inventaires', 'emplacements',
            'fournisseurs', 'commandes-achat', 'receptions', 'retours-fournisseurs', 'transferts', 'comptes-fournisseurs',
            'rapport-ventes', 'rapport-achats', 'rapport-stocks', 'benefices',
        ],
        actions: ['ventes.annuler', 'ventes.modifier_prix', 'ventes.rembourser', 'encaissements.supprimer', 'clients.credit', 'caisse.historique', 'produits.modifier', 'approvisionnement.gerer', 'inventaires.gerer'],
    },
    caissier: {
        modules: ['alertes', 'clients', 'commandes-clients', 'caisse', 'factures', 'recettes', 'retours-clients', 'relances', 'produits'],
        actions: ['ventes.annuler'],
    },
    magasinier: {
        modules: [
            'alertes',
            'produits', 'categories', 'marques', 'modeles', 'unites', 'mouvements', 'inventaires', 'emplacements',
            'fournisseurs', 'commandes-achat', 'receptions', 'retours-fournisseurs',
        ],
        // Comme avant : le magasinier consulte les produits, les achats et les inventaires
        actions: [],
    },
};

const TOUT = Object.freeze({ tout: true, modules: ['*'], actions: ['*'] });

// ------------------------------------------------------------
// Lecture / écriture des réglages
// ------------------------------------------------------------
const cache = new Map(); // `${id_utilisateur}|${role}` -> { valeur, expire }
const DUREE_CACHE = 30 * 1000;

const nettoyer = (liste, permis) => [...new Set((Array.isArray(liste) ? liste : []).filter((x) => permis.includes(x)))];

function lireJson(v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return null; }
}

/** Réglages d'un rôle pour un patron (défauts si rien n'est enregistré) */
export async function reglagesRole(id_utilisateur, role, db = pool) {
    if (!ROLES_REGLABLES.includes(role)) return { modules: [], actions: [], personnalise: false };
    const cle = `${id_utilisateur}|${role}`;
    const c = cache.get(cle);
    if (c && c.expire > Date.now()) return c.valeur;

    let valeur = { ...DEFAUTS[role], personnalise: false };
    try {
        const [rows] = await db.query(
            'SELECT modules, actions, date_modification FROM permissions_roles WHERE id_utilisateur = ? AND role = ? LIMIT 1',
            [id_utilisateur, role]
        );
        if (rows[0]) {
            valeur = {
                modules: nettoyer(lireJson(rows[0].modules), MODULES_IDS),
                actions: nettoyer(lireJson(rows[0].actions), ACTIONS_IDS),
                personnalise: true,
                date_modification: rows[0].date_modification,
            };
        }
    } catch (e) {
        // Table absente (migration pas encore passée) : on garde les défauts
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    cache.set(cle, { valeur, expire: Date.now() + DUREE_CACHE });
    return valeur;
}

/** Les 3 rôles d'un patron, pour la page de réglage */
export async function reglagesTousRoles(id_utilisateur) {
    const roles = {};
    for (const r of ROLES_REGLABLES) roles[r] = await reglagesRole(id_utilisateur, r);
    return roles;
}

export async function enregistrerRole(id_utilisateur, role, { modules, actions }) {
    if (!ROLES_REGLABLES.includes(role)) {
        const e = new Error('Rôle inconnu'); e.statusCode = 400; throw e;
    }
    const m = nettoyer(modules, MODULES_IDS);
    const a = nettoyer(actions, ACTIONS_IDS);
    await pool.query(
        `INSERT INTO permissions_roles (id_utilisateur, role, modules, actions)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE modules = VALUES(modules), actions = VALUES(actions)`,
        [id_utilisateur, role, JSON.stringify(m), JSON.stringify(a)]
    );
    cache.delete(`${id_utilisateur}|${role}`);
}

export async function retablirRole(id_utilisateur, role) {
    if (!ROLES_REGLABLES.includes(role)) {
        const e = new Error('Rôle inconnu'); e.statusCode = 400; throw e;
    }
    await pool.query('DELETE FROM permissions_roles WHERE id_utilisateur = ? AND role = ?', [id_utilisateur, role]);
    cache.delete(`${id_utilisateur}|${role}`);
}

// ------------------------------------------------------------
// Droits de la personne connectée
// ------------------------------------------------------------
export const estProprietaire = (req) => req.user?.type !== 'employe' || req.user?.role === 'admin';

/** Droits effectifs ; gardés sur req.permissions pour la suite de la requête */
export async function permissionsDe(req) {
    if (req.permissions) return req.permissions;
    if (!req.user) return { tout: false, modules: [], actions: [] };
    if (estProprietaire(req)) {
        req.permissions = TOUT;
    } else {
        const r = await reglagesRole(req.user.id_utilisateur, req.user.role);
        req.permissions = { tout: false, modules: r.modules, actions: r.actions };
    }
    return req.permissions;
}

/** Vérification synchrone, une fois permissionsDe appelé (sinon : défauts du rôle) */
export function peut(req, action) {
    if (estProprietaire(req)) return true;
    const p = req.permissions || DEFAUTS[req.user?.role] || { actions: [] };
    return p.actions.includes(action);
}

export function aModule(req, module) {
    if (estProprietaire(req)) return true;
    const p = req.permissions || DEFAUTS[req.user?.role] || { modules: [] };
    return p.modules.includes(module);
}

/**
 * Sans le droit « Modifier le prix pendant la vente » : on ignore le prix et la remise envoyés,
 * le serveur applique le prix du catalogue (unité de vente, sinon produit).
 * Vaut aussi pour les ventes faites hors ligne puis synchronisées.
 */
export function prixDuCatalogueSiInterdit(req, lignes) {
    if (!Array.isArray(lignes) || peut(req, 'ventes.modifier_prix')) return lignes;
    return lignes.map((l) => ({ ...l, prix_vente: 0, remise: 0 }));
}

const refus = (res, message) => res.status(403).json({ success: false, code: 'PERMISSION_REFUSEE', message });

const libelleModule = (id) => MODULES.find((m) => m.id === id)?.libelle || id;
const libelleAction = (id) => ACTIONS.find((a) => a.id === id)?.libelle || id;

/** Authentifie si besoin, charge les droits, puis vérifie */
const avecDroits = (verifier) => (req, res, next) => {
    const suite = async () => {
        try {
            await permissionsDe(req);
            return verifier(req, res, next);
        } catch (e) {
            console.error('❌ permissions:', e);
            return res.status(500).json({ success: false, message: 'Erreur de vérification des droits' });
        }
    };
    if (req.user) return suite();
    return authenticateToken(req, res, suite);
};

/** router.delete('/:id', exigeAction('encaissements.supprimer'), ...) */
export const exigeAction = (action) => avecDroits((req, res, next) => {
    if (peut(req, action)) return next();
    return refus(res, `Action non autorisée pour votre rôle : ${libelleAction(action).toLowerCase()}. Demandez au propriétaire.`);
});

/** Réservé au propriétaire */
export const exigeProprietaire = avecDroits((req, res, next) => {
    if (estProprietaire(req)) return next();
    return refus(res, 'Réservé au propriétaire');
});

// ------------------------------------------------------------
// Contrôle des pages, côté serveur, par adresse
// ------------------------------------------------------------
// lecture : modules qui permettent de lire (null = toute personne connectée)
// ecriture : modules qui permettent d'écrire (null = toute personne connectée)
// Plusieurs modules : une page en utilise d'autres (la vente cherche les clients, etc.)
// actionEcriture : action sensible exigée en plus pour écrire
const R = (prefixe, lecture, ecriture = lecture, actionEcriture = null) => ({ prefixe, lecture, ecriture, actionEcriture });
const VENTE = ['commandes-clients'];
export const REGLES = [
    R('/api/commandes-vente', ['commandes-clients', 'clients', 'factures', 'retours-clients', 'caisse', 'recettes'], ['commandes-clients', 'factures', 'recettes']),
    R('/api/hors-ligne', VENTE),
    R('/api/factures', ['factures', 'commandes-clients', 'clients', 'recettes', 'caisse', 'retours-clients'], ['factures', 'commandes-clients', 'recettes']),
    R('/api/paiements', ['paiements', 'factures', 'commandes-clients', 'recettes', 'caisse'], ['paiements', 'factures', 'commandes-clients', 'recettes']),
    R('/api/recettes', ['recettes', 'caisse', 'factures', 'commandes-clients'], ['recettes', 'factures', 'commandes-clients', 'caisse']),
    R('/api/caisse', ['caisse', 'commandes-clients', 'recettes']),
    R('/api/retours-clients', ['retours-clients']),
    R('/api/relances', ['relances', 'clients']),
    R('/api/clients/indicatif', null),
    R('/api/clients', ['clients', 'commandes-clients', 'factures', 'retours-clients', 'relances', 'recettes', 'caisse'], ['clients', 'commandes-clients']),
    R('/api/depenses', ['depenses']),
    R('/api/rapports/ventes', ['rapport-ventes']),
    R('/api/rapports/achats', ['rapport-achats']),
    R('/api/rapports/stocks', ['rapport-stocks']),
    R('/api/rapports/benefices', ['benefices']),
    R('/api/rapports', ['rapport-ventes', 'rapport-achats', 'rapport-stocks', 'benefices']),
    R('/api/assistant-achat', ['assistantachat'], ['assistantachat'], 'approvisionnement.gerer'),
    R('/api/commandes-achat', ['commandes-achat', 'receptions', 'assistantachat', 'fournisseurs', 'comptes-fournisseurs'], ['commandes-achat', 'assistantachat', 'receptions'], 'approvisionnement.gerer'),
    R('/api/receptions', ['receptions', 'commandes-achat', 'comptes-fournisseurs', 'fournisseurs'], ['receptions'], 'approvisionnement.gerer'),
    R('/api/retours-fournisseurs', ['retours-fournisseurs'], ['retours-fournisseurs'], 'approvisionnement.gerer'),
    R('/api/comptes-fournisseurs', ['comptes-fournisseurs']),
    R('/api/dettes-fournisseurs', ['comptes-fournisseurs']),
    R('/api/fournisseurs', null, ['fournisseurs', 'commandes-achat', 'receptions']),
    R('/api/produits', null, ['produits']),
    R('/api/categories', null, ['categories', 'produits']),
    R('/api/marques', null, ['marques', 'produits']),
    R('/api/modeles', null, ['modeles', 'produits']),
    R('/api/unites-vente', null, ['produits', 'unites']),
    R('/api/unites', null, ['unites', 'produits']),
    R('/api/emplacements-magasin', null, ['emplacements', 'produits']),
    R('/api/mouvement-stock', ['mouvements', 'produits', 'inventaires', 'rapport-stocks'], ['mouvements', 'inventaires', 'produits']),
    R('/api/inventaires', ['inventaires'], ['inventaires'], 'inventaires.gerer'),
    R('/api/transferts', ['transferts', 'entrepot']),
    R('/api/entrepots', null, ['entrepot', 'transferts']),
    R('/api/journal', ['journal']),
].sort((a, b) => b.prefixe.length - a.prefixe.length);

const regleDe = (url) => {
    const chemin = url.split('?')[0];
    return REGLES.find((r) => chemin === r.prefixe || chemin.startsWith(r.prefixe + '/')) || null;
};

/**
 * app.use(controleAcces) : vérifie que le rôle de l'employé a la page correspondant à l'adresse.
 * Sans jeton, on laisse la route répondre elle-même (401).
 */
export const controleAcces = (req, res, next) => {
    const regle = regleDe(req.originalUrl);
    if (!regle || req.method === 'OPTIONS') return next();
    if (!req.headers.authorization) return next();
    const lecture = ['GET', 'HEAD'].includes(req.method);
    const modules = lecture ? regle.lecture : regle.ecriture;
    const action = lecture ? null : regle.actionEcriture;
    if (modules === null && !action) return next();
    return avecDroits((rq, rs, nx) => {
        if (modules !== null && !modules.some((m) => aModule(rq, m))) {
            return refus(rs, `Accès non autorisé pour votre rôle : ${libelleModule(modules[0])}. Demandez au propriétaire.`);
        }
        if (action && !peut(rq, action)) {
            return refus(rs, `Action non autorisée pour votre rôle : ${libelleAction(action).toLowerCase()}. Demandez au propriétaire.`);
        }
        return nx();
    })(req, res, next);
};
