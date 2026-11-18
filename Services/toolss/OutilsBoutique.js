// Services/toolss/OutilsBoutique.js
// ============================================================
// Outils de l'assistant Miyo pour les questions de tous les jours :
//   - où est rangé un produit ;
//   - quels clients me doivent de l'argent, et combien ;
//   - combien j'ai encaissé (espèces, Wave, Orange Money…) ;
//   - préparer une commande au fournisseur (brouillon à confirmer, rien n'est enregistré ici) ;
//   - la caisse du jour, ce que je dois aux fournisseurs, les ventes par vendeur,
//     le suivi des commandes fournisseur (arrivées ou pas) ;
//   - le stock à l'entrepôt, les transferts entrepôt → boutique, les clients à relancer.
// ============================================================
import { pool } from '../../config/db.js';
import { chercherProduits, normaliser, singulier, score } from './Recherche.js';
import { libelleMode } from '../../utils/modesPaiement.js';
import Caisse from '../../models/Caisse.js';
import CompteFournisseur from '../../models/CompteFournisseur.js';
import RelanceClient from '../../models/RelanceClient.js';

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const fcfa = (n) => `${Math.round(num(n)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} francs`;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = () => new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Abidjan' });

// Écart entre deux mots (nombre de lettres à changer) : « Kofi » / « Koffi » = 1
function ecart(a, b) {
  const l = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prec = l[0];
    l[0] = i;
    for (let k = 1; k <= b.length; k++) {
      const t = l[k];
      l[k] = Math.min(l[k] + 1, l[k - 1] + 1, prec + (a[i - 1] === b[k - 1] ? 0 : 1));
      prec = t;
    }
  }
  return l[b.length];
}
// Un nom dit à la voix correspond-il au nom d'un client ? (tolère une lettre de travers par mot)
function nomProche(dit, nom) {
  const motsDits = normaliser(dit).split(/\s+/).filter((m) => m.length >= 3);
  const motsNom = normaliser(nom).split(/\s+/).filter(Boolean);
  if (!motsDits.length) return false;
  return motsDits.every((m) => motsNom.some((n) => n === m || n.startsWith(m) || (m.length >= 4 && ecart(m, n) <= (m.length >= 7 ? 2 : 1))));
}

// ============================================================
// OÙ EST RANGÉ UN PRODUIT
// ============================================================
export async function emplacement_produit({ nom } = {}, workspaceId) {
  if (!nom || typeof nom !== 'string') return { error: 'Quel produit cherches-tu ?' };
  const produits = await chercherProduits(nom.trim(), workspaceId, { limite: 5 });
  if (!produits.length) return { found: false, message: `Aucun produit trouvé pour « ${nom} »` };

  const premier = produits[0];
  const proches = produits.filter((p) => (p._score || 0) >= (premier._score || 0) - 0.05).slice(0, 3);
  const resultats = proches.map((p) => {
    const morceaux = [p.emplacement, p.rayon, p.etagere].map((x) => String(x || '').trim()).filter(Boolean);
    return {
      nom: p.nom,
      emplacement: p.emplacement || null,
      rayon: p.rayon || null,
      etagere: p.etagere || null,
      rangement_connu: morceaux.length > 0,
      reponse_humaine: morceaux.length
        ? `${p.nom} est rangé : ${morceaux.join(', ')}.`
        : `L'emplacement de ${p.nom} n'est pas encore noté dans Miyo.`,
      stock: num(p.quantite_stock),
      unite: p.unite_nom || 'unité',
    };
  });
  return {
    found: true,
    produits: resultats,
    conseil_si_inconnu: "Pour noter l'emplacement : fiche du produit, champ Emplacement (rayon, étagère).",
  };
}

