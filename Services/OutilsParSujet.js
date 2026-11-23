// Services/OutilsParSujet.js
// ============================================================
// ASSISTANT MIYO : n'envoyer à l'IA que les outils utiles à la question
// ------------------------------------------------------------
// Chaque question envoyait la description des 49 outils (environ 6 000 jetons,
// deux fois par question). Ici, le serveur repère le sujet de la question
// (ventes, stock, dettes, fournisseurs…) et n'envoie que les outils de ce sujet.
//
// Prudence avant tout :
//  - aucun sujet reconnu, ou question trop large : TOUS les outils (comme avant)
//  - message vocal : TOUS les outils (on ne connaît pas la question avant l'écoute)
//  - « et hier ? », « lesquels ? » : on reprend le sujet des messages précédents
//  - l'outil « autres_informations » permet à l'IA de demander tous les outils
//    si ceux qu'elle a reçus ne suffisent pas
// ============================================================

// Toujours envoyés : retrouver un produit, saluer, infos de la boutique
const SOCLE = ['aucune_action', 'rechercher_produit', 'details_produit', 'info_boutique'];

const SUJETS = {
  stock: {
    mots: /\b(stock|reste|restant|rupture|fini|finie|finis|termine|epuise|manque|manquent|bas|faible|vaut|valeur|marchandise|dort|dorment|bouge|mouvement|disponible|combien (?:de|d)|produits?)\b/,
    outils: [
      'produits_en_rupture', 'produits_stock_bas', 'stats_generales', 'valeur_stock', 'lister_produits',
      'produits_non_vendus', 'rapport_stocks_complet', 'derniers_mouvements', 'stock_entrepot',
    ],
  },
  catalogue: {
    mots: /\b(categories?|marques?|modeles?|gamme|liste des produits|mes produits)\b/,
    outils: ['lister_categories', 'lister_marques', 'stock_par_categorie', 'stock_par_fournisseur', 'lister_produits'],
  },
  emplacement: {
    mots: /\b(ou est|ou sont|ou se trouve|ou trouver|range|rangee?s?|rayon|etagere|emplacement|place)\b/,
    outils: ['emplacement_produit'],
  },
  inventaire: {
    mots: /\b(inventaires?|ecarts?|comptage|compte)\b/,
    outils: ['inventaires_recents', 'details_inventaire', 'derniers_mouvements'],
  },
  ventes: {
    mots: /\b(vendu|vendus|vendue|ventes?|vend|chiffre d affaires|chiffre|rapport|bilan|marche|meilleurs?|top|compare|comparer|evolution|commandes? (?:client|en attente)|livrees?|annulees?|vendeurs?)\b/,
    outils: [
      'chiffre_affaires', 'top_produits', 'ventes_produit_periode', 'comparer_ventes_periodes',
      'rapport_ventes_complet', 'commandes_par_periode', 'commandes_par_statut', 'commandes_en_attente',
      'ventes_par_vendeur', 'top_clients', 'produits_non_vendus',
    ],
  },
  argent: {
    mots: /\b(encaisse|encaisser|encaissements?|argent|rentre|rentree|caisse|tiroir|wave|orange|mtn|moov|especes|cash|mobile money|depense|depenses|depensee?|charges?|gagne|gagner|benefices?|marges?|profit)\b/,
    outils: ['encaissements_periode', 'etat_caisse', 'chiffre_affaires', 'benefices_periode', 'depenses_periode', 'valeur_stock'],
  },
  dettes: {
    mots: /\b(doit|doivent|dois|devoir|dettes?|credits?|impayes?|impayees?|relance|relancer|creances?|rembourse|payer|paye|reste a payer)\b/,
    outils: ['clients_qui_doivent', 'factures_impayees', 'clients_a_relancer', 'details_client', 'rechercher_client', 'dettes_fournisseurs'],
  },
  clients: {
    mots: /\b(clients?|numero|telephone|\d{8,10})\b/,
    outils: ['rechercher_client', 'details_client', 'top_clients', 'clients_qui_doivent'],
  },
  vendre: {
    mots: /\b(vends|vendre|mets|met|ajoute|enregistre|facture pour|donne)\b/,
    outils: ['preparer_vente', 'rechercher_client'],
  },
  fournisseurs: {
    mots: /\b(fournisseurs?|commander|commande|achat|acheter|achete|livraison|livre|arrive|arrivee|recevoir|recu|reapprovisionner|grossiste)\b/,
    outils: [
      'lister_fournisseurs', 'details_fournisseur', 'dettes_fournisseurs', 'suivi_commandes_fournisseur',
      'preparer_commande_achat', 'produits_stock_bas', 'produits_en_rupture',
    ],
  },
  entrepot: {
    mots: /\b(entrepots?|depots?|magasin central|transferts?|en route|valider)\b/,
    outils: ['stock_entrepot', 'transferts_en_cours'],
  },
  retours: {
    mots: /\b(retours?|retourne|retournes|rapporte|rapportes|echange|gate|abime)\b/,
    outils: ['retours_clients_recents'],
  },
  apercu: {
    mots: /\b(commerce|business|affaires|general|generale|point|resume|situation|tableau de bord|comment ca va (?:la|le|mon|ma))\b/,
    outils: [
      'stats_generales', 'chiffre_affaires', 'encaissements_periode', 'benefices_periode',
      'produits_en_rupture', 'produits_stock_bas', 'clients_qui_doivent', 'comparer_ventes_periodes',
    ],
  },
  equipe: {
    mots: /\b(employes?|equipe|travaille|vendeuse|caissiers?|magasins|points? de vente|boutiques)\b/,
    outils: ['lister_employes', 'ventes_par_vendeur', 'lister_magasins'],
  },
};

