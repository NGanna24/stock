// models/CompteFournisseur.js
// ============================================================
// COMPTES FOURNISSEURS — la situation du commerçant chez chaque fournisseur.
// UNE SEULE VÉRITÉ, calculée (rien n'est recopié) à partir de :
//   - réceptions de marchandise (commandes fournisseurs)   → la dette monte
//   - retours fournisseurs traités                          → la dette baisse
//   - versements = paiements_fournisseurs (une seule liste) → la dette baisse
//   - opérations propres au compte : achats hors stock, bonus, utilisations
//     de bonus, ajustements, changements de plafond
//
//   dette = situation de départ + réceptions − retours − versements
//           + achats hors stock (total − payé tout de suite − bonus utilisé)
//           − avoirs portés sur la dette ± ajustements
//   (dette négative = avance chez le fournisseur)
//   bonus = solde distinct : bonus accordés − bonus utilisés
//   crédit disponible = plafond − crédit utilisé
//
// Chaque fournisseur a son compte d'office. On ne supprime jamais rien :
// on annule, avec la raison.
// ============================================================
import { pool } from '../config/db.js';
import { CODES_MODES } from '../utils/modesPaiement.js';
import DetteFournisseur from './DetteFournisseur.js';

// Types affichés dans l'historique (filtre)
export const TYPES_HISTORIQUE = ['reception', 'achat', 'retour', 'versement', 'bonus', 'utilisation_bonus', 'ajustement', 'plafond'];
export const TYPES_BONUS = ['libre', 'conditionnel', 'avoir'];
const JOURS_ALERTE_BONUS = 7;

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};
const montantPositif = (v, libelle = 'Le montant') => {
    const n = r2(num(v));
    if (!(n > 0)) throw fail(`${libelle} doit être supérieur à 0`);
    if (n > 1e12) throw fail(`${libelle} est trop élevé`);
    return n;
};
// AAAA-MM-JJ, que la valeur vienne d'un formulaire (texte) ou de MySQL (objet Date)
const isoDate = (v) => {
    if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) return null;
        const p = (n) => String(n).padStart(2, '0');
        return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const horodatage = (v) => (v instanceof Date ? v.getTime() : (v ? new Date(v).getTime() : 0)) || 0;