// ============================================================
// CLIENTS QUI DOIVENT DE L'ARGENT
// « doit » = factures non annulées − ce qui a été payé dessus (même règle que l'écran Clients)
// ============================================================
export async function clients_qui_doivent({ limite = 5, client } = {}, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite, 10) || 5, 1), 20);
  const [lignes] = await pool.query(
    `SELECT c.id_client, c.nom, c.telephone, c.plafond_credit,
            d.du, d.du_en_retard, d.plus_ancienne
       FROM clients c
       JOIN (
         SELECT cv.id_client,
                SUM(GREATEST(fv.montant_total - COALESCE(p.paye, 0), 0)) AS du,
                SUM(CASE WHEN fv.date_echeance < CURDATE() THEN GREATEST(fv.montant_total - COALESCE(p.paye, 0), 0) ELSE 0 END) AS du_en_retard,
                MIN(fv.date_facture) AS plus_ancienne
           FROM factures_vente fv
           JOIN commandes_vente cv ON cv.id_commande = fv.id_commande
           LEFT JOIN (SELECT id_facture, SUM(montant) AS paye FROM paiements WHERE id_utilisateur = ? GROUP BY id_facture) p
                  ON p.id_facture = fv.id_facture
          WHERE fv.id_utilisateur = ? AND fv.statut <> 'annulee' AND cv.statut <> 'annulee' AND cv.id_client IS NOT NULL
            AND fv.montant_total - COALESCE(p.paye, 0) > 0.009
          GROUP BY cv.id_client
       ) d ON d.id_client = c.id_client
      WHERE c.id_utilisateur = ? AND c.fusionne_dans IS NULL
      ORDER BY d.du DESC`,
    [workspaceId, workspaceId, workspaceId]
  );

  // Ventes à crédit sans fiche client (comptoir)
  const [[sansFiche]] = await pool.query(
    `SELECT COUNT(*) AS nb, COALESCE(SUM(GREATEST(fv.montant_total - COALESCE(p.paye, 0), 0)), 0) AS du
       FROM factures_vente fv
       JOIN commandes_vente cv ON cv.id_commande = fv.id_commande
       LEFT JOIN (SELECT id_facture, SUM(montant) AS paye FROM paiements WHERE id_utilisateur = ? GROUP BY id_facture) p
              ON p.id_facture = fv.id_facture
      WHERE fv.id_utilisateur = ? AND fv.statut <> 'annulee' AND cv.statut <> 'annulee' AND cv.id_client IS NULL
        AND fv.montant_total - COALESCE(p.paye, 0) > 0.009`,
    [workspaceId, workspaceId]
  );

  let liste = lignes.map((r) => ({
    nom: r.nom,
    telephone: r.telephone || null,
    doit: num(r.du),
    dont_en_retard: num(r.du_en_retard),
    depuis: r.plus_ancienne ? String(r.plus_ancienne instanceof Date ? r.plus_ancienne.toISOString() : r.plus_ancienne).slice(0, 10) : null,
    depasse_plafond: r.plafond_credit !== null && num(r.du) > num(r.plafond_credit) + 0.009,
  }));

  // Question sur un client précis : « est-ce que Koffi me doit ? »
  if (client && String(client).trim()) {
    const demande = String(client).trim();
    const chiffres = demande.replace(/\D/g, '');
    const trouves = liste
      .map((c) => ({ c, s: score(demande, { nom: c.nom }) }))
      .filter((x) => x.s >= 0.5 || nomProche(demande, x.c.nom) || (chiffres.length >= 6 && String(x.c.telephone || '').replace(/\D/g, '').endsWith(chiffres)))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    if (!trouves.length) {
      return { client_demande: demande, doit_quelque_chose: false, reponse_humaine: `${demande} ne te doit rien, ou n'a pas de fiche client.` };
    }
    liste = trouves.slice(0, 3);
    return {
      client_demande: demande,
      doit_quelque_chose: true,
      clients: liste,
      reponse_humaine: liste.map((c) => `${c.nom} te doit ${fcfa(c.doit)}`).join('. ') + '.',
    };
  }

  const total = liste.reduce((s, c) => s + c.doit, 0) + num(sansFiche.du);
  const enRetard = liste.reduce((s, c) => s + c.dont_en_retard, 0);
  return {
    total_du: num(total),
    dont_en_retard: num(enRetard),
    nombre_clients: liste.length,
    clients: liste.slice(0, limit),
    ventes_a_credit_sans_fiche: Number(sansFiche.nb) ? { nombre: Number(sansFiche.nb), montant: num(sansFiche.du) } : null,
    reponse_humaine: total > 0
      ? `${liste.length} client${liste.length > 1 ? 's' : ''} te doi${liste.length > 1 ? 'vent' : 't'} en tout ${fcfa(total)}.`
      : 'Personne ne te doit d\'argent.',
  };
}