// Au-delà, la question touche à tout : on envoie tout
const MAX_SUJETS = 4;

/** Outil de secours : l'IA le demande quand les outils reçus ne suffisent pas */
export const OUTIL_AUTRES = {
  type: 'function',
  function: {
    name: 'autres_informations',
    description:
      "Appelle cet outil UNIQUEMENT si aucun des autres outils proposés ne permet de répondre à la question (par exemple une information sur les dépenses, les fournisseurs, l'entrepôt ou les employés alors que tu n'as pas l'outil). Tu recevras alors tous les outils disponibles.",
    parameters: { type: 'object', properties: {} },
  },
};

const sansAccents = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ');

function sujetsDe(texte) {
  const t = sansAccents(texte);
  return Object.entries(SUJETS)
    .filter(([, s]) => s.mots.test(t))
    .map(([nom]) => nom);
}

// Politesse : commence par un mot de salutation et reste très court (« merci beaucoup », « bonjour Miyo »)
const SALUTATION = /^\s*(bonjour|bonsoir|salut|merci|bonne (?:journee|soiree|nuit)|au revoir|ok|d accord|cool|super|ca va|bjr|slt)\b/;
const estPolitesse = (t) => SALUTATION.test(t) && t.split(/\s+/).filter(Boolean).length <= 4;

/**
 * Choisit les outils à envoyer pour cette question.
 * @param {string} question        texte de l'utilisateur (vide pour un message vocal)
 * @param {Array}  historique      messages précédents { role, content }
 * @param {Array}  outilsRole      outils autorisés pour ce rôle (format OpenAI)
 * @param {{ voix?: boolean }} options
 * @returns {{ outils: Array, complet: boolean, sujets: string[] }}
 */
export function choisirOutils(question, historique = [], outilsRole = [], { voix = false } = {}) {
  const tous = { outils: outilsRole, complet: true, sujets: ['tout'] };
  if (voix) return { ...tous, sujets: ['voix'] };

  let sujets = sujetsDe(question);

  // Suite de conversation sans mot-clé (« et hier ? », « lesquels ? ») :
  // on reprend le sujet des derniers messages et les outils déjà utilisés
  const outilsDejaVus = new Set();
  if (sujets.length === 0) {
    const precedents = historique.slice(-4);
    for (const h of precedents) {
      for (const m of String(h.content || '').matchAll(/\b([a-z]+(?:_[a-z]+)+)\(/g)) outilsDejaVus.add(m[1]);
    }
    sujets = sujetsDe(
      precedents
        .filter((h) => h.role === 'user')
        .map((h) => h.content)
        .join(' ')
    );
  }

  if (sujets.length === 0 && outilsDejaVus.size === 0) {
    // Simple politesse : le socle suffit ; sinon on ne prend aucun risque
    return estPolitesse(sansAccents(question)) ? choisirParNoms(SOCLE, outilsRole, ['politesse']) : tous;
  }
  if (sujets.length > MAX_SUJETS) return tous;

  const noms = new Set([...SOCLE, ...outilsDejaVus]);
  for (const s of sujets) for (const n of SUJETS[s].outils) noms.add(n);
  return choisirParNoms(noms, outilsRole, sujets);
}

function choisirParNoms(noms, outilsRole, sujets) {
  const voulus = new Set(noms);
  // On garde l'ordre d'origine : même liste = même début de message = cache de Google
  const outils = outilsRole.filter((t) => voulus.has(t.function.name));
  if (outils.length >= outilsRole.length) return { outils: outilsRole, complet: true, sujets };
  return { outils: [...outils, OUTIL_AUTRES], complet: false, sujets };
}

export const _test = { sujetsDe, SUJETS, SOCLE };
