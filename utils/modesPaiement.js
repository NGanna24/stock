// utils/modesPaiement.js
// ============================================================
// MODES DE PAIEMENT — liste commune à tout Miyo.
// Chaque boutique choisit, dans Paramètres, ceux qu'elle accepte
// (table modes_paiement_magasin). Seules les espèces vont dans le tiroir-caisse.
// Les anciens codes (mobile_money, autre) restent lisibles pour l'historique.
// ============================================================
export const MODES_PAIEMENT = [
    { code: 'especes', libelle: 'Espèces', famille: 'especes' },
    { code: 'wave', libelle: 'Wave', famille: 'mobile' },
    { code: 'orange_money', libelle: 'Orange Money', famille: 'mobile' },
    { code: 'mtn_momo', libelle: 'MTN MoMo', famille: 'mobile' },
    { code: 'moov_money', libelle: 'Moov Money', famille: 'mobile' },
    { code: 'carte', libelle: 'Carte bancaire', famille: 'banque' },
    { code: 'virement', libelle: 'Virement', famille: 'banque' },
    { code: 'cheque', libelle: 'Chèque', famille: 'banque' },
];

// Codes anciens, plus proposés mais toujours valables dans l'historique
const ANCIENS = [
    { code: 'mobile_money', libelle: 'Mobile money', famille: 'mobile' },
    { code: 'autre', libelle: 'Autre', famille: 'autre' },
];

// Proposés par défaut à une boutique qui n'a encore rien choisi
export const MODES_PAR_DEFAUT = ['especes', 'wave', 'orange_money', 'mtn_momo', 'moov_money'];

const TOUS = [...MODES_PAIEMENT, ...ANCIENS];
export const CODES_MODES = TOUS.map((m) => m.code);

export const estModeValide = (code) => CODES_MODES.includes(code);

// Code reçu → code enregistré (espèces si inconnu)
export const modeOuEspeces = (code) => (estModeValide(code) ? code : 'especes');

export const libelleMode = (code) => TOUS.find((m) => m.code === code)?.libelle || code || '-';
