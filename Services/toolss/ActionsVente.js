// Services/toolss/ActionsVente.js
// ============================================================
// ACTION PAR LA VOIX : préparer une vente
// ------------------------------------------------------------
// « Vends 2 cartons et 3 bidons d'huile à Awa, elle paie en espèces »
// L'IA appelle preparer_vente avec ce qu'elle a compris. On retrouve ici
// les produits, les unités, le client et les prix, on vérifie le stock…
// mais RIEN n'est enregistré : on renvoie un brouillon (__action) que
// l'application affiche. La vente n'est créée que si le vendeur touche
// « Confirmer » (par la route habituelle POST /api/commandes-vente).
// ============================================================
import { pool } from '../../config/db.js';
import Client from '../../models/Client.js';
import { normaliser, singulier, score } from './Recherche.js';

const PEUVENT_VENDRE = ['admin', 'manager', 'caissier'];
const MODES = ['especes', 'carte', 'virement', 'cheque'];

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const fcfa = (n) => `${Math.round(num(n)).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} francs`;

// Unité dite (« carton », « bidons », « pièce ») → unité du produit
function trouverUnite(produit, uniteDite) {
  const base = {
    id_unite_vente: null,
    nom: produit.unite_nom || 'Unité',
    quantite_base: 1,
    prix_vente: num(produit.prix_vente),
  };
  const unites = [base, ...produit.unites];
  if (!uniteDite) {
    return { unite: base, supposee: produit.unites.length > 0 };
  }
  const u = singulier(normaliser(uniteDite));
  const trouvee = unites.find((x) => {
    const n = singulier(normaliser(x.nom));
    const sym = singulier(normaliser(x.symbole || ''));
    return n === u || (sym && sym === u) || (n.length >= 4 && (n.startsWith(u) || u.startsWith(n)));
  });
  if (trouvee) return { unite: trouvee, supposee: false };
  // Mots génériques pour l'unité de base
  if (['piece', 'pc', 'pce', 'unite', 'bidon', 'bouteille', 'boite', 'sac', 'paquet'].includes(u)) {
    return { unite: base, supposee: true };
  }
  return { unite: base, supposee: true, inconnue: uniteDite };
}

async function chargerProduits(workspaceId) {
  const [produits] = await pool.execute(
    `SELECT p.id_produit, p.nom, p.prix_vente, p.quantite_stock,
            u.nom AS unite_nom, u.symbole AS unite_symbole,
            md.nom AS modele_nom, m.nom AS marque_nom
       FROM produits p
       LEFT JOIN unites u ON p.id_unite = u.id_unite
       LEFT JOIN modeles md ON p.id_modele = md.id_modele
       LEFT JOIN marques m ON p.id_marque = m.id_marque
      WHERE p.id_utilisateur = ?`,
    [workspaceId]
  );
  if (!produits.length) return [];
  const ids = produits.map((p) => p.id_produit);
  const [uvs] = await pool.query(
    `SELECT id_unite_vente, id_produit, nom, quantite_base, prix_vente
       FROM unites_vente
      WHERE id_produit IN (?) AND actif = TRUE`,
    [ids]
  );
  const parProduit = {};
  for (const u of uvs) {
    (parProduit[u.id_produit] ||= []).push({
      id_unite_vente: u.id_unite_vente,
      nom: u.nom,
      quantite_base: num(u.quantite_base) || 1,
      prix_vente: num(u.prix_vente),
    });
  }
  return produits.map((p) => ({ ...p, unites: (parProduit[p.id_produit] || []).filter((u) => u.quantite_base > 1) }));
}

