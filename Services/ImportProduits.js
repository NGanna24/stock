// Services/ImportProduits.js
// ============================================================
// FICHE PRODUITS EXCEL : le formulaire « Nouveau produit » en tableau
//   1. modeleExcel()   : le fichier à remplir, avec les mêmes champs que le
//      formulaire (fiche, prix, carton et gros, stock, emplacement) et les
//      listes de la boutique en menus déroulants
//   2. lireClasseur()  : lit le fichier (ce modèle, ou l'ancienne fiche de relevé)
//   3. analyser()      : vérifie chaque ligne avec les règles du formulaire
//   4. importer()      : crée tous les produits d'un coup (tout ou rien)
// Rien n'est enregistré avant importer().
// ============================================================
import ExcelJS from 'exceljs';
import { pool } from '../config/db.js';
import EmplacementMagasin from '../models/EmplacementMagasin.js';

const MAX_LIGNES = 3000;
const LIGNES_MODELE = 500;

// ------------------------------------------------------------
// Outils
// ------------------------------------------------------------
const normaliser = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();

const propre = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const texte = (s, max) => propre(s).slice(0, max) || null;

// Valeur d'une cellule ExcelJS en texte ou nombre simple
const valeurCellule = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return valeurCellule(v.result); // formule
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text; // lien
    return null;
  }
  return v;
};

// « 1 400 », « 1400 F », « 1.400 », « 2,5 » → nombre ; vide → null ; illisible → NaN
export const nombre = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let t = String(v).toLowerCase().replace(/fcfa|cfa|f\b|francs?/g, '').replace(/[\s  ]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 1.400 = mille quatre cents
  t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

// ------------------------------------------------------------
// Colonnes : celles du formulaire produit
// ------------------------------------------------------------
export const LIBELLES = {
  nom: 'Nom',
  fournisseur: 'Fournisseur',
  categorie: 'Catégorie',
  marque: 'Marque',
  modele: 'Modèle',
  description: 'Description',
  unite: 'Unité de base',
  prix_achat: "Prix d'achat (unité)",
  prix_vente: 'Prix de vente (unité)',
  pieces_par_carton: 'Pièces dans 1 carton',
  prix_achat_carton: "Prix d'achat d'un carton",
  prix_vente_carton: "Prix de vente d'un carton",
  prix_gros: 'Prix de vente en gros (unité)',
  stock_pieces: 'Stock (unités)',
  stock_cartons: 'Stock (cartons)',
  quantite_minimale: 'Stock minimum',
  quantite_maximale: 'Stock maximum',
  emplacement: 'Emplacement',
  rayon: 'Rayon',
  etagere: 'Étagère',
};
// Unités de vente du formulaire (jusqu'à 3 dans la fiche)
const NB_UNITES_VENTE = 3;
for (let k = 1; k <= NB_UNITES_VENTE; k++) {
  LIBELLES[`uv${k}_nom`] = `Unité de vente ${k} : nom`;
  LIBELLES[`uv${k}_qte`] = `Unité de vente ${k} : qté de base`;
  LIBELLES[`uv${k}_pa`] = `Unité de vente ${k} : prix d'achat`;
  LIBELLES[`uv${k}_pv`] = `Unité de vente ${k} : prix de vente`;
}

const NOMBRES = ['prix_achat', 'prix_vente', 'pieces_par_carton', 'prix_achat_carton', 'prix_vente_carton', 'prix_gros',
  'stock_pieces', 'stock_cartons', 'quantite_minimale', 'quantite_maximale',
  ...Array.from({ length: NB_UNITES_VENTE }, (_, i) => [`uv${i + 1}_qte`, `uv${i + 1}_pa`, `uv${i + 1}_pv`]).flat()];

// Colonne placée sous un titre de groupe « UNITÉ DE VENTE n » (fiche calquée sur le formulaire)
function champDansGroupe(groupe, titre) {
  const m = normaliser(groupe).match(/unite de vente (\d)/);
  if (!m || Number(m[1]) > NB_UNITES_VENTE) return undefined;
  const t = normaliser(titre);
  if (!t) return null;
  if (t.includes('achat')) return `uv${m[1]}_pa`;
  if (t.includes('vente')) return `uv${m[1]}_pv`;
  if (t.includes('qte') || t.includes('quantite') || t.includes('base')) return `uv${m[1]}_qte`;
  if (t.includes('nom')) return `uv${m[1]}_nom`;
  return null;
}

// Reconnaît une colonne par son titre (nouveau modèle et ancienne fiche de relevé)
function champDe(titre) {
  const t = normaliser(titre);
  if (!t) return null;
  const a = (...mots) => mots.every((m) => t.includes(m));
  if (a('prix', 'achat') && a('carton')) return 'prix_achat_carton';
  if (a('prix', 'vente') && a('carton')) return 'prix_vente_carton';
  if (a('prix', 'vente') && a('gros')) return 'prix_gros';
  if (a('prix', 'achat')) return 'prix_achat';
  if (a('prix', 'vente')) return 'prix_vente';
  if (a('carton') && (a('nbr') || a('nombre') || a('piece') || a('contenance') || a('dans'))) return 'pieces_par_carton';
  if (a('minimum') || a('min') || a('alerte') || a('seuil')) return 'quantite_minimale';
  if (a('maximum') || a('max')) return 'quantite_maximale';
  if (a('stock') && a('carton')) return 'stock_cartons';
  if (a('stock') || a('quantite')) return 'stock_pieces';
  if (a('fournisseur')) return 'fournisseur';
  if (t === 'mq' || a('marque')) return 'marque';
  if (a('model')) return 'modele';
  if (a('categorie') || t === 'famille') return 'categorie';
  if (a('description') || a('compatibilite') || t === 'note' || t === 'notes') return 'description';
  if (a('unite')) return 'unite';
  if (a('etagere')) return 'etagere';
  if (a('rayon')) return 'rayon';
  if (a('emplacement') || t === 'zone') return 'emplacement';
  if (t === 'nom' || a('nom') || a('designation') || a('produit') || a('article') || a('libelle')) return 'nom';
  return null;
}

// Cellule fusionnée qui recopie la valeur d'une autre (titre de groupe) : à ignorer
const copieDeFusion = (cell) => cell.isMerged && cell.master && cell.master.address !== cell.address;

/**
 * Lit le classeur : la première feuille visible qui contient une colonne « Nom ».
 * @returns {{ lignes: object[], colonnes: object, ignorees: string[], feuille: string }}
 */
export async function lireClasseur(buffer) {
  let wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    // Certains tableurs enregistrent les notes de cellule d'une façon qu'ExcelJS ne lit pas :
    // on réessaie sans les notes (elles ne servent pas à l'import)
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(buffer);
      for (const nom of Object.keys(zip.files)) {
        if (/comments|vmlDrawing|commentsDrawing|threadedComments|persons/i.test(nom)) zip.remove(nom);
        else if (/_rels\/sheet\d+\.xml\.rels$/.test(nom)) {
          const rels = await zip.file(nom).async('string');
          zip.file(nom, rels.replace(/<Relationship [^>]*(comments|vmlDrawing|threadedComment)[^>]*\/>/gi, ''));
        } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(nom)) {
          const xml = await zip.file(nom).async('string');
          zip.file(nom, xml.replace(/<legacyDrawing [^>]*\/>/g, ''));
        }
      }
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }));
    } catch {
      throw Object.assign(new Error("Ce fichier n'est pas un fichier Excel (.xlsx) lisible. Enregistre-le en .xlsx puis réessaie."), { status: 400 });
    }
  }

  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') continue; // feuille cachée des listes
    let ligneTitres = null;
    let colonnes = null;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const trouve = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
        if (copieDeFusion(cell)) return;
        // Titre de groupe juste au-dessus (cellules fusionnées) : « UNITÉ DE VENTE 1 », etc.
        const dessus = r > 1 ? ws.getRow(r - 1).getCell(c) : null;
        const groupe = dessus ? valeurCellule((dessus.isMerged && dessus.master ? dessus.master : dessus).value) : null;
        const dansGroupe = champDansGroupe(groupe, valeurCellule(cell.value));
        const champ = dansGroupe !== undefined ? dansGroupe : champDe(valeurCellule(cell.value));
        if (champ && !(champ in trouve)) trouve[champ] = c;
      });
      // La ligne de titres est celle qui reconnaît le plus de colonnes (dont « Nom »)
      if ('nom' in trouve && (!colonnes || Object.keys(trouve).length > Object.keys(colonnes).length)) {
        ligneTitres = r;
        colonnes = trouve;
      }
    }
    if (!colonnes) continue;

    // Ancienne fiche : « STOCK INITIAL » fusionné sur deux colonnes (pièces, puis cartons)
    if (colonnes.stock_pieces && !colonnes.stock_cartons) {
      const c = colonnes.stock_pieces;
      const voisine = ws.getRow(ligneTitres).getCell(c + 1);
      const fusion = voisine.isMerged && voisine.master?.address === ws.getRow(ligneTitres).getCell(c).address;
      const sousTitre = normaliser(valeurCellule(ws.getRow(ligneTitres + 1).getCell(c + 1).value));
      if (fusion || sousTitre.includes('carton')) colonnes.stock_cartons = c + 1;
    }

    const ignorees = [];
    const utilisees = new Set(Object.values(colonnes));
    ws.getRow(ligneTitres).eachCell({ includeEmpty: false }, (cell, c) => {
      if (copieDeFusion(cell)) return;
      const t = propre(valeurCellule(cell.value));
      if (t && !utilisees.has(c) && !/^n\s*°|^no?$|^num/i.test(t)) ignorees.push(t);
    });

    const lignes = [];
    const fin = Math.min(ws.rowCount, ligneTitres + MAX_LIGNES + 1);
    for (let r = ligneTitres + 1; r <= fin; r++) {
      const row = ws.getRow(r);
      const celluleNom = row.getCell(colonnes.nom);
      if (celluleNom.isMerged && celluleNom.master && Number(celluleNom.master.row) <= ligneTitres) continue;
      const brut = {};
      for (const [champ, c] of Object.entries(colonnes)) brut[champ] = valeurCellule(row.getCell(c).value);
      const nom = propre(brut.nom);
      if (!nom || /^exemple\s*:/i.test(nom)) continue; // ligne vide ou ligne d'exemple du modèle
      lignes.push({ ligne_excel: r, ...brut, nom });
    }
    if (ws.rowCount > fin) {
      throw Object.assign(new Error(`Le fichier dépasse ${MAX_LIGNES} produits. Coupe-le en plusieurs fichiers.`), { status: 400 });
    }
    return { lignes, colonnes: Object.fromEntries(Object.keys(colonnes).map((k) => [k, LIBELLES[k]])), ignorees, feuille: ws.name };
  }
  throw Object.assign(
    new Error('Aucune colonne « Nom » trouvée dans le fichier. Télécharge la fiche produits Miyo et remplis-la.'),
    { status: 400 }
  );
}

