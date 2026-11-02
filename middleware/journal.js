// middleware/journal.js
//
// Journal d'activité automatique (« qui a fait quoi »).
//
// Monté UNE fois dans app.js, avant les routes : app.use('/api', journalActivite)
//   - enregistre chaque action RÉUSSIE qui modifie des données (POST, PUT, PATCH, DELETE)
//     faite par un utilisateur connecté (compte principal ou employé) ;
//   - enregistre chaque connexion réussie ;
//   - ne bloque jamais la requête : l'écriture se fait après la réponse, et une erreur
//     d'écriture du journal est seulement affichée dans la console ;
//   - ne garde jamais les mots de passe, jetons ou codes (masqués).
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

// ------------------------------------------------------------
// Modules : 1er segment après /api → nom affiché + « un/une … »
// ------------------------------------------------------------
const MODULES = {
    'commandes-vente': ['Ventes', 'une vente'],
    factures: ['Factures', 'une facture'],
    paiements: ['Paiements', 'un paiement'],
    recettes: ['Recettes', 'un encaissement'],
    'retours-clients': ['Retours clients', 'un retour client'],
    clients: ['Clients', 'un client'],
    produits: ['Produits', 'un produit'],
    'unites-vente': ['Produits', 'une unité de vente'],
    categories: ['Catégories', 'une catégorie'],
    marques: ['Marques', 'une marque'],
    modeles: ['Modèles', 'un modèle'],
    unites: ['Unités', 'une unité'],
    inventaires: ['Inventaires', 'un inventaire'],
    'mouvement-stock': ['Stock', 'un mouvement de stock'],
    fournisseurs: ['Fournisseurs', 'un fournisseur'],
    'commandes-achat': ['Achats', 'une commande fournisseur'],
    receptions: ['Réceptions', 'une réception'],
    'retours-fournisseurs': ['Retours fournisseurs', 'un retour fournisseur'],
    'dettes-fournisseurs': ['Dettes fournisseurs', 'un paiement fournisseur'],
    'assistant-achat': ['Achats', 'une commande (assistant)'],
    depenses: ['Dépenses', 'une dépense'],
    caisse: ['Caisse', 'la caisse'],
    relances: ['Relances clients', 'une relance'],
    'hors-ligne': ['Ventes', 'des ventes faites hors ligne'],
    employes: ['Employés', 'un employé'],
    magasin: ['Magasin', 'la fiche du magasin'],
    utilisateur: ['Compte', 'le compte'],
    entrepots: ['Entrepôts', 'un entrepôt'],
    transferts: ['Transferts', 'un transfert'],
};

// Sous-ressources des entrepôts : /entrepots/:id/<sous-ressource>
const SOUS_ENTREPOT = {
    produits: ['Entrepôts', "un produit d'entrepôt"],
    transferts: ['Transferts', 'un transfert'],
    inventaires: ['Entrepôts', "un inventaire d'entrepôt"],
    stock: ['Entrepôts', "le stock d'entrepôt"],
    membres: ['Entrepôts', "un membre d'entrepôt"],
};

// Routes jamais journalisées (pas de modification de données)
const IGNORES = [/^\/gpt\b/, /^\/search\b/, /^\/super-admin\b/, /^\/admin\b/, /\/export\b/];

