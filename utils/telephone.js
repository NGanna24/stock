// utils/telephone.js
//
// Forme unique d'un numéro, pour reconnaître le même client quelle que soit la façon de le taper :
//   « 07 07 08 09 10 », « 0707080910 », « +225 07 07 08 09 10 », « 00225 0707080910 »
//   → « +2250707080910 »
// Le pays par défaut est celui du magasin (sinon la Côte d'Ivoire). Un numéro étranger se tape
// avec « + » ou « 00 » devant, ou en choisissant l'indicatif dans le formulaire.
// Même table côté web : src/utils/telephone.js
import { pool } from '../config/db.js';

// longueurs : nombre de chiffres du numéro national (sans l'indicatif)
// zero : le « 0 » de tête se retire quand on ajoute l'indicatif (France, Ghana…)
// groupes : découpage pour l'affichage
export const PAYS_TELEPHONE = [
    { code: 'CI', nom: "Côte d'Ivoire", indicatif: '225', longueurs: [10], groupes: [2, 2, 2, 2, 2], exemple: '07 07 08 09 10' },
    { code: 'BF', nom: 'Burkina Faso', indicatif: '226', longueurs: [8], groupes: [2, 2, 2, 2], exemple: '70 12 34 56' },
    { code: 'ML', nom: 'Mali', indicatif: '223', longueurs: [8], groupes: [2, 2, 2, 2], exemple: '65 00 13 57' },
    { code: 'SN', nom: 'Sénégal', indicatif: '221', longueurs: [9], groupes: [2, 3, 2, 2], exemple: '77 123 45 67' },
    { code: 'GN', nom: 'Guinée', indicatif: '224', longueurs: [9], groupes: [3, 2, 2, 2], exemple: '622 12 34 56' },
    { code: 'TG', nom: 'Togo', indicatif: '228', longueurs: [8], groupes: [2, 2, 2, 2], exemple: '90 12 34 56' },
    { code: 'BJ', nom: 'Bénin', indicatif: '229', longueurs: [10, 8], groupes: [2, 2, 2, 2, 2], exemple: '01 97 12 34 56' },
    { code: 'NE', nom: 'Niger', indicatif: '227', longueurs: [8], groupes: [2, 2, 2, 2], exemple: '90 12 34 56' },
    { code: 'GH', nom: 'Ghana', indicatif: '233', longueurs: [9], zero: true, groupes: [2, 3, 4], exemple: '024 123 4567' },
    { code: 'NG', nom: 'Nigeria', indicatif: '234', longueurs: [10], zero: true, groupes: [3, 3, 4], exemple: '0803 123 4567' },
    { code: 'LR', nom: 'Liberia', indicatif: '231', longueurs: [7, 8, 9], zero: true, groupes: [2, 3, 4], exemple: '077 123 4567' },
    { code: 'CM', nom: 'Cameroun', indicatif: '237', longueurs: [9], groupes: [1, 2, 2, 2, 2], exemple: '6 71 23 45 67' },
    { code: 'GA', nom: 'Gabon', indicatif: '241', longueurs: [8, 7], groupes: [2, 2, 2, 2], exemple: '06 12 34 56' },
    { code: 'CG', nom: 'Congo', indicatif: '242', longueurs: [9], groupes: [2, 3, 2, 2], exemple: '06 123 45 67' },
    { code: 'CD', nom: 'RD Congo', indicatif: '243', longueurs: [9], zero: true, groupes: [3, 3, 3], exemple: '081 234 5678' },
    { code: 'MA', nom: 'Maroc', indicatif: '212', longueurs: [9], zero: true, groupes: [1, 2, 2, 2, 2], exemple: '06 12 34 56 78' },
    { code: 'FR', nom: 'France', indicatif: '33', longueurs: [9], zero: true, groupes: [1, 2, 2, 2, 2], exemple: '06 12 34 56 78' },
    { code: 'US', nom: 'États-Unis / Canada', indicatif: '1', longueurs: [10], groupes: [3, 3, 4], exemple: '201 555 0123' },
];
const PAR_INDICATIF = [...PAYS_TELEPHONE].sort((a, b) => b.indicatif.length - a.indicatif.length);
export const INDICATIF_DEFAUT = '225';

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const paysParIndicatif = (ind) => PAYS_TELEPHONE.find((p) => p.indicatif === String(ind || '').replace(/\D/g, ''));

/** Indicatif d'après le nom du pays tapé dans « Mon magasin » (« Côte d'Ivoire », « cote divoire », « CI »…) */
export function indicatifDuPays(nom) {
    const n = sansAccents(nom);
    if (!n) return null;
    if (n.includes('ivoire')) return '225';
    if (n.includes('burkina')) return '226';
    if (n.includes('congo') && (n.startsWith('rd') || n.includes('democratique') || n.includes('kinshasa'))) return '243';
    const p = PAYS_TELEPHONE.find((x) => sansAccents(x.nom) === n || x.code.toLowerCase() === n)
        || PAYS_TELEPHONE.find((x) => n.length >= 4 && sansAccents(x.nom).startsWith(n));
    return p ? p.indicatif : null;
}