// ------------------------------------------------------------
// Vérification ligne par ligne (règles du formulaire)
// ------------------------------------------------------------
const cle = (nom, modele, marque) => [normaliser(nom), normaliser(modele), normaliser(marque)].join('|');

// Distance d'édition (nombre de lettres à changer) entre deux mots
function distance(a, b) {
  if (a === b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prec = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = tmp;
    }
  }
  return d[b.length];
}
// « Pices » ~ « Pieces », « Moteur1 » ~ « Moteur », « NEO 125 » ~ « NEO125 »
const ressemble = (x, y) => {
  const a = normaliser(x).replace(/\s+/g, '');
  const b = normaliser(y).replace(/\s+/g, '');
  // « GN125+ » et « GN125++ » : tailles différentes, pas une faute de frappe
  if (a.replace(/\+/g, '') === b.replace(/\+/g, '') && a !== b) return false;
  if (!a || !b || a === b) return a === b && a !== '' && normaliser(x) !== normaliser(y);
  const max = Math.min(a.length, b.length) <= 5 ? 1 : 2;
  return distance(a, b) <= max;
};

async function nomsExistants(workspaceId) {
  const originaux = {};
  const lire = async (cle, sql) => {
    const noms = (await pool.execute(sql, [workspaceId]))[0].map((r) => propre(r.nom)).filter(Boolean);
    originaux[cle] = new Set(noms);
    return new Set(noms.map(normaliser));
  };
  return {
    fournisseurs: await lire('fournisseurs', 'SELECT nom FROM fournisseurs WHERE id_utilisateur = ?'),
    unites: await lire('unites', 'SELECT nom FROM unites WHERE id_utilisateur = ?'),
    marques: await lire('marques', 'SELECT nom FROM marques WHERE id_utilisateur = ?'),
    modeles: await lire('modeles', 'SELECT nom FROM modeles WHERE id_utilisateur = ?'),
    categories: await lire('categories', 'SELECT nom FROM categories WHERE id_utilisateur = ?'),
    emplacements: await lire('emplacements', 'SELECT nom FROM emplacements_magasin WHERE id_utilisateur = ? AND id_entrepot IS NULL'),
    originaux,
  };
}