// Actions particulières reconnues dans le chemin (dernier segment non numérique)
const ACTIONS_SPECIALES = {
    annuler: ['annulation', 'a annulé'],
    paiement: ['paiement', 'a enregistré un paiement sur'],
    paiements: ['paiement', 'a enregistré'],
    statut: ['statut', 'a changé le statut de'],
    status: ['statut', 'a changé le statut de'],
    actif: ['statut', 'a activé / désactivé'],
    toggle: ['statut', 'a activé / désactivé'],
    ouvrir: ['ouverture', 'a ouvert'],
    cloturer: ['cloture', 'a clôturé'],
    valider: ['validation', 'a validé'],
    approuver: ['validation', 'a approuvé'],
    refuser: ['refus', 'a refusé'],
    demarrer: ['modification', 'a démarré'],
    lignes: ['modification', 'a saisi des lignes dans'],
    lot: ['creation', 'a créé (panier)'],
    'upload-logo': ['modification', 'a changé le logo de'],
    logo: ['suppression', 'a supprimé le logo de'],
    'change-password': ['securite', 'a changé le mot de passe du'],
    rejoindre: ['creation', 'a rejoint'],
    'regenerer-code': ['securite', "a régénéré le code d'accès d'"],
    'tout-conforme': ['validation', 'a tout marqué conforme dans'],
    stock: ['modification', 'a ajusté le stock d'],
    echeance: ['modification', "a changé l'échéance d'"],
    reorder: ['modification', "a réordonné"],
    profile: ['modification', 'a modifié son profil'],
};

const PAR_METHODE = {
    POST: ['creation', 'a créé'],
    PUT: ['modification', 'a modifié'],
    PATCH: ['modification', 'a modifié'],
    DELETE: ['suppression', 'a supprimé'],
};

// Clés pouvant identifier l'objet concerné (cherchées dans la réponse puis dans la requête)
const CLES_REFERENCE = [
    'numero_commande', 'numero_facture', 'numero_reception', 'numero_retour', 'numero_transfert',
    'numero_lot', 'numero_inventaire', 'numero', 'reference_produit', 'nom_commercial',
    'libelle', 'nom', 'fullname', 'nomclient', 'telephone',
];
const SENSIBLE = /pass|token|secret|code|otp|pin/i;

// Pour /<module>/<id> : où lire le nom de l'objet AVANT l'action (utile surtout pour les suppressions,
// quand l'objet n'existe plus après). Noms de tables/colonnes fixes (pas d'entrée utilisateur dans le SQL).
const NOM_AVANT = {
    categories: ['categories', 'id_categorie', 'nom'],
    depenses: ['depenses', 'id_depense', 'libelle'],
    clients: ['clients', 'id_client', 'nom'],
    produits: ['produits', 'id_produit', 'nom'],
    fournisseurs: ['fournisseurs', 'id_fournisseur', 'nom'],
    'commandes-vente': ['commandes_vente', 'id_commande', 'numero_commande'],
    'commandes-achat': ['commandes_achat', 'id_commande_achat', 'numero_commande'],
    receptions: ['receptions', 'id_reception', 'numero_reception'],
    'retours-clients': ['retours_clients', 'id_retour_client', 'numero_retour'],
    'retours-fournisseurs': ['retours_fournisseurs', 'id_retour', 'numero_retour'],
    employes: ['employes', 'id_employe', 'fullname'],
    marques: ['marques', 'id_marque', 'nom'],
    modeles: ['modeles', 'id_modele', 'nom'],
    unites: ['unites', 'id_unite', 'nom'],
    entrepots: ['entrepots', 'id_entrepot', 'nom'],
    inventaires: ['inventaires', 'id_inventaire', 'reference'],
    'unites-vente': ['unites_vente', 'id_unite_vente', 'nom'],
};

async function nomAvant(segments) {
    const cible = NOM_AVANT[segments[0]];
    if (!cible || !/^\d+$/.test(segments[1] || '')) return null;
    if (segments[0] === 'entrepots' && segments.length > 2) return null; // sous-ressource d'entrepôt
    try {
        const [table, cle, col] = cible;
        const [rows] = await pool.query(`SELECT \`${col}\` AS v FROM \`${table}\` WHERE \`${cle}\` = ? LIMIT 1`, [Number(segments[1])]);
        return rows[0]?.v ? tronquer(String(rows[0].v), 120) : null;
    } catch {
        return null; // table absente sur cette installation : sans importance
    }
}

// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------
const tronquer = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Copie allégée et sans données sensibles (≤ ~3 Ko). */
function nettoyer(valeur, profondeur = 0) {
    if (valeur === null || valeur === undefined) return valeur;
    if (typeof valeur === 'string') return tronquer(valeur, 200);
    if (typeof valeur !== 'object') return valeur;
    if (profondeur > 3) return '…';
    if (Array.isArray(valeur)) {
        const out = valeur.slice(0, 15).map((v) => nettoyer(v, profondeur + 1));
        if (valeur.length > 15) out.push(`… ${valeur.length - 15} de plus`);
        return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(valeur).slice(0, 40)) {
        out[k] = SENSIBLE.test(k) ? '***' : nettoyer(v, profondeur + 1);
    }
    return out;
}

function chercherReference(...sources) {
    for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        const candidats = [src.data, src.data?.commande, src.data?.facture, src];
        for (const c of candidats) {
            if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
            for (const k of CLES_REFERENCE) {
                if (c[k] !== undefined && c[k] !== null && String(c[k]).trim()) return tronquer(String(c[k]).trim(), 120);
            }
        }
    }
    return null;
}

function chercherId(segments, reponse) {
    const numerique = [...segments].reverse().find((s) => /^\d+$/.test(s));
    if (numerique) return parseInt(numerique, 10);
    const d = reponse?.data?.session || reponse?.data;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
        const cle = Object.keys(d).find((k) => /^id_/.test(k) && Number.isInteger(Number(d[k])));
        if (cle) return Number(d[cle]);
    }
    return null;
}

/** Module, action et phrase lisible à partir de la méthode et du chemin. */
export function decrire(methode, chemin) {
    const segments = chemin.split('?')[0].split('/').filter(Boolean);
    let [module, objet] = MODULES[segments[0]] || [segments[0] || 'Autre', 'un élément'];

    if (segments[0] === 'entrepots' && segments.length >= 3 && SOUS_ENTREPOT[segments[2]]) {
        [module, objet] = SOUS_ENTREPOT[segments[2]];
    }
    if (segments[0] === 'dettes-fournisseurs' && methode === 'POST') objet = 'un paiement fournisseur';

    const dernier = [...segments].reverse().find((s) => !/^\d+$/.test(s) && s !== segments[0]);
    const speciale = dernier && ACTIONS_SPECIALES[dernier];
    const [action, verbe] = speciale || PAR_METHODE[methode] || ['autre', 'a agi sur'];

    let libelle;
    if (dernier === 'profile') libelle = verbe;
    else if (segments[0] === 'hors-ligne' && methode === 'POST') return { module, action: 'creation', libelle: 'a envoyé des ventes faites hors ligne', segments };
    else if (segments[0] === 'relances' && methode === 'POST') return { module, action: 'relance', libelle: 'a relancé le client', segments };
    else if (segments[0] === 'caisse' && (dernier === 'ouvrir' || dernier === 'cloturer')) libelle = `${verbe} la caisse`;
    else libelle = `${verbe} ${objet}`;
    return { module, action, libelle, segments };
}