/**
 * Analyse un numéro. Renvoie { norme: '+2250707080910', pays, national } ou { erreur: '…' }.
 * indicatif : pays utilisé quand le numéro est tapé sans « + » ni « 00 ».
 */
export function analyserTelephone(brut, indicatif = INDICATIF_DEFAUT) {
    const texte = String(brut ?? '').trim();
    if (!texte) return { erreur: 'Numéro vide' };
    let chiffres = texte.replace(/\D/g, '');
    const international = texte.startsWith('+') || chiffres.startsWith('00');
    if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);

    let pays;
    let national;
    if (international) {
        pays = PAR_INDICATIF.find((p) => chiffres.startsWith(p.indicatif));
        if (!pays) {
            if (chiffres.length < 8 || chiffres.length > 15) return { erreur: 'Numéro international invalide' };
            return { norme: `+${chiffres}`, pays: null, national: chiffres };
        }
        national = chiffres.slice(pays.indicatif.length);
    } else {
        pays = paysParIndicatif(indicatif) || paysParIndicatif(INDICATIF_DEFAUT);
        // Numéro déjà tapé avec l'indicatif mais sans « + » (ex : 2250707080910)
        const sansPlus = !pays.longueurs.includes(chiffres.length)
            && PAR_INDICATIF.find((p) => chiffres.startsWith(p.indicatif) && p.longueurs.includes(chiffres.length - p.indicatif.length));
        if (sansPlus) { pays = sansPlus; national = chiffres.slice(sansPlus.indicatif.length); } else national = chiffres;
    }
    if (pays.zero && national.startsWith('0') && pays.longueurs.includes(national.length - 1)) national = national.slice(1);
    if (!pays.longueurs.includes(national.length)) {
        return { erreur: `Numéro invalide pour ${pays.nom} : ${pays.longueurs.join(' ou ')} chiffres attendus après +${pays.indicatif}`, pays };
    }
    return { norme: `+${pays.indicatif}${national}`, pays, national };
}

/**
 * Forme unique, pour retrouver un client (ou null si le numéro n'est pas exploitable).
 * Tolérante : un ancien numéro mal formé déjà enregistré (ex. 8 chiffres en Côte d'Ivoire)
 * garde la même forme qu'avant, pour que les clients existants soient toujours retrouvés.
 * La validation stricte à l'enregistrement passe par analyserTelephone.
 */
export function normaliserTelephone(brut, indicatif = INDICATIF_DEFAUT) {
    const r = analyserTelephone(brut, indicatif);
    if (r.norme) return r.norme;
    if (brut === null || brut === undefined) return null;
    const texte = String(brut).trim();
    let chiffres = texte.replace(/\D/g, '');
    const international = texte.startsWith('+') || chiffres.startsWith('00');
    if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
    if (chiffres.length < 8 || chiffres.length > 15) return null;
    if (international || (chiffres.startsWith(indicatif) && chiffres.length >= 11)) return `+${chiffres}`;
    if (chiffres.length === 10 || chiffres.length === 8) return `+${indicatif}${chiffres}`;
    return `+${chiffres}`;
}

/** Affichage lisible : « +225 07 07 08 09 10 » */
export function formaterTelephone(brut, indicatif = INDICATIF_DEFAUT) {
    const r = analyserTelephone(brut, indicatif);
    if (!r.norme) return String(brut ?? '').trim();
    if (!r.pays) return r.norme;
    const morceaux = [];
    let i = 0;
    for (const n of r.pays.groupes || []) { if (i >= r.national.length) break; morceaux.push(r.national.slice(i, i + n)); i += n; }
    if (i < r.national.length) morceaux.push(r.national.slice(i));
    return `+${r.pays.indicatif} ${morceaux.join(' ')}`;
}

// Pays du magasin d'un commerçant (gardé quelques minutes en mémoire)
const cache = new Map();
export async function indicatifDuMagasin(id_utilisateur, db = pool) {
    if (!id_utilisateur) return INDICATIF_DEFAUT;
    const c = cache.get(id_utilisateur);
    if (c && c.t > Date.now() - 5 * 60 * 1000) return c.v;
    let v = null;
    try {
        const [m] = await db.query(
            "SELECT pays FROM magasins WHERE id_utilisateur = ? AND pays IS NOT NULL AND pays <> '' ORDER BY id_magasin LIMIT 1",
            [id_utilisateur]);
        v = indicatifDuPays(m[0]?.pays);
        if (!v) {
            // Sinon : l'indicatif du téléphone du patron
            const [u] = await db.query('SELECT telephone FROM utilisateurs WHERE id_utilisateur = ?', [id_utilisateur]);
            const t = String(u[0]?.telephone || '');
            if (t.startsWith('+')) v = PAR_INDICATIF.find((p) => t.replace(/\D/g, '').startsWith(p.indicatif))?.indicatif || null;
        }
    } catch { /* valeur par défaut */ }
    v = v || INDICATIF_DEFAUT;
    cache.set(id_utilisateur, { v, t: Date.now() });
    return v;
}
export const oublierIndicatif = (id_utilisateur) => cache.delete(id_utilisateur);

export default normaliserTelephone;