/**
 * Vérifie chaque ligne. etat : 'pret' | 'attention' | 'erreur' | 'existe'
 * Les lignes « attention » s'importent quand même (le message dit ce qui manque).
 * Fournisseur ou unité vides : on prendra ceux choisis à l'écran (par défaut).
 */
export async function analyser(lignesBrutes, workspaceId, { mettreAJour = false } = {}) {
  const [existants] = await pool.execute(
    `SELECT p.id_produit, p.nom, md.nom AS modele, m.nom AS marque, p.prix_achat, p.prix_vente
       FROM produits p
       LEFT JOIN modeles md ON p.id_modele = md.id_modele
       LEFT JOIN marques m ON p.id_marque = m.id_marque
      WHERE p.id_utilisateur = ?`,
    [workspaceId]
  );
  const dejaLa = new Map(existants.map((p) => [cle(p.nom, p.modele, p.marque), p]));
  // Cartons déjà enregistrés (pour savoir ce qu'une mise à jour changerait)
  const cartons = new Map();
  if (mettreAJour && existants.length) {
    const [uv] = await pool.execute(
      `SELECT uv.id_produit, uv.quantite_base, uv.prix_vente, uv.prix_achat, uv.nom
         FROM unites_vente uv JOIN produits p ON p.id_produit = uv.id_produit
        WHERE p.id_utilisateur = ? AND uv.actif = TRUE`,
      [workspaceId]
    );
    for (const u of uv) if (normaliser(u.nom) === 'carton') cartons.set(u.id_produit, u);
  }
  const vus = new Map();

  // Même produit écrit deux fois dans le fichier (relevé papier recopié deux fois) :
  //  - informations identiques, ou une ligne qui complète l'autre : on fusionne dans la 1re ligne
  //    et la seconde est simplement ignorée ;
  //  - informations différentes (ex : carton de 100 et carton de 20) : erreur, l'utilisateur choisit.
  const brutes = (Array.isArray(lignesBrutes) ? lignesBrutes : []).slice(0, MAX_LIGNES).map((b) => ({ ...b }));
  const CHAMPS_TEXTE = ['fournisseur', 'categorie', 'description', 'unite', 'emplacement', 'rayon', 'etagere'];
  const vide = (v) => v === null || v === undefined || propre(v) === '';
  const premieres = new Map();
  for (const [i, b] of brutes.entries()) {
    const k = cle(texte(b.nom, 100), texte(b.modele, 100), texte(b.marque, 100));
    if (!normaliser(b.nom)) continue;
    const premiere = premieres.get(k);
    if (!premiere) { premieres.set(k, b); continue; }
    const differences = [];
    for (const champ of [...NOMBRES, ...CHAMPS_TEXTE]) {
      if (vide(b[champ])) continue;
      if (vide(premiere[champ])) continue;
      const egal = NOMBRES.includes(champ)
        ? nombre(b[champ]) === nombre(premiere[champ])
        : normaliser(b[champ]) === normaliser(premiere[champ]);
      if (!egal) differences.push(LIBELLES[champ]);
    }
    const lignePremiere = premiere.ligne_excel || brutes.indexOf(premiere) + 2;
    if (differences.length) {
      b._conflit = { ligne: lignePremiere, champs: differences };
    } else {
      // Complète la 1re ligne avec ce qu'elle n'avait pas
      for (const champ of [...NOMBRES, ...CHAMPS_TEXTE]) if (vide(premiere[champ]) && !vide(b[champ])) premiere[champ] = b[champ];
      b._doublon = lignePremiere;
    }
    void i;
  }

  const lignes = brutes.map((b, i) => {
    const erreurs = [];
    const alertes = [];
    const l = {
      ligne_excel: b.ligne_excel || null,
      nom: texte(b.nom, 100),
      fournisseur: texte(b.fournisseur, 200),
      categorie: texte(b.categorie, 100),
      marque: texte(b.marque, 100),
      modele: texte(b.modele, 100),
      description: texte(b.description, 500),
      unite: texte(b.unite, 50),
      emplacement: texte(b.emplacement, 100),
      rayon: texte(b.rayon, 100),
      etagere: texte(b.etagere, 100),
    };

    const n = {};
    const illisible = new Set();
    for (const champ of NOMBRES) {
      const v = nombre(b[champ]);
      if (Number.isNaN(v)) {
        erreurs.push(`${LIBELLES[champ]} illisible : « ${propre(b[champ]).slice(0, 30)} ».`);
        illisible.add(champ);
        n[champ] = null;
      } else if (v !== null && v < 0) {
        erreurs.push(`${LIBELLES[champ]} négatif.`);
        n[champ] = null;
      } else n[champ] = v;
    }

    if (!l.nom) erreurs.push('Nom manquant.');

    // Ancienne fiche : ligne d'exemple remplie en gardant ses valeurs (prix, stock, emplacement)
    const valeursExemple = [[n.prix_achat, 6000], [n.prix_vente, 8500], [n.prix_gros, 8000], [n.pieces_par_carton, 10],
      [n.prix_achat_carton, 55000], [n.prix_vente_carton, 75000], [n.stock_pieces, 4], [n.stock_cartons, 2],
      [n.quantite_minimale, 5], [n.quantite_maximale, 40]].filter(([v, e]) => v === e).length;
    if (valeursExemple >= 5 || (normaliser(b.emplacement) === 'boutique' && normaliser(b.rayon) === 'rayon a' && valeursExemple >= 3)) {
      alertes.push("Cette ligne garde les valeurs de l'exemple (prix 6 000 / 8 500, stock 4 + 2 cartons, Rayon A…) : remplace-les par les vraies.");
    }

    // Carton : comme dans le formulaire, il faut sa quantité (pièces) et son prix de vente
    let pieces = n.pieces_par_carton !== null ? Math.round(n.pieces_par_carton) : null;
    const aCarton = n.prix_vente_carton > 0 || n.prix_achat_carton > 0 || n.stock_cartons > 0;
    if (aCarton && pieces === 1) {
      // « 1 pièce par carton » (bidon de 20 L…) : ce n'est pas un carton, le produit se vend à l'unité
      alertes.push('1 pièce par carton : pas de carton créé, le produit se vend à l\'unité.');
      pieces = null;
      n.prix_vente_carton = null;
      n.prix_achat_carton = null;
      n.stock_cartons = null;
    } else if (aCarton && !(pieces > 1)) {
      erreurs.push('Indique combien de pièces contient 1 carton, sinon Miyo ne peut pas compter les cartons.');
    }
    if (pieces > 1 && !(n.prix_vente_carton > 0) && (n.prix_achat_carton > 0 || n.stock_cartons > 0)) {
      alertes.push('Prix de vente du carton manquant : le carton ne sera pas proposé à la vente (le stock en cartons est bien compté).');
    }

    // Unités de vente : mêmes règles que le formulaire (nom, quantité de base > 0, prix de vente > 0)
    const unitesVente = [];
    for (let k = 1; k <= NB_UNITES_VENTE; k++) {
      const nomUV = texte(b[`uv${k}_nom`], 50);
      const [qte, pa, pv] = [n[`uv${k}_qte`], n[`uv${k}_pa`], n[`uv${k}_pv`]];
      if (!nomUV && !qte && !pa && !pv) continue;
      const libelle = nomUV ? `« ${nomUV} »` : `l'unité de vente ${k}`;
      if (!nomUV) erreurs.push(`Unité de vente ${k} : donne-lui un nom (ex : Carton).`);
      if (!(qte > 0)) erreurs.push(`La quantité de base de ${libelle} doit être supérieure à 0.`);
      if (!(pv > 0)) erreurs.push(`Le prix de vente de ${libelle} doit être supérieur à 0.`);
      if (nomUV && qte > 0 && pv > 0) {
        unitesVente.push({ nom: nomUV, quantite_base: qte, prix_vente: pv, prix_achat: pa || (n.prix_achat || 0) * qte });
      }
    }
    // Ancienne fiche : carton et prix de gros deviennent des unités de vente
    if (pieces > 1 && n.prix_vente_carton > 0) {
      unitesVente.push({ nom: 'Carton', quantite_base: pieces, prix_vente: n.prix_vente_carton,
        prix_achat: n.prix_achat_carton || (n.prix_achat || 0) * pieces, auto: true });
    }
    if (n.prix_gros > 0) unitesVente.push({ nom: 'Gros', quantite_base: 1, prix_vente: n.prix_gros, prix_achat: n.prix_achat || 0, auto: true });
    const nomsUV = unitesVente.map((u) => normaliser(u.nom));
    if (new Set(nomsUV).size < nomsUV.length) erreurs.push('Deux unités de vente portent le même nom.');

    if (!(n.prix_vente > 0) && !illisible.has('prix_vente')) alertes.push('Prix de vente manquant : à compléter avant de vendre.');
    if (!(n.prix_achat > 0) && !illisible.has('prix_achat')) alertes.push("Prix d'achat manquant : les bénéfices seront faux.");
    if (n.prix_vente > 0 && n.prix_achat > 0 && n.prix_vente < n.prix_achat) {
      alertes.push(`Vendu moins cher qu'acheté (${n.prix_vente} contre ${n.prix_achat}).`);
    }
    if (n.quantite_minimale > 0 && n.quantite_maximale > 0 && n.quantite_maximale < n.quantite_minimale) {
      alertes.push('Stock maximum plus petit que le stock minimum.');
    }
    if ((l.rayon && !l.emplacement) || (l.etagere && !l.rayon)) {
      erreurs.push('Emplacement incomplet : une étagère va dans un rayon, un rayon dans un emplacement.');
    }

    const stockPieces = Math.max(0, n.stock_pieces || 0);
    const stockCartons = Math.max(0, n.stock_cartons || 0);
    const stockTotal = stockPieces + (pieces > 1 ? stockCartons * pieces : 0);

    let etat = erreurs.length ? 'erreur' : alertes.length ? 'attention' : 'pret';
    const k = cle(l.nom, l.modele, l.marque);
    if (b._conflit) {
      etat = 'erreur';
      erreurs.unshift(`Même produit qu'à la ligne ${b._conflit.ligne}, mais avec des informations différentes (${b._conflit.champs.join(', ')}) : garde une seule ligne dans le fichier.`);
    } else if (b._doublon) {
      return {
        ...l, prix_achat: n.prix_achat || 0, prix_vente: n.prix_vente || 0, prix_gros: 0, pieces_par_carton: null,
        prix_achat_carton: 0, prix_vente_carton: 0, stock_pieces: 0, stock_cartons: 0, stock_total: 0,
        quantite_minimale: 0, quantite_maximale: 0, unites_vente: [], id_produit_existant: null,
        etat: 'doublon',
        messages: [`Même produit qu'à la ligne ${b._doublon}, avec les mêmes informations : ligne ignorée (ses informations sont reprises par la ligne ${b._doublon}).`],
      };
    }
    let id_produit_existant = null;
    let changements = [];
    if (!erreurs.length) {
      if (vus.has(k) && !b._conflit) {
        // Même produit deux fois dans le fichier : on ne choisit pas à la place de l'utilisateur
        etat = 'erreur';
        erreurs.push(`En double dans le fichier (même produit qu'à la ligne ${vus.get(k)}).`);
      } else if (dejaLa.has(k)) {
        const ex = dejaLa.get(k);
        etat = 'existe';
        if (mettreAJour) {
          // On ne remplace jamais une valeur par une case vide
          const cv = (pieces > 1 && n.prix_vente_carton > 0) ? { q: pieces, pv: n.prix_vente_carton, pa: n.prix_achat_carton || (n.prix_achat || 0) * pieces } : null;
          const carton = cartons.get(ex.id_produit);
          if (n.prix_achat > 0 && Number(ex.prix_achat) !== n.prix_achat) changements.push(`prix d'achat ${Number(ex.prix_achat) || 0} → ${n.prix_achat}`);
          if (n.prix_vente > 0 && Number(ex.prix_vente) !== n.prix_vente) changements.push(`prix de vente ${Number(ex.prix_vente) || 0} → ${n.prix_vente}`);
          if (cv && (!carton || Number(carton.quantite_base) !== cv.q || Number(carton.prix_vente) !== cv.pv || Number(carton.prix_achat) !== cv.pa)) {
            changements.push(carton ? `carton ${Number(carton.quantite_base)} pièces à ${Number(carton.prix_vente)} → ${cv.q} pièces à ${cv.pv}` : `carton ajouté : ${cv.q} pièces à ${cv.pv}`);
          }
          if (changements.length) {
            etat = 'maj';
            id_produit_existant = ex.id_produit;
            alertes.unshift(`Déjà dans ta boutique : sera mis à jour (${changements.join(', ')}).`);
          } else alertes.unshift('Déjà dans ta boutique, rien à changer.');
        } else alertes.unshift('Déjà dans ta boutique : ignoré (coche « Mettre à jour les produits déjà présents » pour compléter ses prix).');
      }
    }
    if (l.nom && !vus.has(k)) vus.set(k, b.ligne_excel || i + 2);

    return {
      ...l,
      prix_achat: n.prix_achat || 0,
      prix_vente: n.prix_vente || 0,
      prix_gros: n.prix_gros || 0,
      pieces_par_carton: pieces > 1 ? pieces : null,
      prix_achat_carton: n.prix_achat_carton || 0,
      prix_vente_carton: n.prix_vente_carton || 0,
      stock_pieces: stockPieces,
      stock_cartons: stockCartons,
      stock_total: stockTotal,
      quantite_minimale: n.quantite_minimale || 0,
      quantite_maximale: n.quantite_maximale || 0,
      unites_vente: unitesVente,
      id_produit_existant,
      etat,
      messages: [...erreurs, ...alertes],
    };
  });

  const compte = (e) => lignes.filter((x) => x.etat === e).length;
  const aImporter = lignes.filter((x) => x.etat === 'pret' || x.etat === 'attention');
  const aMettreAJour = lignes.filter((x) => x.etat === 'maj');
  const connus = await nomsExistants(workspaceId);
  const nouveaux = (champ, table) => [
    ...new Map(
      aImporter.map((x) => x[champ]).filter(Boolean).filter((x) => !connus[table].has(normaliser(x))).map((x) => [normaliser(x), x])
    ).values(),
  ];

  // Nom nouveau très proche d'un nom existant (« Pices » / « Pieces ») : sûrement une faute de frappe
  const proches = [];
  const vusProches = new Set();
  for (const [champ, table, mot] of [['fournisseur', 'fournisseurs', 'Fournisseur'], ['unite', 'unites', 'Unité'],
    ['marque', 'marques', 'Marque'], ['modele', 'modeles', 'Modèle'], ['categorie', 'categories', 'Catégorie']]) {
    for (const x of aImporter) {
      const nom = x[champ];
      if (!nom || connus[table].has(normaliser(nom))) continue;
      const proche = [...connus.originaux[table]].find((e) => ressemble(nom, e));
      if (!proche) continue;
      x.messages.push(`${mot} : « ${nom} » n'est pas encore dans Miyo et sera ajouté. Voulais-tu dire « ${proche} » ?`);
      if (x.etat === 'pret') x.etat = 'attention';
      const k = `${champ}|${normaliser(nom)}`;
      if (!vusProches.has(k)) { vusProches.add(k); proches.push(`${mot} « ${nom} » ressemble à « ${proche} »`); }
    }
  }

  return {
    lignes,
    resume: {
      total: lignes.length,
      pret: compte('pret'),
      attention: compte('attention'),
      erreur: compte('erreur'),
      existe: compte('existe'),
      doublon: compte('doublon'),
      maj: aMettreAJour.length,
      a_creer: aImporter.length,
      a_importer: aImporter.length + aMettreAJour.length,
      sans_prix_vente: aImporter.filter((x) => !(x.prix_vente > 0)).length,
      sans_fournisseur: aImporter.filter((x) => !x.fournisseur).length,
      sans_unite: aImporter.filter((x) => !x.unite).length,
      sans_categorie: aImporter.filter((x) => !x.categorie).length,
      noms_proches: proches,
      nouveaux_fournisseurs: nouveaux('fournisseur', 'fournisseurs'),
      nouvelles_unites: nouveaux('unite', 'unites'),
      nouvelles_marques: nouveaux('marque', 'marques'),
      nouveaux_modeles: nouveaux('modele', 'modeles'),
      nouvelles_categories: nouveaux('categorie', 'categories'),
      nouveaux_emplacements: [
        ...new Map(
          aImporter.flatMap((x) => [x.emplacement, x.rayon, x.etagere]).filter(Boolean)
            .filter((x) => !connus.emplacements.has(normaliser(x))).map((x) => [normaliser(x), x])
        ).values(),
      ],
    },
  };
}