// ============================================================
// COMBIEN J'AI ENCAISSÉ (argent réellement reçu, par moyen de paiement)
// ============================================================
export async function encaissements_periode({ date_debut, date_fin } = {}, workspaceId) {
  const fin = JOUR.test(date_fin || '') ? date_fin : aujourdhui();
  const debut = JOUR.test(date_debut || '') ? date_debut : fin;
  const [parMode] = await pool.query(
    `SELECT mode_paiement, COUNT(*) AS nombre, COALESCE(SUM(montant), 0) AS total
       FROM paiements
      WHERE id_utilisateur = ? AND date_paiement BETWEEN ? AND ? AND mode_paiement <> 'avoir'
      GROUP BY mode_paiement
      ORDER BY total DESC`,
    [workspaceId, debut, fin]
  );
  const [[ventes]] = await pool.query(
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS total
       FROM commandes_vente
      WHERE id_utilisateur = ? AND date_commande BETWEEN ? AND ? AND statut <> 'annulee'`,
    [workspaceId, debut, fin]
  );
  const total = parMode.reduce((s, r) => s + num(r.total), 0);
  const modes = parMode.map((r) => ({ moyen: libelleMode(r.mode_paiement), montant: num(r.total), nombre: Number(r.nombre) }));
  const especes = modes.find((m) => m.moyen === 'Espèces');
  return {
    periode: { debut, fin },
    total_encaisse: num(total),
    par_moyen: modes,
    especes: especes ? especes.montant : 0,
    ventes_de_la_periode: { nombre: Number(ventes.nb), montant: num(ventes.total) },
    note: "Encaissé = argent vraiment reçu. Ce n'est pas le montant des ventes : une vente à crédit n'est pas encore encaissée.",
    reponse_humaine: total > 0
      ? `Tu as encaissé ${fcfa(total)}${modes.length > 1 ? `, dont ${modes.slice(0, 2).map((m) => `${fcfa(m.montant)} en ${m.moyen}`).join(' et ')}` : modes.length ? ` en ${modes[0].moyen}` : ''}.`
      : "Aucun encaissement sur cette période.",
  };
}

// ============================================================
// PRÉPARER UNE COMMANDE AU FOURNISSEUR (brouillon : rien n'est enregistré ici)
// L'application affiche le récapitulatif ; la commande n'est créée que si
// l'utilisateur touche « Confirmer » (route habituelle POST /api/commandes-achat).
// ============================================================
const PEUVENT_COMMANDER = ['admin', 'manager', 'magasinier'];

async function catalogueAchat(workspaceId) {
  const [produits] = await pool.execute(
    `SELECT p.id_produit, p.nom, p.prix_achat, p.quantite_stock, p.quantite_minimale, p.quantite_maximale,
            p.id_fournisseur, f.nom AS fournisseur_nom,
            u.nom AS unite_nom, u.symbole AS unite_symbole,
            md.nom AS modele_nom, m.nom AS marque_nom
       FROM produits p
       LEFT JOIN unites u ON p.id_unite = u.id_unite
       LEFT JOIN modeles md ON p.id_modele = md.id_modele
       LEFT JOIN marques m ON p.id_marque = m.id_marque
       LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
      WHERE p.id_utilisateur = ?`,
    [workspaceId]
  );
  if (!produits.length) return [];
  const [uvs] = await pool.query(
    `SELECT id_unite_vente, id_produit, nom, quantite_base, prix_achat
       FROM unites_vente WHERE id_produit IN (?) AND actif = TRUE`,
    [produits.map((p) => p.id_produit)]
  );
  const parProduit = {};
  for (const u of uvs) {
    (parProduit[u.id_produit] ||= []).push({ id_unite_vente: u.id_unite_vente, nom: u.nom, quantite_base: num(u.quantite_base) || 1, prix_achat: num(u.prix_achat) });
  }
  return produits.map((p) => ({ ...p, unites: (parProduit[p.id_produit] || []).filter((u) => u.quantite_base > 1) }));
}

function uniteAchat(produit, uniteDite) {
  const base = { id_unite_vente: null, nom: produit.unite_nom || 'Unité', quantite_base: 1, prix_achat: num(produit.prix_achat) };
  if (!uniteDite) return { unite: base, supposee: produit.unites.length > 0 };
  const u = singulier(normaliser(uniteDite));
  const trouvee = [base, ...produit.unites].find((x) => {
    const n = singulier(normaliser(x.nom));
    return n === u || (n.length >= 4 && (n.startsWith(u) || u.startsWith(n)));
  });
  return trouvee ? { unite: trouvee, supposee: false } : { unite: base, supposee: true, inconnue: uniteDite };
}

export async function preparer_commande_achat({ fournisseur = null, lignes = [] } = {}, workspaceId, user = {}) {
  const role = String(user?.role || '').toLowerCase();
  if (role && !PEUVENT_COMMANDER.includes(role)) {
    return { error: "Tu n'as pas le droit de passer des commandes fournisseur avec ce compte." };
  }
  if (!Array.isArray(lignes) || !lignes.length) {
    return { error: 'Quels produits veux-tu commander, et combien ?' };
  }

  const catalogue = await catalogueAchat(workspaceId);
  const problemes = [];
  const brouillon = [];

  for (const l of lignes.slice(0, 30)) {
    const demande = String(l?.produit || '').trim();
    if (!demande) continue;
    const classes = catalogue.map((p) => ({ p, s: score(demande, p) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
    if (!classes.length) { problemes.push(`Je ne trouve pas « ${demande} » dans tes produits.`); continue; }
    const proches = classes.filter((x) => x.s >= classes[0].s - 0.05);
    if (proches.length > 1 && classes[0].s < 1.1) {
      problemes.push(`« ${demande} » peut être : ${proches.slice(0, 3).map((x) => x.p.nom).join(', ')}. Précise lequel.`);
      continue;
    }
    const produit = classes[0].p;
    const { unite, supposee, inconnue } = uniteAchat(produit, l?.unite);
    if (inconnue) problemes.push(`Unité « ${inconnue} » inconnue pour ${produit.nom} : j'ai compté en ${unite.nom}.`);

    // Quantité non dite : on propose de remonter au stock maximum (ou au double du minimum)
    let quantite = Math.round(num(l?.quantite));
    let proposee = false;
    if (quantite <= 0) {
      const stock = num(produit.quantite_stock);
      const cible = Math.max(num(produit.quantite_maximale), num(produit.quantite_minimale) * 2);
      const manqueBase = Math.max(cible - stock, 0);
      quantite = Math.max(Math.ceil(manqueBase / unite.quantite_base), 1);
      proposee = true;
    }
    const prixDit = num(l?.prix_unitaire);
    const prix = prixDit > 0 ? prixDit : num(unite.prix_achat) || num(produit.prix_achat) * unite.quantite_base;

    const existante = brouillon.find((b) => b.id_produit === produit.id_produit && b.id_unite_vente === unite.id_unite_vente);
    if (existante) {
      existante.quantite += quantite;
      existante.quantite_totale_base = existante.quantite * existante.quantite_base;
      continue;
    }
    brouillon.push({
      id_produit: produit.id_produit,
      produit_nom: produit.nom,
      id_unite_vente: unite.id_unite_vente,
      nom_unite_vente: unite.nom,
      quantite_base: unite.quantite_base,
      quantite,
      quantite_totale_base: quantite * unite.quantite_base,
      prix_achat: prix > 0 ? prix : null,
      unite_supposee: !!supposee,
      quantite_proposee: proposee,
      _id_fournisseur: produit.id_fournisseur,
      _fournisseur_nom: produit.fournisseur_nom,
    });
  }

  // Fournisseur : celui qui est dit, sinon le fournisseur habituel commun aux produits
  const [fournisseurs] = await pool.execute(
    'SELECT id_fournisseur, nom FROM fournisseurs WHERE id_utilisateur = ? AND actif = TRUE',
    [workspaceId]
  );
  let choisi = null;
  if (fournisseur && String(fournisseur).trim()) {
    const classes = fournisseurs.map((f) => ({ f, s: score(String(fournisseur), { nom: f.nom }) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
    if (classes.length) choisi = classes[0].f;
    else problemes.push(`Je ne trouve pas le fournisseur « ${fournisseur} ». Choisis-en un parmi : ${fournisseurs.slice(0, 4).map((f) => f.nom).join(', ')}.`);
  } else {
    const habituels = [...new Set(brouillon.map((b) => b._id_fournisseur).filter(Boolean))];
    if (habituels.length === 1) choisi = fournisseurs.find((f) => f.id_fournisseur === habituels[0]) || null;
    if (!choisi) {
      problemes.push(habituels.length > 1
        ? 'Ces produits viennent de fournisseurs différents : dis-moi à quel fournisseur commander.'
        : `À quel fournisseur veux-tu commander ? Par exemple : ${fournisseurs.slice(0, 3).map((f) => f.nom).join(', ') || 'ajoute d\'abord un fournisseur'}.`);
    }
  }

  const lignesPropres = brouillon.map(({ _id_fournisseur, _fournisseur_nom, ...b }) => b);
  const total = lignesPropres.reduce((s, b) => s + b.quantite * (b.prix_achat || 0), 0);
  const resume = lignesPropres.map((b) => `${b.quantite} ${b.nom_unite_vente}${b.quantite > 1 ? 's' : ''} de ${b.produit_nom}`).join(', ');
  const pret = lignesPropres.length > 0 && !!choisi;

  return {
    __action: lignesPropres.length
      ? {
          type: 'commande_achat',
          fournisseur: choisi ? { id_fournisseur: choisi.id_fournisseur, nom: choisi.nom } : null,
          lignes: lignesPropres,
          total,
          problemes,
        }
      : null,
    commande_enregistree: false,
    reponse_humaine: lignesPropres.length
      ? `Commande préparée${choisi ? ` chez ${choisi.nom}` : ''} : ${resume}${total > 0 ? `, environ ${fcfa(total)}` : ''}.` +
        (pret ? ' Elle sera envoyée quand tu toucheras « Confirmer » à l’écran.' : '')
      : 'Je n’ai rien pu préparer.',
    problemes,
  };
}

// ============================================================
// LA CAISSE (même calcul que l'écran Caisse)
// ============================================================
const heure = (d) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' }).replace(':', 'h') : null);
const jourCourt = (d) => (d ? new Date(d).toLocaleDateString('fr-CA', { timeZone: 'Africa/Abidjan' }) : null);

export async function etat_caisse(args, workspaceId) {
  const { session: s, derniere_cloture: d } = await Caisse.getCourante(workspaceId);
  if (!s) {
    return {
      caisse_ouverte: false,
      derniere_cloture: d
        ? { date: jourCourt(d.date_cloture), heure: heure(d.date_cloture), par: d.cloture_par_nom || null, montant_compte: num(d.montant_compte), ecart: num(d.ecart) }
        : null,
      reponse_humaine: d
        ? `La caisse est fermée. Dernière fermeture le ${jourCourt(d.date_cloture)} à ${heure(d.date_cloture)}, avec ${fcfa(d.montant_compte)} comptés${Math.abs(num(d.ecart)) > 0.009 ? `, écart de ${fcfa(Math.abs(d.ecart))} en ${d.ecart > 0 ? 'plus' : 'moins'}` : ''}.`
        : "La caisse n'a jamais été ouverte.",
    };
  }
  const autres = (s.autres_modes || []).map((m) => ({ moyen: libelleMode(m.mode_paiement), montant: num(m.encaisse) })).filter((m) => m.montant);
  return {
    caisse_ouverte: true,
    ouverte_le: jourCourt(s.date_ouverture),
    ouverte_a: heure(s.date_ouverture),
    ouverte_par: s.ouvert_par_nom || null,
    fond_de_caisse: num(s.fond_initial),
    especes_encaissees: num(s.especes_encaissees),
    especes_rendues: num(s.especes_remboursees),
    depenses_en_especes: num(s.depenses_especes),
    especes_dans_le_tiroir: num(s.montant_theorique),
    autres_encaissements: num(s.autres_encaissements),
    autres_moyens: autres,
    note: "Seules les espèces sont dans le tiroir. Wave, Orange Money, etc. sont à part.",
    reponse_humaine: `Il doit y avoir ${fcfa(s.montant_theorique)} en espèces dans la caisse.` +
      (num(s.autres_encaissements) > 0 ? ` En plus, ${fcfa(s.autres_encaissements)} reçus par mobile money ou autre.` : '') +
      ` Caisse ouverte à ${heure(s.date_ouverture)}${s.ouvert_par_nom ? ` par ${s.ouvert_par_nom}` : ''}.`,
  };
}

// ============================================================
// CE QUE JE DOIS AUX FOURNISSEURS (même calcul que l'écran Comptes fournisseurs)
// ============================================================
export async function dettes_fournisseurs({ fournisseur } = {}, workspaceId) {
  const tdb = await CompteFournisseur.tableauDeBord(workspaceId);
  let comptes = tdb.comptes
    .filter((c) => c.credit_utilise > 0.009 || c.avance > 0.009)
    .map((c) => ({
      fournisseur: c.fournisseur?.nom,
      je_dois: num(c.credit_utilise),
      avance_chez_lui: num(c.avance),
      plafond: num(c.plafond) || null,
      credit_disponible: num(c.plafond) ? num(c.credit_disponible) : null,
      depassement: num(c.depassement) || 0,
    }));

  if (fournisseur && String(fournisseur).trim()) {
    const dit = String(fournisseur).trim();
    const tous = tdb.comptes.map((c) => ({ c, s: score(dit, { nom: c.fournisseur?.nom || '' }) }))
      .filter((x) => x.s >= 0.5 || nomProche(dit, x.c.fournisseur?.nom || '')).sort((a, b) => b.s - a.s);
    if (!tous.length) return { fournisseur_demande: dit, trouve: false, reponse_humaine: `Je ne trouve pas le fournisseur ${dit}.` };
    const c = tous[0].c;
    return {
      fournisseur: c.fournisseur?.nom,
      je_dois: num(c.credit_utilise),
      avance_chez_lui: num(c.avance),
      plafond: num(c.plafond) || null,
      credit_disponible: num(c.plafond) ? num(c.credit_disponible) : null,
      bonus_disponible: num(c.bonus_disponible) || 0,
      reponse_humaine: num(c.credit_utilise) > 0.009
        ? `Tu dois ${fcfa(c.credit_utilise)} à ${c.fournisseur?.nom}.`
        : num(c.avance) > 0.009 ? `Tu ne dois rien à ${c.fournisseur?.nom}, tu as même ${fcfa(c.avance)} d'avance chez lui.` : `Tu ne dois rien à ${c.fournisseur?.nom}.`,
    };
  }

  comptes = comptes.sort((a, b) => b.je_dois - a.je_dois);
  const dus = comptes.filter((c) => c.je_dois > 0.009);
  const total = num(tdb.totaux.dette_totale);
  return {
    total_je_dois: total,
    nombre_fournisseurs: dus.length,
    fournisseurs: dus.slice(0, 8),
    avances_totales: num(tdb.totaux.avances_totales),
    reponse_humaine: total > 0.009
      ? `Tu dois en tout ${fcfa(total)} à ${dus.length} fournisseur${dus.length > 1 ? 's' : ''}.`
      : 'Tu ne dois rien à tes fournisseurs.',
  };
}

// ============================================================
// VENTES PAR VENDEUR
// ============================================================
export async function ventes_par_vendeur({ date_debut, date_fin, vendeur } = {}, workspaceId) {
  const fin = JOUR.test(date_fin || '') ? date_fin : aujourdhui();
  const debut = JOUR.test(date_debut || '') ? date_debut : fin;
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(cv.vendeur_nom), ''), 'Le patron') AS vendeur,
            COUNT(*) AS nb_ventes, COALESCE(SUM(cv.montant_total), 0) AS total
       FROM commandes_vente cv
      WHERE cv.id_utilisateur = ? AND cv.date_commande BETWEEN ? AND ? AND cv.statut <> 'annulee'
      GROUP BY vendeur
      ORDER BY total DESC`,
    [workspaceId, debut, fin]
  );
  let liste = rows.map((r) => ({ vendeur: r.vendeur, ventes: Number(r.nb_ventes), montant: num(r.total) }));
  const total = liste.reduce((s, v) => s + v.montant, 0);
  if (vendeur && String(vendeur).trim()) {
    const dit = String(vendeur).trim();
    const trouves = liste.filter((v) => nomProche(dit, v.vendeur) || score(dit, { nom: v.vendeur }) >= 0.5);
    if (!trouves.length) return { periode: { debut, fin }, vendeur_demande: dit, reponse_humaine: `${dit} n'a rien vendu sur cette période.` };
    liste = trouves;
    return {
      periode: { debut, fin },
      vendeurs: liste,
      reponse_humaine: liste.map((v) => `${v.vendeur} a fait ${v.ventes} vente${v.ventes > 1 ? 's' : ''} pour ${fcfa(v.montant)}`).join('. ') + '.',
    };
  }
  return {
    periode: { debut, fin },
    total_ventes: num(total),
    vendeurs: liste,
    reponse_humaine: liste.length
      ? `${liste[0].vendeur} a le plus vendu : ${fcfa(liste[0].montant)} en ${liste[0].ventes} vente${liste[0].ventes > 1 ? 's' : ''}.`
      : 'Aucune vente sur cette période.',
  };
}

