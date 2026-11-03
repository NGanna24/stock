// utils/telephone.js
//
// Forme unique d'un numéro, pour reconnaître le même client quelle que soit la façon de le taper :
//   « 07 07 08 09 10 », « 0707080910 », « +225 07 07 08 09 10 », « 00225 0707080910 »
//   → « +2250707080910 »
// Côte d'Ivoire par défaut (numéros à 10 chiffres). Un numéro étranger saisi avec « + » ou « 00 »
// est gardé tel quel (chiffres seulement). Renvoie null si ce n'est pas un numéro exploitable.
const INDICATIF = '225';

export function normaliserTelephone(brut) {
    if (brut === null || brut === undefined) return null;
    const texte = String(brut).trim();
    if (!texte) return null;
    let chiffres = texte.replace(/\D/g, '');
    const international = texte.startsWith('+') || chiffres.startsWith('00');
    if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);

    if (international || (chiffres.startsWith(INDICATIF) && chiffres.length >= 11)) {
        if (chiffres.length < 8 || chiffres.length > 15) return null;
        return `+${chiffres}`;
    }
    if (chiffres.length === 10 || chiffres.length === 8) return `+${INDICATIF}${chiffres}`;
    if (chiffres.length >= 8 && chiffres.length <= 15) return `+${chiffres}`;
    return null;
}

export default normaliserTelephone;