// ------------------------------------------------------------
// Import (tout ou rien)
// ------------------------------------------------------------
const symboleDe = (nom) => normaliser(nom).replace(/\s+/g, '').slice(0, 3) || 'u';

export async function importer({ lignes, id_fournisseur, id_unite, id_categorie, categorie_nom, mettre_a_jour = false }, workspaceId) {
  const { lignes: verifiees } = await analyser(lignes, workspaceId, { mettreAJour: mettre_a_jour }); // on revérifie tout ici
  const aCreer = verifiees.filter((l) => l.etat === 'pret' || l.etat === 'attention');
  const aMaj = verifiees.filter((l) => l.etat === 'maj');
  if (!aCreer.length && !aMaj.length) {
    throw Object.assign(new Error('Aucun produit à importer : ils sont tous déjà dans ta boutique, ou en erreur dans le fichier.'), { status: 400 });
  }

  // Valeurs par défaut (choisies à l'écran) pour les lignes sans fournisseur ou sans unité
  const idF = Number(id_fournisseur) || null;
  const idU = Number(id_unite) || null;
  if (aCreer.some((l) => !l.fournisseur) && !idF) {
    throw Object.assign(new Error("Certaines lignes n'ont pas de fournisseur : choisis le fournisseur par défaut."), { status: 400 });
  }
  if (aCreer.some((l) => !l.unite) && !idU) {
    throw Object.assign(new Error("Certaines lignes n'ont pas d'unité : choisis l'unité de base par défaut (par exemple Pièce)."), { status: 400 });
  }
  if (idF) {
    const [[f]] = await pool.execute('SELECT id_fournisseur FROM fournisseurs WHERE id_fournisseur = ? AND id_utilisateur = ?', [idF, workspaceId]);
    if (!f) throw Object.assign(new Error('Fournisseur par défaut introuvable.'), { status: 400 });
  }
  if (idU) {
    const [[u]] = await pool.execute('SELECT id_unite FROM unites WHERE id_unite = ? AND id_utilisateur = ?', [idU, workspaceId]);
    if (!u) throw Object.assign(new Error('Unité par défaut introuvable.'), { status: 400 });
  }
  // Catégorie par défaut (lignes sans catégorie) : une catégorie existante, ou un nom à créer (ex : « Pièce »)
  let idC = Number(id_categorie) || null;
  if (idC) {
    const [[c]] = await pool.execute('SELECT id_categorie FROM categories WHERE id_categorie = ? AND id_utilisateur = ?', [idC, workspaceId]);
    if (!c) throw Object.assign(new Error('Catégorie par défaut introuvable.'), { status: 400 });
  }
  const nomCategorieDefaut = !idC ? texte(categorie_nom, 100) : null;

  const cnx = await pool.getConnection();
  const crees = { fournisseurs: 0, unites: 0, marques: 0, modeles: 0, categories: 0, emplacements: 0 };
  try {
    await cnx.beginTransaction();

    // Reprend ce qui existe déjà (sans tenir compte des majuscules ni des accents), sinon le crée
    const caches = {};
    const idPour = async (table, colId, nom, creer) => {
      if (!nom) return null;
      if (!caches[table]) {
        const [rows] = await cnx.execute(`SELECT ${colId} AS id, nom FROM ${table} WHERE id_utilisateur = ?`, [workspaceId]);
        caches[table] = new Map();
        for (const r of rows) if (!caches[table].has(normaliser(r.nom))) caches[table].set(normaliser(r.nom), r.id);
      }
      const k = normaliser(nom);
      if (caches[table].has(k)) return caches[table].get(k);
      const id = await creer(nom);
      caches[table].set(k, id);
      crees[table]++;
      return id;
    };
    const simple = (table) => async (nom) =>
      (await cnx.execute(`INSERT INTO ${table} (id_utilisateur, nom) VALUES (?, ?)`, [workspaceId, nom]))[0].insertId;
    const creerUnite = async (nom) =>
      (await cnx.execute('INSERT INTO unites (id_utilisateur, nom, symbole) VALUES (?, ?, ?)', [workspaceId, nom, symboleDe(nom)]))[0].insertId;

    // Emplacement > rayon > étagère de la boutique
    const [emps] = await cnx.execute(
      'SELECT id_emplacement, id_parent, niveau, nom FROM emplacements_magasin WHERE id_utilisateur = ? AND id_entrepot IS NULL',
      [workspaceId]
    );
    const cacheEmp = new Map(emps.map((e) => [`${e.id_parent || 0}|${e.niveau}|${normaliser(e.nom)}`, e.id_emplacement]));
    const niveauEmp = async (idParent, niveau, nom) => {
      const k = `${idParent || 0}|${niveau}|${normaliser(nom)}`;
      if (cacheEmp.has(k)) return cacheEmp.get(k);
      const [ins] = await cnx.execute(
        'INSERT INTO emplacements_magasin (id_utilisateur, id_entrepot, id_parent, niveau, nom) VALUES (?, NULL, ?, ?, ?)',
        [workspaceId, idParent || null, niveau, nom]
      );
      cacheEmp.set(k, ins.insertId);
      crees.emplacements++;
      return ins.insertId;
    };

    if (nomCategorieDefaut && aCreer.some((l) => !l.categorie)) {
      idC = await idPour('categories', 'id_categorie', nomCategorieDefaut, simple('categories'));
    }

    let unitesVente = 0;
    let avecEmplacement = false;
    let stocksInitiaux = 0;
    for (const l of aCreer) {
      const idFournisseur = l.fournisseur ? await idPour('fournisseurs', 'id_fournisseur', l.fournisseur, simple('fournisseurs')) : idF;
      const idUnite = l.unite ? await idPour('unites', 'id_unite', l.unite, creerUnite) : idU;
      const idMarque = await idPour('marques', 'id_marque', l.marque, simple('marques'));
      const idModele = await idPour('modeles', 'id_modele', l.modele, simple('modeles'));
      const idCategorie = l.categorie ? await idPour('categories', 'id_categorie', l.categorie, simple('categories')) : idC;

      let idEmp = null;
      if (l.emplacement) {
        idEmp = await niveauEmp(null, 'emplacement', l.emplacement);
        if (l.rayon) idEmp = await niveauEmp(idEmp, 'rayon', l.rayon);
        if (l.rayon && l.etagere) idEmp = await niveauEmp(idEmp, 'etagere', l.etagere);
        avecEmplacement = true;
      }

      const [res] = await cnx.execute(
        `INSERT INTO produits (id_utilisateur, nom, description, id_fournisseur, id_categorie, id_marque, id_modele, id_unite,
                               prix_achat, prix_vente, quantite_stock, quantite_minimale, quantite_maximale,
                               emplacement, rayon, etagere, statut, id_emplacement_magasin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disponible', ?)`,
        [workspaceId, l.nom, l.description || '', idFournisseur, idCategorie, idMarque, idModele, idUnite,
         l.prix_achat, l.prix_vente, l.stock_total, l.quantite_minimale, l.quantite_maximale,
         l.emplacement || '', l.rayon || '', l.etagere || '', idEmp]
      );
      const idProduit = res.insertId;

      // Unités de vente. La principale est celle proposée d'office à la vente : seule une unité
      // saisie dans les colonnes « Unité de vente 1/2/3 » peut l'être (la 1re). Le carton et le
      // gros repris des colonnes CARTON ne le sont jamais : la vente reste à la pièce par défaut.
      for (const [k, u] of (l.unites_vente || []).entries()) {
        await cnx.execute(
          `INSERT INTO unites_vente (id_produit, nom, quantite_base, prix_vente, prix_achat, est_principal, actif)
           VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
          [idProduit, u.nom, u.quantite_base, u.prix_vente, u.prix_achat || 0, k === 0 && !u.auto]
        );
        unitesVente++;
      }

      // Stock de départ : tracé comme une entrée, pour que l'historique du produit soit juste
      if (l.stock_total > 0) {
        await cnx.execute(
          `INSERT INTO mouvements_stock (id_utilisateur, id_produit, type_mouvement, quantite, ancienne_quantite, nouvelle_quantite, type_reference, notes)
           VALUES (?, ?, 'entree', ?, 0, ?, 'import', 'Stock initial (import Excel)')`,
          [workspaceId, idProduit, l.stock_total, l.stock_total]
        );
        stocksInitiaux++;
      }
    }

    // Produits déjà présents : on complète prix et carton, sans jamais effacer une valeur
    let misAJour = 0;
    for (const l of aMaj) {
      const champs = [];
      const valeurs = [];
      if (l.prix_achat > 0) { champs.push('prix_achat = ?'); valeurs.push(l.prix_achat); }
      if (l.prix_vente > 0) { champs.push('prix_vente = ?'); valeurs.push(l.prix_vente); }
      if (champs.length) {
        await cnx.execute(`UPDATE produits SET ${champs.join(', ')} WHERE id_produit = ? AND id_utilisateur = ?`,
          [...valeurs, l.id_produit_existant, workspaceId]);
      }
      const carton = (l.unites_vente || []).find((u) => u.auto && normaliser(u.nom) === 'carton');
      if (carton) {
        const [uvs] = await cnx.execute('SELECT id_unite_vente, nom FROM unites_vente WHERE id_produit = ?', [l.id_produit_existant]);
        const ex = uvs.find((u) => normaliser(u.nom) === 'carton');
        if (ex) {
          await cnx.execute('UPDATE unites_vente SET quantite_base = ?, prix_vente = ?, prix_achat = ?, actif = TRUE WHERE id_unite_vente = ?',
            [carton.quantite_base, carton.prix_vente, carton.prix_achat || 0, ex.id_unite_vente]);
        } else {
          await cnx.execute(
            `INSERT INTO unites_vente (id_produit, nom, quantite_base, prix_vente, prix_achat, est_principal, actif)
             VALUES (?, 'Carton', ?, ?, ?, FALSE, TRUE)`,
            [l.id_produit_existant, carton.quantite_base, carton.prix_vente, carton.prix_achat || 0]
          );
          unitesVente++;
        }
      }
      misAJour++;
    }

    await cnx.commit();
    if (avecEmplacement) await EmplacementMagasin.synchroniser(workspaceId).catch(() => {});
    return {
      crees: aCreer.length,
      mis_a_jour: misAJour,
      stocks_initiaux: stocksInitiaux,
      ignores: verifiees.length - aCreer.length - misAJour,
      unites_vente: unitesVente,
      sans_prix_vente: aCreer.filter((l) => !(l.prix_vente > 0)).length,
      nouveaux: crees,
    };
  } catch (e) {
    await cnx.rollback();
    throw e;
  } finally {
    cnx.release();
  }
}

// ------------------------------------------------------------
// La fiche produits à remplir (mêmes champs que le formulaire)
// ------------------------------------------------------------
// Groupes = les blocs du formulaire « Nouveau produit », dans le même ordre et avec les mêmes noms
const G_INFOS = 'ÉTAPE 1 · INFORMATIONS GÉNÉRALES';
const G_PRIX = 'PRIX (FCFA)';
const G_QTES = 'ÉTAPE 2 · QUANTITÉS';
const G_EMP = 'EMPLACEMENT EN MAGASIN';
const COLONNES_MODELE = [
  // [groupe, titre, largeur, liste déroulante, nombre]
  ['', 'N°', 6],
  [G_INFOS, 'Fournisseur *', 20, 'fournisseurs'],
  [G_INFOS, 'Nom du produit *', 30],
  [G_INFOS, 'Description', 24],
  [G_INFOS, 'Catégorie', 16, 'categories'],
  [G_INFOS, 'Marque', 14, 'marques'],
  [G_INFOS, 'Modèle', 14, 'modeles'],
  [G_INFOS, 'Unité de base *', 14, 'unites'],
  [G_PRIX, "Prix d'achat", 13, null, true],
  [G_PRIX, 'Prix de vente', 13, null, true],
  ...Array.from({ length: NB_UNITES_VENTE }, (_, i) => [
    [`UNITÉ DE VENTE ${i + 1}`, 'Nom', 13],
    [`UNITÉ DE VENTE ${i + 1}`, 'Qté de base', 11, null, true],
    [`UNITÉ DE VENTE ${i + 1}`, "Prix d'achat", 13, null, true],
    [`UNITÉ DE VENTE ${i + 1}`, 'Prix de vente', 13, null, true],
  ]).flat(),
  [G_QTES, 'Stock actuel', 12, null, true],
  [G_QTES, 'Stock minimum', 12, null, true],
  [G_QTES, 'Stock maximum', 12, null, true],
  [G_EMP, 'Emplacement', 14, 'emplacements'],
  [G_EMP, 'Rayon', 12, 'rayons'],
  [G_EMP, 'Étagère', 12, 'etageres'],
];

const COULEURS_GROUPES = {
  '': 'FF1F2937',
  [G_INFOS]: 'FF1F2937',
  [G_PRIX]: 'FFC2410C',
  'UNITÉ DE VENTE 1': 'FF44403C',
  'UNITÉ DE VENTE 2': 'FF57534E',
  'UNITÉ DE VENTE 3': 'FF44403C',
  [G_QTES]: 'FF374151',
  [G_EMP]: 'FF57534E',
};

const lettre = (n) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export async function modeleExcel(workspaceId) {
  // Listes de la boutique (menus déroulants)
  const lire = async (sql) => (await pool.execute(sql, [workspaceId]))[0].map((r) => propre(r.nom)).filter(Boolean);
  const listes = workspaceId
    ? {
        fournisseurs: await lire('SELECT nom FROM fournisseurs WHERE id_utilisateur = ? AND actif = TRUE ORDER BY nom'),
        categories: await lire('SELECT nom FROM categories WHERE id_utilisateur = ? ORDER BY nom'),
        marques: await lire('SELECT nom FROM marques WHERE id_utilisateur = ? ORDER BY nom'),
        modeles: await lire('SELECT DISTINCT nom FROM modeles WHERE id_utilisateur = ? ORDER BY nom'),
        unites: await lire('SELECT nom FROM unites WHERE id_utilisateur = ? ORDER BY nom'),
        emplacements: await lire("SELECT DISTINCT nom FROM emplacements_magasin WHERE id_utilisateur = ? AND id_entrepot IS NULL AND niveau = 'emplacement' ORDER BY nom"),
        rayons: await lire("SELECT DISTINCT nom FROM emplacements_magasin WHERE id_utilisateur = ? AND id_entrepot IS NULL AND niveau = 'rayon' ORDER BY nom"),
        etageres: await lire("SELECT DISTINCT nom FROM emplacements_magasin WHERE id_utilisateur = ? AND id_entrepot IS NULL AND niveau = 'etagere' ORDER BY nom"),
      }
    : {};

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Miyo';
  const ws = wb.addWorksheet('Produits', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });

  // Ligne 1 : groupes (comme les étapes du formulaire) ; ligne 2 : champs
  ws.addRow(COLONNES_MODELE.map(([g]) => g));
  ws.addRow(COLONNES_MODELE.map(([, t]) => t));
  let debut = 1;
  for (let c = 2; c <= COLONNES_MODELE.length + 1; c++) {
    if (c > COLONNES_MODELE.length || COLONNES_MODELE[c - 1][0] !== COLONNES_MODELE[debut - 1][0]) {
      if (c - 1 > debut) ws.mergeCells(1, debut, 1, c - 1);
      debut = c;
    }
  }
  COLONNES_MODELE.forEach(([g, , largeur], i) => {
    ws.getColumn(i + 1).width = largeur;
    for (const r of [1, 2]) {
      const cell = ws.getRow(r).getCell(i + 1);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEURS_GROUPES[g] || 'FF1F2937' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { left: { style: 'thin', color: { argb: 'FFFFFFFF' } }, right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    }
  });
  ws.getRow(1).height = 24;
  ws.getRow(2).height = 44;

  // Lignes vides numérotées : la ligne N° 1 est déjà pour un vrai produit.
  // L'exemple est dans l'onglet « Comment remplir » (une ligne d'exemple ici était remplie par erreur).
  for (let i = 1; i <= LIGNES_MODELE; i++) ws.addRow([i]);
  const derniere = LIGNES_MODELE + 2;
  for (let r = 3; r <= derniere; r++) ws.getRow(r).getCell(1).alignment = { horizontal: 'center' };

  // Menus déroulants : listes de la boutique (un nouveau nom reste permis : il sera créé)
  const feuilleListes = wb.addWorksheet('Listes', { state: 'veryHidden' });
  let colListe = 1;
  COLONNES_MODELE.forEach(([, titre, , liste, estNombre], i) => {
    const col = lettre(i + 1);
    const plage = `${col}3:${col}${derniere}`;
    if (estNombre) {
      for (let r = 3; r <= derniere; r++) ws.getRow(r).getCell(i + 1).numFmt = '#,##0';
      ws.dataValidations.add(plage, {
        type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Nombre attendu', error: 'Tape un nombre, sans lettres.',
      });
    }
    const valeurs = liste ? listes[liste] || [] : [];
    if (valeurs.length) {
      const cl = lettre(colListe++);
      feuilleListes.getCell(`${cl}1`).value = titre;
      valeurs.forEach((v, k) => (feuilleListes.getCell(`${cl}${k + 2}`).value = v));
      ws.dataValidations.add(plage, {
        type: 'list', allowBlank: true, formulae: [`Listes!$${cl}$2:$${cl}$${valeurs.length + 1}`],
        showErrorMessage: true, errorStyle: 'information', errorTitle: 'Nouveau nom',
        error: "Ce nom n'est pas encore dans Miyo : il sera créé à l'import.",
      });
    }
  });

  const aide = wb.addWorksheet('Comment remplir');
  aide.getColumn(1).width = 112;
  [
    'COMMENT REMPLIR LA FICHE PRODUITS MIYO',
    '',
    '1. Une ligne par produit. Les colonnes suivent le formulaire « Nouveau produit », dans le même ordre.',
    "2. ÉTAPE 1 · INFORMATIONS GÉNÉRALES : fournisseur, nom, description, catégorie, marque, modèle, unité de base. Choisis dans les listes ; un nom nouveau sera créé à l'import.",
    "3. Fournisseur ou unité de base vides : Miyo prendra ceux que tu choisis au moment de l'import.",
    "4. PRIX (FCFA) : prix d'achat et prix de vente de l'unité de base. Le propriétaire peut les remplir avant l'import.",
    "5. UNITÉS DE VENTE : les conditionnements dans lesquels tu vends (carton, bidon, gros…). Pour chacune : son nom, sa quantité de base (ex : 12 pièces dans un carton), son prix d'achat et son prix de vente. La première est l'unité principale.",
    "6. ÉTAPE 2 · QUANTITÉS : stock actuel, minimum et maximum, comptés dans l'unité de base (ex : 2 cartons de 12 + 4 pièces = 28).",
    '7. EMPLACEMENT EN MAGASIN : un rayon va dans un emplacement, une étagère dans un rayon.',
    "8. Dans Miyo : Produits > Importer Excel > Vérifier. Rien n'est créé avant ta confirmation.",
    '9. Un produit déjà présent dans la boutique (même nom, modèle et marque) est ignoré.',
  ].forEach((t, i) => {
    const row = aide.addRow([t]);
    if (i === 0) row.font = { bold: true, size: 14, color: { argb: 'FFC2410C' } };
  });

  // Exemple rempli, ici seulement (jamais dans la feuille Produits)
  aide.addRow([]);
  aide.addRow(['EXEMPLE DE LIGNE REMPLIE (à ne pas recopier telle quelle)']).font = { bold: true, color: { argb: 'FFC2410C' } };
  [
    ['Fournisseur', 'Yuxing'], ['Nom du produit', 'Carburateur'], ['Catégorie', 'Moteur'], ['Marque', 'Honda'], ['Modèle', 'CD110'],
    ['Unité de base', 'Pièce'], ["Prix d'achat", '6 000'], ['Prix de vente', '8 500'],
    ['Unité de vente 1', 'Carton, qté de base 10, prix d\'achat 55 000, prix de vente 75 000'],
    ['Unité de vente 2', 'Gros, qté de base 1, prix d\'achat 6 000, prix de vente 8 000'],
    ['Stock actuel', '24 (2 cartons de 10 + 4 pièces)'], ['Stock minimum / maximum', '5 / 40'],
    ['Emplacement / Rayon / Étagère', 'Boutique / Rayon A / Étagère 1'],
  ].forEach(([champ, valeur]) => aide.addRow([`${champ} : ${valeur}`]));

  return wb.xlsx.writeBuffer();
}