export async function preparer_vente({ lignes = [], client = null, telephone = null, paiement = null } = {}, workspaceId, user = {}) {
  const role = String(user?.role || '').toLowerCase();
  if (role && !PEUVENT_VENDRE.includes(role)) {
    return { error: "Tu n'as pas le droit d'enregistrer des ventes avec ce compte." };
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return { error: 'Quels produits veux-tu vendre, et combien ?' };
  }

  const catalogue = await chargerProduits(workspaceId);
  const problemes = [];
  const brouillon = [];
  const stockUtilise = {};

  for (const l of lignes.slice(0, 15)) {
    const demande = String(l?.produit || '').trim();
    const quantite = Math.round(num(l?.quantite));
    if (!demande) continue;
    if (quantite <= 0) {
      problemes.push(`Quantité manquante pour « ${demande} ».`);
      continue;
    }

    const classes = catalogue
      .map((p) => ({ p, s: score(demande, p) }))
      .filter((x) => x.s >= 0.5)
      .sort((a, b) => b.s - a.s);
    if (!classes.length) {
      problemes.push(`Je ne trouve pas « ${demande} » dans tes produits.`);
      continue;
    }
    // Plusieurs produits aussi proches : on demande de préciser
    const proches = classes.filter((x) => x.s >= classes[0].s - 0.05);
    if (proches.length > 1 && classes[0].s < 1.1) {
      problemes.push(
        `« ${demande} » peut être : ${proches.slice(0, 3).map((x) => x.p.nom).join(', ')}. Précise lequel.`
      );
      continue;
    }

    const produit = classes[0].p;
    const { unite, supposee, inconnue } = trouverUnite(produit, l?.unite);
    if (inconnue) problemes.push(`Unité « ${inconnue} » inconnue pour ${produit.nom} : j'ai compté en ${unite.nom}.`);

    const prixDit = num(l?.prix_unitaire);
    const prix = prixDit > 0 ? prixDit : num(unite.prix_vente) || num(produit.prix_vente) * unite.quantite_base;
    if (prix <= 0) {
      problemes.push(`Pas de prix de vente pour ${produit.nom} : donne-moi le prix.`);
      continue;
    }

    const totalBase = quantite * unite.quantite_base;
    stockUtilise[produit.id_produit] = (stockUtilise[produit.id_produit] || 0) + totalBase;
    const stock = num(produit.quantite_stock);
    if (stockUtilise[produit.id_produit] > stock) {
      problemes.push(`Pas assez de ${produit.nom} : il en reste ${stock} ${produit.unite_nom || 'unité(s)'}.`);
    }

    // Même produit + même unité dits deux fois : on additionne
    const existante = brouillon.find((b) => b.id_produit === produit.id_produit && b.id_unite_vente === unite.id_unite_vente);
    if (existante) {
      existante.quantite += quantite;
      existante.quantite_totale_base += totalBase;
      continue;
    }
    brouillon.push({
      id_produit: produit.id_produit,
      produit_nom: produit.nom,
      id_unite_vente: unite.id_unite_vente,
      nom_unite_vente: unite.nom,
      quantite_base: unite.quantite_base,
      quantite,
      quantite_totale_base: totalBase,
      prix_vente: prix,
      remise: 0,
      unite_supposee: !!supposee,
    });
  }

  // Client : on cherche une fiche existante
  let clientTrouve = null;
  const cle = String(telephone || client || '').trim();
  if (cle.length >= 2) {
    try {
      const res = await Client.search(cle, 3, workspaceId);
      if (res.length) clientTrouve = res[0];
    } catch {
      /* pas de client : vente comptoir */
    }
  }
  const nomClient = clientTrouve?.nom || (client ? String(client).trim() : null);
  const telClient = clientTrouve?.telephone || (telephone ? String(telephone).trim() : null);

  const total = brouillon.reduce((s, b) => s + b.quantite * b.prix_vente, 0);
  let paiementPrevu = null;
  if (paiement && typeof paiement === 'object' && paiement.mode) {
    const mode = MODES.includes(paiement.mode) ? paiement.mode : 'especes';
    const montant = num(paiement.montant) > 0 ? Math.min(num(paiement.montant), total) : total;
    paiementPrevu = { mode, montant };
  }

  const resumeLignes = brouillon
    .map((b) => `${b.quantite} ${b.nom_unite_vente}${b.quantite > 1 ? 's' : ''} de ${b.produit_nom}`)
    .join(', ');

  return {
    // Brouillon lu par l'application (jamais enregistré ici)
    __action: brouillon.length
      ? {
          type: 'vente',
          lignes: brouillon,
          client: { id_client: clientTrouve?.id_client || null, nom: nomClient, telephone: telClient, du: num(clientTrouve?.du) },
          total,
          paiement: paiementPrevu,
          problemes,
        }
      : null,
    vente_enregistree: false,
    reponse_humaine: brouillon.length
      ? `Vente préparée : ${resumeLignes}${nomClient ? ` pour ${nomClient}` : ''}, total ${fcfa(total)}.` +
        (paiementPrevu ? ` Paiement ${paiementPrevu.mode} de ${fcfa(paiementPrevu.montant)}.` : ' Non payée pour l’instant.') +
        ' Elle sera enregistrée quand tu toucheras « Confirmer » à l’écran.'
      : 'Je n’ai rien pu préparer.',
    problemes,
  };
}