// ============================================================
// SUIVI DES COMMANDES FOURNISSEUR (arrivées, en partie, pas encore)
// ============================================================
const STATUTS_ACHAT = {
  en_attente: 'pas encore envoyée',
  envoyee: 'envoyée, pas encore arrivée',
  partiellement_recue: 'arrivée en partie',
  recue: 'arrivée',
  annulee: 'annulée',
};

export async function suivi_commandes_fournisseur({ fournisseur, inclure_recues = false } = {}, workspaceId) {
  const statuts = inclure_recues ? ['en_attente', 'envoyee', 'partiellement_recue', 'recue'] : ['en_attente', 'envoyee', 'partiellement_recue'];
  const [commandes] = await pool.query(
    `SELECT ca.id_commande_achat, ca.numero_commande, ca.date_commande, ca.statut, ca.montant_total,
            f.nom AS fournisseur_nom, MAX(r.date_reception) AS derniere_reception
       FROM commandes_achat ca
       JOIN fournisseurs f ON f.id_fournisseur = ca.id_fournisseur
       LEFT JOIN receptions r ON r.id_commande_achat = ca.id_commande_achat AND r.statut <> 'annulee'
      WHERE ca.id_utilisateur = ? AND ca.statut IN (?)
        AND (ca.statut <> 'recue' OR ca.date_commande >= DATE_SUB(CURDATE(), INTERVAL 30 DAY))
      GROUP BY ca.id_commande_achat
      ORDER BY ca.date_commande DESC
      LIMIT 40`,
    [workspaceId, statuts]
  );
  let liste = commandes;
  if (fournisseur && String(fournisseur).trim()) {
    const dit = String(fournisseur).trim();
    liste = commandes.filter((c) => nomProche(dit, c.fournisseur_nom) || score(dit, { nom: c.fournisseur_nom }) >= 0.5);
  }

  // Ce qui reste à recevoir, ligne par ligne
  const ids = liste.map((c) => c.id_commande_achat);
  const restes = new Map();
  if (ids.length) {
    const [lignes] = await pool.query(
      `SELECT l.id_commande_achat, COALESCE(p.nom, pe.nom, 'Produit') AS produit, l.nom_unite_vente, l.quantite,
              COALESCE((SELECT SUM(rl.quantite_recue) FROM reception_lignes rl
                          JOIN receptions r ON r.id_reception = rl.id_reception AND r.statut <> 'annulee'
                         WHERE rl.id_ligne_achat = l.id_ligne_achat), 0) AS recue
         FROM ligne_commande_achat l
         LEFT JOIN produits p ON p.id_produit = l.id_produit
         LEFT JOIN produits_entrepot pe ON pe.id_produit_entrepot = l.id_produit_entrepot
        WHERE l.id_commande_achat IN (?)`,
      [ids]
    );
    for (const l of lignes) {
      const reste = Math.max(num(l.quantite) - num(l.recue), 0);
      if (!restes.has(l.id_commande_achat)) restes.set(l.id_commande_achat, []);
      if (reste > 0.009) restes.get(l.id_commande_achat).push(`${reste} ${l.nom_unite_vente || 'unité'} de ${l.produit}`);
    }
  }

  const resultat = liste.map((c) => ({
    numero: c.numero_commande,
    fournisseur: c.fournisseur_nom,
    date: jourCourt(c.date_commande),
    etat: STATUTS_ACHAT[c.statut] || c.statut,
    montant: num(c.montant_total),
    derniere_reception: c.derniere_reception ? jourCourt(c.derniere_reception) : null,
    reste_a_recevoir: c.statut === 'recue' ? [] : (restes.get(c.id_commande_achat) || []).slice(0, 6),
  }));
  const enCours = resultat.filter((c) => c.etat !== 'arrivée');
  return {
    nombre_en_cours: enCours.length,
    commandes: resultat.slice(0, 10),
    reponse_humaine: enCours.length
      ? `${enCours.length} commande${enCours.length > 1 ? 's' : ''} pas encore complètement arrivée${enCours.length > 1 ? 's' : ''}. La plus récente : ${enCours[0].fournisseur}, ${enCours[0].etat}.`
      : fournisseur ? `Aucune commande en cours chez ${fournisseur}.` : 'Aucune commande fournisseur en attente : tout est arrivé.',
  };
}