async function enregistrer(entree) {
    try {
        await pool.execute(
            `INSERT INTO journal_activite
                (id_utilisateur, acteur_type, acteur_id, acteur_nom, acteur_role, action, module, libelle,
                 reference, entite_id, methode, chemin, statut_http, details, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entree.id_utilisateur, entree.acteur_type, entree.acteur_id, entree.acteur_nom || null,
             entree.acteur_role || null, entree.action, entree.module, tronquer(entree.libelle, 255),
             entree.reference || null, entree.entite_id || null, entree.methode, tronquer(entree.chemin, 255),
             entree.statut_http || null, entree.details || null, tronquer(entree.ip, 64), tronquer(entree.user_agent, 255)]
        );
    } catch (err) {
        console.error('⚠️ [journal] écriture impossible :', err.message);
    }
}

const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
export const journalActivite = (req, res, next) => {
    const methode = req.method.toUpperCase();
    const chemin = (req.originalUrl || req.url || '').replace(/^\/api/, '').split('?')[0];
    const estConnexion = methode === 'POST' && chemin === '/utilisateur/login';
    const ecriture = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methode);

    if ((!ecriture && !estConnexion) || IGNORES.some((re) => re.test(chemin))) return next();

    // On garde le corps de la réponse JSON pour y trouver la référence (n° de vente, nom…)
    let corpsReponse = null;
    const jsonOriginal = res.json.bind(res);
    res.json = (corps) => {
        corpsReponse = corps;
        return jsonOriginal(corps);
    };

    // Nom de l'objet visé, lu AVANT l'action (sinon perdu après une suppression)
    let referenceAvant = null;
    const segmentsBruts = chemin.split('/').filter(Boolean);
    const lectureAvant = !estConnexion && req.headers.authorization
        ? nomAvant(segmentsBruts).then((v) => { referenceAvant = v; })
        : Promise.resolve();

    res.on('finish', async () => {
        if (res.statusCode >= 400) return;
        await lectureAvant;

        // ---- Connexion réussie ----
        if (estConnexion) {
            const u = corpsReponse?.user;
            const jeton = corpsReponse?.token ? jwt.decode(corpsReponse.token) : null;
            if (!u || !jeton) return;
            const base = {
                acteur_type: u.type === 'employe' ? 'employe' : 'utilisateur',
                acteur_id: u.id,
                acteur_nom: u.fullname,
                acteur_role: u.role,
                action: 'connexion',
                module: 'Connexion',
                libelle: "s'est connecté(e)",
                methode,
                chemin,
                statut_http: res.statusCode,
                ip: ipDe(req),
                user_agent: req.headers['user-agent'] || null,
            };
            if (base.acteur_type === 'utilisateur') {
                enregistrer({ ...base, id_utilisateur: u.id });
            } else {
                pool.execute('SELECT id_utilisateur FROM employes WHERE id_employe = ?', [u.id])
                    .then(([rows]) => rows[0] && enregistrer({ ...base, id_utilisateur: rows[0].id_utilisateur }))
                    .catch((e) => console.error('⚠️ [journal] connexion employé :', e.message));
            }
            return;
        }

        // ---- Action d'un utilisateur connecté ----
        if (!req.user || !req.workspaceId) return; // route publique ou non authentifiée
        const { module, action, libelle, segments } = decrire(methode, chemin);
        const details = {};
        if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) details.donnees = nettoyer(req.body);
        if (corpsReponse?.message) details.message = tronquer(String(corpsReponse.message), 200);
        let texte = Object.keys(details).length ? JSON.stringify(details) : null;
        if (texte && texte.length > 4000) texte = `${texte.slice(0, 3990)}…"}`;

        const estEmploye = req.user.type === 'employe';
        enregistrer({
            id_utilisateur: req.workspaceId,
            acteur_type: estEmploye ? 'employe' : 'utilisateur',
            // ⚠️ pour un employé, req.user.id contient l'id du patron : on prend id_employe
            acteur_id: estEmploye ? (req.user.id_employe || req.user.id) : req.user.id,
            acteur_nom: req.user.fullname,
            acteur_role: req.user.role,
            action,
            module,
            libelle,
            reference: segments[segments.length - 1] === 'profile' ? null : (chercherReference(corpsReponse, req.body) || referenceAvant),
            entite_id: chercherId(segments, corpsReponse),
            methode,
            chemin,
            statut_http: res.statusCode,
            details: texte,
            ip: ipDe(req),
            user_agent: req.headers['user-agent'] || null,
        });
    });

    // On attend la lecture « avant » (une requête par clé primaire, très rapide) pour ne pas
    // lire le nom après sa suppression.
    lectureAvant.finally(() => next());
};

export default journalActivite;