const aujourdhui = () => isoDate(new Date());
const texte = (v, max = 2000) => (String(v ?? '').trim().slice(0, max) || null);
const fcfa = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} F`;

/* ============================================================
   HISTORIQUE CALCULÉ (toutes sources, dans l'ordre des dates)
   ============================================================ */

// Charge, pour une liste de fournisseurs, toutes les lignes de leur historique
async function chargerLignes(db, idUtilisateur, idFournisseurs, idComptesParF) {
    if (!idFournisseurs.length) return new Map();
    const lignes = new Map(idFournisseurs.map((id) => [id, []]));
    const ajouter = (idF, l) => lignes.get(idF)?.push(l);

    // Réceptions (comme Dettes : commandes non annulées)
    const [rec] = await db.query(
        `SELECT r.id_reception, r.numero_reception, r.date_reception, r.montant_total, r.statut, r.date_creation,
                ca.id_fournisseur, ca.id_commande_achat, ca.numero_commande
           FROM receptions r
           JOIN commandes_achat ca ON ca.id_commande_achat = r.id_commande_achat
          WHERE r.id_utilisateur = ? AND ca.statut <> 'annulee' AND ca.id_fournisseur IN (?)`,
        [idUtilisateur, idFournisseurs]
    );
    rec.forEach((r) => ajouter(r.id_fournisseur, {
        cle: `reception-${r.id_reception}`, source: 'reception', type: 'reception', id: r.id_reception,
        date: isoDate(r.date_reception), tri: horodatage(r.date_creation),
        montant: num(r.montant_total), effet: r.statut === 'annulee' ? 0 : num(r.montant_total),
        annulee: r.statut === 'annulee', reference: r.numero_reception,
        detail: `Commande ${r.numero_commande}`, id_commande_achat: r.id_commande_achat,
    }));

    // Retours traités (hors commande annulée)
    const [ret] = await db.query(
        `SELECT rf.id_retour, rf.numero_retour, rf.date_retour, rf.date_traitement, rf.montant_total, rf.motif_retour,
                rf.id_fournisseur, rf.date_creation, ca.numero_commande
           FROM retours_fournisseurs rf
           LEFT JOIN commandes_achat ca ON ca.id_commande_achat = rf.id_commande_achat
          WHERE rf.id_utilisateur = ? AND rf.statut = 'traite' AND rf.id_fournisseur IN (?)
            AND (rf.id_commande_achat IS NULL OR ca.statut <> 'annulee')`,
        [idUtilisateur, idFournisseurs]
    );
    ret.forEach((r) => ajouter(r.id_fournisseur, {
        cle: `retour-${r.id_retour}`, source: 'retour', type: 'retour', id: r.id_retour,
        date: isoDate(r.date_traitement || r.date_retour), tri: horodatage(r.date_traitement || r.date_creation),
        montant: num(r.montant_total), effet: -num(r.montant_total), annulee: false,
        reference: r.numero_retour, detail: r.numero_commande ? `Commande ${r.numero_commande}` : 'Retour de marchandise',
    }));

    // Versements = paiements fournisseurs (un versement réparti = un seul « groupe »)
    const [pay] = await db.query(
        `SELECT p.*, ca.numero_commande, ca.statut AS statut_commande
           FROM paiements_fournisseurs p
           LEFT JOIN commandes_achat ca ON ca.id_commande_achat = p.id_commande_achat
          WHERE p.id_utilisateur = ? AND p.id_fournisseur IN (?)
          ORDER BY p.id_paiement_fournisseur`,
        [idUtilisateur, idFournisseurs]
    );
    const groupes = new Map();
    pay.forEach((p) => {
        // Comme Dettes : un paiement sur une commande annulée ne compte plus
        const compte = !p.id_commande_achat || p.statut_commande !== 'annulee';
        const cle = `${p.id_fournisseur}|${p.groupe || `p${p.id_paiement_fournisseur}`}`;
        if (!groupes.has(cle)) {
            groupes.set(cle, {
                cle: `versement-${p.id_paiement_fournisseur}`, source: 'versement', type: 'versement', id: p.id_paiement_fournisseur,
                id_fournisseur: p.id_fournisseur, date: isoDate(p.date_paiement), tri: horodatage(p.date_creation),
                montant: 0, effet: 0, annulee: !!p.annule, motif_annulation: p.motif_annulation,
                annule_par_nom: p.annule_par_nom, annule_le: p.annule_le,
                reference: p.reference, mode_paiement: p.mode_paiement, observation: p.note,
                a_justificatif: !!p.justificatif, commandes: [], cree_par_nom: p.cree_par_nom, date_creation: p.date_creation,
            });
        }
        const g = groupes.get(cle);
        g.montant = r2(g.montant + num(p.montant));
        if (!p.annule && compte) g.effet = r2(g.effet - num(p.montant));
        if (p.justificatif) g.a_justificatif = true;
        if (p.numero_commande) g.commandes.push(p.numero_commande);
    });
    groupes.forEach((g) => {
        g.detail = g.commandes.length ? `Sur ${g.commandes.join(', ')}` : 'Versement sur le compte';
        delete g.commandes;
        ajouter(g.id_fournisseur, g);
    });

    // Opérations propres au compte
    const idComptes = [...idComptesParF.values()];
    if (idComptes.length) {
        const fParCompte = new Map([...idComptesParF.entries()].map(([f, c]) => [c, f]));
        const [ops] = await db.query(
            `SELECT * FROM operations_compte_fournisseur
              WHERE id_compte IN (?) AND type NOT IN ('versement', 'annulation')`,
            [idComptes]
        );
        const [annul] = await db.query(
            `SELECT id_operation_liee, observation, cree_par_nom, date_creation FROM operations_compte_fournisseur
              WHERE id_compte IN (?) AND type = 'annulation'`,
            [idComptes]
        );
        const motifs = new Map(annul.map((a) => [a.id_operation_liee, a]));
        ops.forEach((o) => {
            const m = num(o.montant);
            let effet = 0;
            if (!o.annulee) {
                if (o.type === 'achat') effet = m - num(o.montant_paye) - num(o.bonus_utilise);
                else if (o.type === 'utilisation_bonus' && o.sur_dette) effet = -m;
                else if (o.type === 'ajustement') effet = m;
            }
            const an = motifs.get(o.id_operation);
            ajouter(fParCompte.get(o.id_compte), {
                cle: `operation-${o.id_operation}`, source: 'operation', type: o.type, id: o.id_operation,
                date: isoDate(o.date_operation), tri: horodatage(o.date_creation),
                montant: m, effet, annulee: !!o.annulee, motif_annulation: an?.observation || null,
                annule_par_nom: an?.cree_par_nom || null, annule_le: an?.date_creation || null,
                reference: o.reference, observation: o.observation, mode_paiement: o.mode_paiement,
                montant_paye: num(o.montant_paye), bonus_utilise: num(o.bonus_utilise), sur_dette: !!o.sur_dette,
                type_bonus: o.type_bonus, date_expiration: isoDate(o.date_expiration),
                plafond_avant: o.plafond_avant == null ? null : num(o.plafond_avant),
                plafond_apres: o.plafond_apres == null ? null : num(o.plafond_apres),
                id_operation_liee: o.id_operation_liee, a_justificatif: !!o.justificatif,
                cree_par_nom: o.cree_par_nom, date_creation: o.date_creation,
            });
        });
    }

    // Réceptions et retours : auteur et heure non suivis ici
    lignes.forEach((l) => l.forEach((x) => { if (x.date_creation === undefined) x.date_creation = null; }));
    return lignes;
}

// Ordre chronologique + dette avant / après chaque ligne
function rejouer(lignes, soldeInitial) {
    const triees = [...lignes].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.tri - b.tri || a.cle.localeCompare(b.cle));
    let dette = r2(soldeInitial);
    for (const l of triees) {
        l.dette_avant = dette;
        dette = r2(dette + (l.effet || 0));
        l.dette_apres = dette;
    }
    return { triees, dette };
}

// Bonus un par un : reste disponible, expiré ou non
function detailBonus(lignes) {
    const ops = lignes.filter((l) => l.source === 'operation' && !l.annulee);
    const jour = aujourdhui();
    return ops.filter((o) => o.type === 'bonus').map((b) => {
        const utilise = r2(ops.filter((u) => u.type === 'utilisation_bonus' && u.id_operation_liee === b.id)
            .reduce((s, u) => s + u.montant, 0));
        const reste = r2(b.montant - utilise);
        const exp = b.date_expiration;
        return {
            id_operation: b.id, date_operation: b.date, type_bonus: b.type_bonus,
            montant: b.montant, utilise, reste, date_expiration: exp,
            expire: !!(exp && exp < jour && reste > 0), epuise: reste <= 0.009,
            reference: b.reference, observation: b.observation,
        };
    });
}

function situation(compte, lignes) {
    const { dette } = rejouer(lignes, num(compte.solde_initial));
    const plafond = num(compte.plafond);
    const actives = lignes.filter((l) => !l.annulee);
    const somme = (f) => r2(actives.filter(f).reduce((s, l) => s + l.montant, 0));
    const bonus = detailBonus(lignes);
    const creditUtilise = Math.max(dette, 0);
    const totalReceptions = somme((l) => l.type === 'reception');
    const totalHorsStock = somme((l) => l.type === 'achat');
    return {
        plafond,
        solde_initial: num(compte.solde_initial),
        dette,
        credit_utilise: creditUtilise,
        avance: Math.max(-dette, 0),
        credit_disponible: r2(Math.max(plafond - creditUtilise, 0)),
        depassement: r2(plafond > 0 ? Math.max(creditUtilise - plafond, 0) : 0),
        total_receptions: totalReceptions,
        total_achats_hors_stock: totalHorsStock,
        total_achats: r2(totalReceptions + totalHorsStock),
        total_retours: somme((l) => l.type === 'retour'),
        total_versements: r2(-actives.filter((l) => l.type === 'versement').reduce((s, l) => s + l.effet, 0)),
        total_paye_achats: r2(actives.filter((l) => l.type === 'achat').reduce((s, l) => s + (l.montant_paye || 0), 0)),
        total_bonus_accordes: somme((l) => l.type === 'bonus'),
        total_bonus_utilises: somme((l) => l.type === 'utilisation_bonus'),
        bonus_disponible: r2(bonus.filter((b) => !b.expire).reduce((s, b) => s + Math.max(b.reste, 0), 0)),
        bonus_expire: r2(bonus.filter((b) => b.expire).reduce((s, b) => s + b.reste, 0)),
        bonus,
        derniere_operation: actives.reduce((m, l) => (l.date && (!m || l.date > m) ? l.date : m), null),
        a_activite: actives.length > 0 || num(compte.solde_initial) !== 0 || plafond > 0,
    };
}

function alertes(compte, sit, dernierRappro) {
    const a = [];
    const nom = compte.fournisseur_nom;
    if (sit.plafond > 0 && sit.credit_utilise >= sit.plafond) {
        a.push({ code: 'plafond_atteint', niveau: 'danger',
            message: sit.depassement > 0 ? `${nom} : plafond dépassé de ${fcfa(sit.depassement)}` : `${nom} : plafond atteint` });
    } else if (sit.plafond > 0 && sit.credit_disponible < sit.plafond * (Number(compte.seuil_alerte_pct) || 20) / 100) {
        a.push({ code: 'credit_faible', niveau: 'attention', message: `${nom} : plus que ${fcfa(sit.credit_disponible)} de crédit disponible` });
    }
    const limite = isoDate(new Date(Date.now() + JOURS_ALERTE_BONUS * 86400000));
    for (const b of sit.bonus) {
        if (b.reste > 0 && !b.expire && b.date_expiration && b.date_expiration <= limite) {
            a.push({ code: 'bonus_expire_bientot', niveau: 'attention',
                message: `${nom} : bonus de ${fcfa(b.reste)} à utiliser avant le ${b.date_expiration.split('-').reverse().join('/')}` });
        }
        if (b.expire) a.push({ code: 'bonus_expire', niveau: 'info', message: `${nom} : bonus de ${fcfa(b.reste)} expiré` });
    }
    if (dernierRappro && dernierRappro.statut === 'ecart') {
        a.push({ code: 'ecart', niveau: 'danger', message: `${nom} : écart de ${fcfa(Math.abs(num(dernierRappro.ecart)))} au dernier rapprochement` });
    }
    return a;
}

/* ============================================================
   MODÈLE
   ============================================================ */
class CompteFournisseur {
    // Chaque fournisseur a son compte d'office
    static async _assurerComptes(db, idUtilisateur) {
        await db.query(
            `INSERT IGNORE INTO comptes_fournisseurs (id_utilisateur, id_fournisseur)
             SELECT id_utilisateur, id_fournisseur FROM fournisseurs WHERE id_utilisateur = ?`,
            [idUtilisateur]
        );
    }

    static async _comptes(db, idUtilisateur, idCompte = null) {
        const [rows] = await db.query(
            `SELECT c.*, f.nom AS fournisseur_nom, f.telephone AS fournisseur_telephone, f.email AS fournisseur_email,
                    f.ville AS fournisseur_ville, f.pays AS fournisseur_pays, f.actif AS fournisseur_actif
             FROM comptes_fournisseurs c
             JOIN fournisseurs f ON f.id_fournisseur = c.id_fournisseur
             WHERE c.id_utilisateur = ? ${idCompte ? 'AND c.id_compte = ?' : ''}
             ORDER BY f.nom`,
            idCompte ? [idUtilisateur, idCompte] : [idUtilisateur]
        );
        return rows;
    }

    static async _derniersRappro(db, idComptes) {
        if (!idComptes.length) return new Map();
        const [rows] = await db.query(
            `SELECT r.* FROM rapprochements_fournisseur r
             JOIN (SELECT id_compte, MAX(id_rapprochement) AS m FROM rapprochements_fournisseur
                   WHERE id_compte IN (?) GROUP BY id_compte) x ON x.m = r.id_rapprochement`,
            [idComptes]
        );
        return new Map(rows.map((r) => [r.id_compte, { ...r, date_verification: isoDate(r.date_verification) }]));
    }

    // Lignes d'historique + situation pour des comptes
    static async _calculer(db, idUtilisateur, comptes) {
        const parF = new Map(comptes.map((c) => [c.id_fournisseur, c.id_compte]));
        const lignes = await chargerLignes(db, idUtilisateur, comptes.map((c) => c.id_fournisseur), parF);
        const rappros = await this._derniersRappro(db, comptes.map((c) => c.id_compte));
        return comptes.map((c) => {
            const l = lignes.get(c.id_fournisseur) || [];
            const sit = situation(c, l);
            const rappro = rappros.get(c.id_compte) || null;
            return { compte: c, lignes: l, sit, rappro };
        });
    }

    static _resume({ compte: c, sit, rappro }) {
        return {
            id_compte: c.id_compte, id_fournisseur: c.id_fournisseur, actif: !!c.actif,
            fournisseur: {
                nom: c.fournisseur_nom, telephone: c.fournisseur_telephone, email: c.fournisseur_email,
                ville: c.fournisseur_ville, pays: c.fournisseur_pays, actif: !!c.fournisseur_actif,
            },
            note: c.note, seuil_alerte_pct: Number(c.seuil_alerte_pct), date_creation: c.date_creation,
            ...sit,
            dernier_rapprochement: rappro,
            alertes: alertes(c, sit, rappro),
        };
    }

    /** Tableau de bord + tous les fournisseurs */
    static async tableauDeBord(idUtilisateur) {
        await this._assurerComptes(pool, idUtilisateur);
        const comptes = await this._comptes(pool, idUtilisateur);
        const calc = await this._calculer(pool, idUtilisateur, comptes);
        const liste = calc.map((x) => this._resume(x))
            .sort((a, b) => b.credit_utilise - a.credit_utilise || Number(b.a_activite) - Number(a.a_activite) || a.fournisseur.nom.localeCompare(b.fournisseur.nom));
        const somme = (k) => r2(liste.reduce((s, c) => s + c[k], 0));
        return {
            totaux: {
                nb_fournisseurs: liste.length,
                nb_fournisseurs_dus: liste.filter((c) => c.credit_utilise > 0.009).length,
                plafond_total: somme('plafond'),
                dette_totale: somme('credit_utilise'),
                avances_totales: somme('avance'),
                credit_disponible_total: somme('credit_disponible'),
                total_versements: somme('total_versements'),
                total_achats: somme('total_achats'),
                total_bonus_accordes: somme('total_bonus_accordes'),
                bonus_disponibles: somme('bonus_disponible'),
                bonus_utilises: somme('total_bonus_utilises'),
            },
            comptes: liste.map(({ bonus, ...c }) => c),
            alertes: liste.flatMap((c) => c.alertes.map((a) => ({ ...a, id_compte: c.id_compte }))),
        };
    }

    static async _un(db, idUtilisateur, idCompte) {
        const [c] = await this._comptes(db, idUtilisateur, idCompte);
        if (!c) throw fail('Compte introuvable', 404);
        const [x] = await this._calculer(db, idUtilisateur, [c]);
        return x;
    }

    static async detail(idUtilisateur, idCompte) {
        return this._resume(await this._un(pool, idUtilisateur, idCompte));
    }

    /** Compte d'un fournisseur (pour ouvrir depuis une autre page) */
    static async idPourFournisseur(idUtilisateur, idFournisseur) {
        await this._assurerComptes(pool, idUtilisateur);
        const [r] = await pool.query('SELECT id_compte FROM comptes_fournisseurs WHERE id_utilisateur = ? AND id_fournisseur = ?', [idUtilisateur, idFournisseur]);
        if (!r[0]) throw fail('Fournisseur introuvable', 404);
        return r[0].id_compte;
    }

    /** Historique filtrable (période, type, référence/observation), du plus récent au plus ancien */
    static async operations(idUtilisateur, idCompte, { du, au, type, q } = {}) {
        const x = await this._un(pool, idUtilisateur, idCompte);
        const { triees } = rejouer(x.lignes, num(x.compte.solde_initial));
        const d = isoDate(du); const a = isoDate(au);
        const recherche = String(q || '').trim().toLowerCase();
        return triees
            .filter((l) => (!d || l.date >= d) && (!a || l.date <= a))
            .filter((l) => !TYPES_HISTORIQUE.includes(type) || l.type === type)
            .filter((l) => !recherche || [l.reference, l.observation, l.detail].some((t) => String(t || '').toLowerCase().includes(recherche)))
            .reverse()
            .map(({ tri, effet, ...l }) => l);
    }

    /** Commandes reçues et ce qui reste à payer dessus (l'ancien détail des dettes) */
    static async commandes(idUtilisateur, idCompte) {
        const [c] = await this._comptes(pool, idUtilisateur, idCompte);
        if (!c) throw fail('Compte introuvable', 404);
        const d = await DetteFournisseur.detail(c.id_fournisseur, idUtilisateur);
        return { commandes: d.commandes, commandes_sans_reception: d.commandes_sans_reception };
    }

    /* ---------------- Fournisseur et réglages du compte ---------------- */

    // « Nouveau compte » = nouveau fournisseur (les autres ont déjà le leur)
    static async creer(idUtilisateur, { nouveau_fournisseur, plafond, solde_initial, seuil_alerte_pct, note }) {
        const nom = texte(nouveau_fournisseur?.nom, 200);
        if (!nom) throw fail('Donnez le nom du fournisseur');
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [ex] = await conn.query('SELECT id_fournisseur FROM fournisseurs WHERE id_utilisateur = ? AND LOWER(nom) = LOWER(?) LIMIT 1', [idUtilisateur, nom]);
            if (ex[0]) throw fail(`« ${nom} » existe déjà : ouvrez son compte dans la liste`, 409);
            const [ins] = await conn.query(
                'INSERT INTO fournisseurs (id_utilisateur, nom, telephone, email, ville, pays, actif) VALUES (?, ?, ?, ?, ?, ?, 1)',
                [idUtilisateur, nom, texte(nouveau_fournisseur?.telephone, 20), texte(nouveau_fournisseur?.email, 100),
                    texte(nouveau_fournisseur?.ville, 100), texte(nouveau_fournisseur?.pays, 100)]
            );
            const seuil = Math.min(Math.max(parseInt(seuil_alerte_pct, 10) || 20, 1), 90);
            const [c] = await conn.query(
                'INSERT INTO comptes_fournisseurs (id_utilisateur, id_fournisseur, plafond, solde_initial, seuil_alerte_pct, note) VALUES (?, ?, ?, ?, ?, ?)',
                [idUtilisateur, ins.insertId, r2(Math.max(num(plafond), 0)), r2(num(solde_initial)), seuil, texte(note)]
            );
            await conn.commit();
            return c.insertId;
        } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }

    static async modifier(idUtilisateur, idCompte, { seuil_alerte_pct, note, solde_initial }) {
        const sets = []; const params = [];
        if (seuil_alerte_pct !== undefined) { sets.push('seuil_alerte_pct = ?'); params.push(Math.min(Math.max(parseInt(seuil_alerte_pct, 10) || 20, 1), 90)); }
        if (note !== undefined) { sets.push('note = ?'); params.push(texte(note)); }
        if (solde_initial !== undefined) { sets.push('solde_initial = ?'); params.push(r2(num(solde_initial))); }
        if (!sets.length) return;
        const [r] = await pool.query(`UPDATE comptes_fournisseurs SET ${sets.join(', ')} WHERE id_compte = ? AND id_utilisateur = ?`, [...params, idCompte, idUtilisateur]);
        if (!r.affectedRows) throw fail('Compte introuvable', 404);
    }

    /* ---------------- Opérations ---------------- */

    // Transaction + verrou du compte ; fn(ctx) écrit ; renvoie avertissements calculés avant/après
    static async _operation(idUtilisateur, idCompte, type, fn) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [cr] = await conn.query('SELECT id_compte FROM comptes_fournisseurs WHERE id_compte = ? AND id_utilisateur = ? FOR UPDATE', [idCompte, idUtilisateur]);
            if (!cr[0]) throw fail('Compte introuvable', 404);
            const avantX = await this._un(conn, idUtilisateur, idCompte);
            const id = await fn({ conn, compte: avantX.compte, avant: avantX.sit });
            const apresX = await this._un(conn, idUtilisateur, idCompte);
            await conn.commit();
            return { id_operation: id, avertissements: this._avertir(avantX.compte, avantX.sit, apresX.sit, type) };
        } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }

    static _avertir(compte, avant, apres, type) {
        const a = [];
        if (type === 'achat' && apres.credit_utilise > avant.credit_utilise) {
            if (apres.plafond > 0 && apres.credit_utilise > apres.plafond) {
                a.push(`Cet achat dépasse votre plafond chez ${compte.fournisseur_nom} de ${fcfa(apres.credit_utilise - apres.plafond)}.`);
            } else if (apres.plafond === 0) {
                a.push(`Vous n'avez pas de plafond chez ${compte.fournisseur_nom} : ${fcfa(apres.credit_utilise - avant.credit_utilise)} restent dus sur cet achat.`);
            }
        }
        if (type === 'versement' && apres.avance > avant.avance) {
            a.push(`Ce versement dépasse la dette : ${fcfa(apres.avance)} restent en avance chez ${compte.fournisseur_nom}.`);
        }
        return a;
    }

    static async _inserer(conn, compte, champs, par) {
        const cols = { id_compte: compte.id_compte, id_utilisateur: compte.id_utilisateur, ...champs,
            cree_par_type: par?.type || null, cree_par_id: par?.id ?? null, cree_par_nom: texte(par?.nom, 100) };
        const k = Object.keys(cols);
        const [ins] = await conn.query(
            `INSERT INTO operations_compte_fournisseur (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`,
            k.map((x) => cols[x])
        );
        return ins.insertId;
    }

    static _choisirBonus(avant, idBonus, montant) {
        const dispo = avant.bonus.filter((b) => b.reste > 0.009 && !b.expire);
        if (!dispo.length) throw fail('Aucun bonus disponible sur ce compte');
        let b;
        if (idBonus) {
            b = avant.bonus.find((x) => x.id_operation === Number(idBonus));
            if (!b) throw fail('Bonus introuvable');
            if (b.expire) throw fail('Ce bonus est expiré');
            if (b.reste <= 0.009) throw fail('Ce bonus est déjà entièrement utilisé');
        } else {
            b = [...dispo].sort((x, y) => (x.date_expiration || '9999').localeCompare(y.date_expiration || '9999'))[0];
        }
        if (montant > b.reste + 0.009) throw fail(`Ce bonus n'a plus que ${fcfa(b.reste)} disponibles`);
        return b;
    }

    // Achat HORS STOCK (pas de réception de marchandise dans Miyo)
    static achat(idUtilisateur, idCompte, d, par) {
        return this._operation(idUtilisateur, idCompte, 'achat', async ({ conn, compte, avant }) => {
            const total = montantPositif(d.montant, "Le montant de l'achat");
            const paye = r2(Math.max(num(d.montant_paye), 0));
            const bonusUtilise = r2(Math.max(num(d.bonus_utilise), 0));
            if (paye + bonusUtilise > total + 0.009) throw fail("Le montant payé et le bonus dépassent le total de l'achat");
            const date = isoDate(d.date_operation) || aujourdhui();
            const mode = paye > 0 ? (CODES_MODES.includes(d.mode_paiement) ? d.mode_paiement : 'especes') : null;
            let idUtil = null;
            if (bonusUtilise > 0) {
                const b = this._choisirBonus(avant, d.id_bonus, bonusUtilise);
                idUtil = await this._inserer(conn, compte, {
                    type: 'utilisation_bonus', date_operation: date, montant: bonusUtilise, id_operation_liee: b.id_operation,
                    reference: texte(d.reference, 100), observation: 'Utilisé sur un achat',
                }, par);
            }
            const idAchat = await this._inserer(conn, compte, {
                type: 'achat', date_operation: date, montant: total, montant_paye: paye, bonus_utilise: bonusUtilise,
                mode_paiement: mode, reference: texte(d.reference, 100), observation: texte(d.observation),
                justificatif: d.justificatif || null, id_operation_liee: idUtil,
            }, par);
            if (idUtil) await conn.query('UPDATE operations_compte_fournisseur SET observation = ? WHERE id_operation = ?', [`Utilisé sur l'achat n° ${idAchat}`, idUtil]);
            return idAchat;
        });
    }

    // Versement = paiement fournisseur : sur une commande, ou réparti (le surplus reste en avance)
    static async versement(idUtilisateur, idCompte, d, par) {
        const [c] = await this._comptes(pool, idUtilisateur, idCompte);
        if (!c) throw fail('Compte introuvable', 404);
        const avant = (await this._un(pool, idUtilisateur, idCompte)).sit;
        const r = await DetteFournisseur.payer({
            id_utilisateur: idUtilisateur, id_fournisseur: c.id_fournisseur,
            id_commande_achat: d.id_commande_achat ? parseInt(d.id_commande_achat, 10) : null,
            montant: montantPositif(d.montant, 'Le montant versé'),
            date_paiement: isoDate(d.date_operation) || aujourdhui(),
            mode_paiement: CODES_MODES.includes(d.mode_paiement) ? d.mode_paiement : 'especes',
            reference: d.reference, note: d.observation, par, justificatif: d.justificatif || null,
        });
        const apres = (await this._un(pool, idUtilisateur, idCompte)).sit;
        const nbCmd = r.affectations.filter((a) => a.id_commande_achat).length;
        return {
            id_operation: r.affectations[0]?.id_paiement_fournisseur,
            repartition: nbCmd > 1 ? `Réparti sur ${nbCmd} commandes` : null,
            avertissements: this._avertir(c, avant, apres, 'versement'),
        };
    }

    static bonus(idUtilisateur, idCompte, d, par) {
        return this._operation(idUtilisateur, idCompte, 'bonus', async ({ conn, compte }) => {
            const date = isoDate(d.date_operation) || aujourdhui();
            const exp = isoDate(d.date_expiration);
            if (exp && exp < date) throw fail("La date d'expiration est avant la date d'attribution");
            return this._inserer(conn, compte, {
                type: 'bonus', date_operation: date, montant: montantPositif(d.montant, 'Le montant du bonus'),
                type_bonus: TYPES_BONUS.includes(d.type_bonus) ? d.type_bonus : 'libre', date_expiration: exp,
                reference: texte(d.reference, 100), observation: texte(d.observation), justificatif: d.justificatif || null,
            }, par);
        });
    }

    static utiliserBonus(idUtilisateur, idCompte, d, par) {
        return this._operation(idUtilisateur, idCompte, 'utilisation_bonus', async ({ conn, compte, avant }) => {
            const montant = montantPositif(d.montant, 'Le montant utilisé');
            const b = this._choisirBonus(avant, d.id_bonus, montant);
            const surDette = !!(d.sur_dette === true || d.sur_dette === 'true' || d.sur_dette === '1');
            if (surDette && b.type_bonus !== 'avoir') throw fail('Seul un bonus de type « avoir » peut servir à régler la dette');
            return this._inserer(conn, compte, {
                type: 'utilisation_bonus', date_operation: isoDate(d.date_operation) || aujourdhui(), montant,
                sur_dette: surDette ? 1 : 0, id_operation_liee: b.id_operation,
                reference: texte(d.reference, 100), observation: texte(d.observation),
            }, par);
        });
    }

    static ajustement(idUtilisateur, idCompte, d, par) {
        return this._operation(idUtilisateur, idCompte, 'ajustement', async ({ conn, compte }) => {
            const m = r2(num(d.montant));
            if (!m) throw fail("Le montant de l'ajustement ne peut pas être 0");
            const motif = texte(d.observation);
            if (!motif) throw fail("Expliquez la raison de l'ajustement");
            return this._inserer(conn, compte, {
                type: 'ajustement', date_operation: isoDate(d.date_operation) || aujourdhui(), montant: m,
                reference: texte(d.reference, 100), observation: motif, justificatif: d.justificatif || null,
            }, par);
        });
    }

    static plafond(idUtilisateur, idCompte, d, par) {
        return this._operation(idUtilisateur, idCompte, 'plafond', async ({ conn, compte }) => {
            const nouveau = r2(num(d.plafond));
            if (nouveau < 0) throw fail('Le plafond ne peut pas être négatif');
            const ancien = num(compte.plafond);
            if (Math.abs(nouveau - ancien) < 0.01) throw fail('Le plafond est déjà de ce montant');
            await conn.query('UPDATE comptes_fournisseurs SET plafond = ? WHERE id_compte = ?', [nouveau, compte.id_compte]);
            return this._inserer(conn, compte, {
                type: 'plafond', date_operation: isoDate(d.date_operation) || aujourdhui(), montant: nouveau,
                plafond_avant: ancien, plafond_apres: nouveau,
                observation: texte(d.observation) || (nouveau === 0 ? 'Plafond retiré' : ancien === 0 ? 'Plafond accordé' : 'Plafond modifié'),
            }, par);
        });
    }

    // Annule une opération propre au compte (jamais de suppression)
    static async annuler(idUtilisateur, idOperation, motif, par) {
        const raison = texte(motif, 500);
        if (!raison) throw fail("Expliquez la raison de l'annulation");
        const [o] = await pool.query(
            `SELECT o.* FROM operations_compte_fournisseur o JOIN comptes_fournisseurs c ON c.id_compte = o.id_compte
             WHERE o.id_operation = ? AND c.id_utilisateur = ?`,
            [idOperation, idUtilisateur]
        );
        const op = o[0];
        if (!op) throw fail('Opération introuvable', 404);
        return this._operation(idUtilisateur, op.id_compte, 'annulation', async ({ conn, compte }) => {
            const [ops] = await conn.query('SELECT id_operation, type, annulee, id_operation_liee FROM operations_compte_fournisseur WHERE id_compte = ?', [op.id_compte]);
            const cur = ops.find((x) => x.id_operation === op.id_operation);
            if (cur.annulee) throw fail('Cette opération est déjà annulée');
            if (['annulation', 'versement'].includes(cur.type)) throw fail('Cette ligne ne peut pas être annulée ici');
            if (cur.type === 'plafond') throw fail('Pour changer le plafond, enregistrez un nouveau plafond');
            if (cur.type === 'utilisation_bonus' && ops.some((x) => x.type === 'achat' && x.id_operation_liee === cur.id_operation && !x.annulee)) {
                throw fail("Ce bonus a été utilisé sur un achat : annulez l'achat");
            }
            if (cur.type === 'bonus' && ops.some((x) => x.type === 'utilisation_bonus' && x.id_operation_liee === cur.id_operation && !x.annulee)) {
                throw fail("Ce bonus a déjà été utilisé : annulez d'abord ses utilisations");
            }
            const ids = [cur.id_operation];
            if (cur.type === 'achat' && cur.id_operation_liee) ids.push(cur.id_operation_liee);
            await conn.query('UPDATE operations_compte_fournisseur SET annulee = 1 WHERE id_operation IN (?)', [ids]);
            return this._inserer(conn, compte, {
                type: 'annulation', date_operation: aujourdhui(), montant: num(op.montant),
                id_operation_liee: cur.id_operation, reference: op.reference, observation: raison,
            }, par);
        });
    }

    static async annulerVersement(idUtilisateur, idPaiement, motif, par) {
        await DetteFournisseur.annulerPaiement(idPaiement, idUtilisateur, motif, par);
    }

    /** Justificatif d'une ligne (opération du compte ou versement), après contrôle */
    static async justificatif(idUtilisateur, source, id) {
        const sql = source === 'versement'
            ? 'SELECT justificatif FROM paiements_fournisseurs WHERE id_paiement_fournisseur = ? AND id_utilisateur = ?'
            : `SELECT o.justificatif FROM operations_compte_fournisseur o JOIN comptes_fournisseurs c ON c.id_compte = o.id_compte
               WHERE o.id_operation = ? AND c.id_utilisateur = ?`;
        const [r] = await pool.query(sql, [id, idUtilisateur]);
        if (r[0]?.justificatif || source !== 'versement') return r[0]?.justificatif || null;
        // Versement réparti : le reçu est sur la première ligne du groupe
        const [g] = await pool.query(
            `SELECT p2.justificatif FROM paiements_fournisseurs p1
             JOIN paiements_fournisseurs p2 ON p2.groupe = p1.groupe AND p2.id_utilisateur = p1.id_utilisateur
             WHERE p1.id_paiement_fournisseur = ? AND p1.id_utilisateur = ? AND p2.justificatif IS NOT NULL LIMIT 1`,
            [id, idUtilisateur]
        );
        return g[0]?.justificatif || null;
    }

    /* ---------------- Rapprochements ---------------- */

    static async rapprochements(idUtilisateur, idCompte) {
        const [c] = await this._comptes(pool, idUtilisateur, idCompte);
        if (!c) throw fail('Compte introuvable', 404);
        const [rows] = await pool.query(
            'SELECT * FROM rapprochements_fournisseur WHERE id_compte = ? ORDER BY date_verification DESC, id_rapprochement DESC',
            [c.id_compte]
        );
        return rows.map((r) => ({ ...r, date_verification: isoDate(r.date_verification) }));
    }

    // Compare le solde annoncé par le fournisseur à celui de Miyo. Ne modifie jamais le compte.
    static async rapprocher(idUtilisateur, idCompte, d, par) {
        if (String(d.solde_fournisseur ?? '').trim() === '') throw fail('Saisissez le solde annoncé par le fournisseur');
        const detail = await this.detail(idUtilisateur, idCompte);
        const annonce = r2(num(d.solde_fournisseur));
        const ecart = r2(annonce - detail.dette);
        const statut = Math.abs(ecart) < 0.01 ? 'conforme' : 'ecart';
        const [ins] = await pool.query(
            `INSERT INTO rapprochements_fournisseur
                (id_compte, id_utilisateur, date_verification, solde_fournisseur, solde_miyo, ecart, observation, statut, cree_par_nom)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [idCompte, idUtilisateur, isoDate(d.date_verification) || aujourdhui(), annonce, detail.dette, ecart,
                texte(d.observation), statut, texte(par?.nom, 100)]
        );
        return { id_rapprochement: ins.insertId, solde_miyo: detail.dette, solde_fournisseur: annonce, ecart, statut };
    }

    static async resoudreRapprochement(idUtilisateur, idRappro, note) {
        const raison = texte(note);
        if (!raison) throw fail("Expliquez ce qui a été trouvé (opération manquante, erreur…)");
        const [r] = await pool.query(
            `UPDATE rapprochements_fournisseur SET statut = 'resolu', note_resolution = ?, date_resolution = NOW()
             WHERE id_rapprochement = ? AND id_utilisateur = ? AND statut = 'ecart'`,
            [raison, idRappro, idUtilisateur]
        );
        if (!r.affectedRows) throw fail('Rapprochement introuvable ou déjà réglé', 404);
    }
}

export default CompteFournisseur;