// ============================================================
// STOCK À L'ENTREPÔT (entrepôts dont le compte est membre)
// ============================================================
async function mesEntrepots(workspaceId) {
  const [rows] = await pool.query(
    `SELECT e.id_entrepot, e.nom, me.role_membre
       FROM entrepots e
       JOIN membres_entrepot me ON me.id_entrepot = e.id_entrepot AND me.id_utilisateur = ? AND me.actif = TRUE
      WHERE e.actif = TRUE
      ORDER BY me.role_membre = 'proprietaire' DESC, e.nom`,
    [workspaceId]
  );
  return rows;
}

// Stock en unité de base -> « 3 cartons + 2 bidons »
function enConditionnements(stock, uniteBase, unites) {
  const conds = unites.filter((u) => u.quantite_base > 1).sort((a, b) => b.quantite_base - a.quantite_base);
  if (!conds.length) return `${stock} ${uniteBase}`;
  let reste = stock;
  const morceaux = [];
  for (const u of conds) {
    const q = Math.floor(reste / u.quantite_base);
    if (q > 0) { morceaux.push(`${q} ${u.nom}`); reste = Math.round((reste - q * u.quantite_base) * 100) / 100; }
  }
  if (reste > 0) morceaux.push(`${reste} ${uniteBase}`);
  return morceaux.join(' + ') || `0 ${uniteBase}`;
}

export async function stock_entrepot({ produit } = {}, workspaceId) {
  const entrepots = await mesEntrepots(workspaceId);
  if (!entrepots.length) return { a_un_entrepot: false, reponse_humaine: "Tu n'as pas d'entrepôt dans Miyo." };
  const ids = entrepots.map((e) => e.id_entrepot);
  const [produits] = await pool.query(
    `SELECT pe.id_produit_entrepot, pe.id_entrepot, pe.nom, pe.quantite_stock, pe.quantite_minimale,
            pe.emplacement, pe.rayon, pe.etagere,
            m.nom AS marque_nom, md.nom AS modele_nom, u.nom AS unite_nom, u.symbole AS unite_symbole
       FROM produits_entrepot pe
       LEFT JOIN marques m ON m.id_marque = pe.id_marque
       LEFT JOIN modeles md ON md.id_modele = pe.id_modele
       LEFT JOIN unites u ON u.id_unite = pe.id_unite
      WHERE pe.id_entrepot IN (?) AND pe.actif = TRUE`,
    [ids]
  );
  const nomEntrepot = new Map(entrepots.map((e) => [e.id_entrepot, e.nom]));

  // Un produit précis : où et combien
  if (produit && String(produit).trim()) {
    const dit = String(produit).trim();
    const classes = produits.map((p) => ({ p, s: score(dit, p) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
    if (!classes.length) return { produit_demande: dit, trouve: false, reponse_humaine: `Je ne trouve pas ${dit} à l'entrepôt.` };
    const meilleurs = classes.filter((x) => x.s >= classes[0].s - 0.05).slice(0, 4).map((x) => x.p);
    const [uvs] = await pool.query(
      'SELECT id_produit_entrepot, nom, quantite_base FROM unites_vente_entrepot WHERE id_produit_entrepot IN (?) AND actif = TRUE',
      [meilleurs.map((p) => p.id_produit_entrepot)]
    );
    const resultats = meilleurs.map((p) => {
      const unites = uvs.filter((u) => u.id_produit_entrepot === p.id_produit_entrepot).map((u) => ({ nom: u.nom, quantite_base: num(u.quantite_base) }));
      const uniteBase = p.unite_nom || 'unité';
      const stock = num(p.quantite_stock);
      const rangement = [p.emplacement, p.rayon, p.etagere].filter(Boolean).join(', ');
      return {
        nom: p.nom,
        entrepot: nomEntrepot.get(p.id_entrepot),
        stock_en_unite_de_base: stock,
        unite_base: uniteBase,
        reponse_humaine: stock > 0
          ? `${p.nom} : ${enConditionnements(stock, uniteBase, unites)} à l'entrepôt ${nomEntrepot.get(p.id_entrepot)}${rangement ? ` (${rangement})` : ''}.`
          : `Plus de ${p.nom} à l'entrepôt ${nomEntrepot.get(p.id_entrepot)}.`,
        stock_bas: stock <= num(p.quantite_minimale),
      };
    });
    return { trouve: true, produits: resultats };
  }

  // Résumé de chaque entrepôt
  const resume = entrepots.map((e) => {
    const liste = produits.filter((p) => p.id_entrepot === e.id_entrepot);
    const rupture = liste.filter((p) => num(p.quantite_stock) <= 0);
    const bas = liste.filter((p) => num(p.quantite_stock) > 0 && num(p.quantite_stock) <= num(p.quantite_minimale));
    return {
      entrepot: e.nom,
      je_suis: e.role_membre === 'proprietaire' ? 'propriétaire' : 'membre',
      nombre_produits: liste.length,
      en_rupture: rupture.length,
      stock_bas: bas.length,
      exemples_rupture: rupture.slice(0, 3).map((p) => p.nom),
      exemples_stock_bas: bas.slice(0, 3).map((p) => p.nom),
    };
  });
  return {
    entrepots: resume,
    reponse_humaine: resume.map((r) => `Entrepôt ${r.entrepot} : ${r.nombre_produits} produits, ${r.en_rupture} en rupture, ${r.stock_bas} presque finis.`).join(' '),
  };
}

// ============================================================
// TRANSFERTS ENTREPÔT → BOUTIQUE
// ============================================================
const ETATS_TRANSFERT = { en_attente: 'en attente de validation', valide: 'validé, arrivé en boutique', refuse: 'refusé', annule: 'annulé' };

export async function transferts_en_cours({ jours = 7 } = {}, workspaceId) {
  const nbJours = Math.min(Math.max(parseInt(jours, 10) || 7, 1), 60);
  const regrouper = (rows) => {
    const lots = new Map();
    for (const t of rows) {
      const cle = t.numero_lot || t.numero_transfert;
      if (!lots.has(cle)) lots.set(cle, { bon: cle, entrepot: t.entrepot_nom, date: jourCourt(t.date_transfert), etat: ETATS_TRANSFERT[t.statut] || t.statut, motif_refus: t.motif_refus || null, produits: [] });
      const qte = num(t.quantite_saisie) || num(t.quantite);
      lots.get(cle).produits.push(`${qte} ${t.quantite_saisie ? t.nom_unite_vente : 'unité(s)'} de ${t.produit}`);
    }
    return [...lots.values()];
  };

  // Ce que la boutique a demandé à l'entrepôt
  const [demandes] = await pool.query(
    `SELECT t.numero_transfert, t.numero_lot, t.statut, t.date_transfert, t.quantite, t.quantite_saisie, t.nom_unite_vente,
            t.motif_refus, pe.nom AS produit, e.nom AS entrepot_nom
       FROM transferts_stock t
       JOIN produits_entrepot pe ON pe.id_produit_entrepot = t.id_produit_entrepot
       JOIN entrepots e ON e.id_entrepot = t.id_entrepot_source
      WHERE t.id_utilisateur_destination = ?
        AND (t.statut = 'en_attente' OR t.date_creation >= DATE_SUB(NOW(), INTERVAL ? DAY))
      ORDER BY t.date_creation DESC
      LIMIT 80`,
    [workspaceId, nbJours]
  );
  // Demandes que je dois valider, pour les entrepôts dont je suis propriétaire
  const [aValider] = await pool.query(
    `SELECT t.numero_transfert, t.numero_lot, t.statut, t.date_transfert, t.quantite, t.quantite_saisie, t.nom_unite_vente,
            t.motif_refus, pe.nom AS produit, e.nom AS entrepot_nom, u.fullname AS demandeur
       FROM transferts_stock t
       JOIN produits_entrepot pe ON pe.id_produit_entrepot = t.id_produit_entrepot
       JOIN entrepots e ON e.id_entrepot = t.id_entrepot_source AND e.id_utilisateur_proprietaire = ?
       LEFT JOIN utilisateurs u ON u.id_utilisateur = t.id_utilisateur_destination
      WHERE t.statut = 'en_attente' AND t.id_utilisateur_destination <> ?
      ORDER BY t.date_creation DESC
      LIMIT 80`,
    [workspaceId, workspaceId]
  );

  const mesBons = regrouper(demandes);
  const attente = mesBons.filter((b) => b.etat === ETATS_TRANSFERT.en_attente);
  const aValiderBons = regrouper(aValider).map((b, i) => ({ ...b, demande_par: aValider.find((t) => (t.numero_lot || t.numero_transfert) === b.bon)?.demandeur || null }));
  const morceaux = [];
  if (attente.length) morceaux.push(`${attente.length} transfert${attente.length > 1 ? 's' : ''} en route ou en attente vers ta boutique`);
  if (aValiderBons.length) morceaux.push(`${aValiderBons.length} demande${aValiderBons.length > 1 ? 's' : ''} à valider pour ton entrepôt`);
  return {
    vers_ma_boutique: mesBons.slice(0, 8),
    en_attente_vers_ma_boutique: attente.length,
    demandes_a_valider: aValiderBons.slice(0, 8),
    reponse_humaine: morceaux.length ? `${morceaux.join(', et ')}.` : `Aucun transfert en attente. ${mesBons.length ? `Le dernier est ${mesBons[0].etat}.` : ''}`.trim(),
  };
}

// ============================================================
// CLIENTS À RELANCER (même liste que l'écran Relances)
// Priorité : en retard de paiement et pas relancé depuis quelques jours
// ============================================================
export async function clients_a_relancer({ limite = 5 } = {}, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite, 10) || 5, 1), 15);
  const { clients, totaux } = await RelanceClient.liste(workspaceId);
  const maintenant = Date.now();
  const joursDepuis = (d) => (d ? Math.floor((maintenant - new Date(d).getTime()) / 86400000) : null);
  const liste = clients.map((c) => {
    const depuisRelance = joursDepuis(c.derniere_relance);
    return {
      client: c.nomclient || c.telephone,
      telephone: c.telephone,
      doit: num(c.total_du),
      en_retard: num(c.du_en_retard),
      jours_de_retard: c.jours_retard,
      deja_relance: c.nb_relances,
      derniere_relance_il_y_a_jours: depuisRelance,
      relance_par: c.dernier_par,
      // à relancer : en retard, et pas relancé ces 3 derniers jours
      a_relancer_maintenant: num(c.du_en_retard) > 0.009 && (depuisRelance === null || depuisRelance >= 3),
    };
  });
  const prioritaires = liste.filter((c) => c.a_relancer_maintenant).sort((a, b) => b.en_retard - a.en_retard || b.jours_de_retard - a.jours_de_retard);
  return {
    a_relancer: prioritaires.slice(0, limit),
    nombre_a_relancer: prioritaires.length,
    nombre_clients_qui_doivent: totaux.nb_clients,
    total_en_retard: num(totaux.du_en_retard),
    sans_telephone: totaux.sans_telephone,
    conseil: "L'écran Relances prépare le message WhatsApp ou SMS en un geste.",
    reponse_humaine: prioritaires.length
      ? `${prioritaires.length} client${prioritaires.length > 1 ? 's' : ''} à relancer. D'abord ${prioritaires[0].client}, ${fcfa(prioritaires[0].en_retard)} en retard depuis ${prioritaires[0].jours_de_retard} jour${prioritaires[0].jours_de_retard > 1 ? 's' : ''}.`
      : totaux.nb_clients ? 'Personne à relancer aujourd\'hui : les retards ont déjà été relancés récemment.' : 'Personne ne te doit d\'argent.',
  };
}
