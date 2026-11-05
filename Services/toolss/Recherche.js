// Services/toolss/Recherche.js
// ============================================================
// RECHERCHE SOUPLE pour l'assistant
// ------------------------------------------------------------
// Ce que l'IA reçoit vient d'une dictée vocale : pluriels, accents
// manquants, « 5 litres » au lieu de « 5L », petites fautes (« bouchie »).
// Avant, on cherchait le texte exact dans le nom (LIKE %…%) : « huile 5 litres »
// ne trouvait pas « Huile 5L » et l'IA répondait « rien trouvé ».
// ============================================================
import { pool } from '../../config/db.js';

const VIDES = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'd', 'l', 'un', 'une', 'en', 'a', 'au', 'aux', 'pour', 'et']);

// « cinq litres » → « 5 litres » (nombres dictés devant une mesure)
const NOMBRES = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20, trente: 30, cinquante: 50, cent: 100 };
const RE_NOMBRE_MESURE = new RegExp(
  `\\b(${Object.keys(NOMBRES).join('|')})\\s+(litres?|l|kilos?|kg|kilogrammes?|grammes?|g|millilitres?|ml)\\b`,
  'g'
);

export const normaliser = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(RE_NOMBRE_MESURE, (_, n, u) => `${NOMBRES[n]} ${u}`)
    .replace(/(\d+)\s*(litres?|l)\b/g, '$1l')
    .replace(/(\d+)\s*(kilos?|kg|kilogrammes?)\b/g, '$1kg')
    .replace(/(\d+)\s*(millilitres?|ml)\b/g, '$1ml')
    .replace(/(\d+)\s*(grammes?|g)\b/g, '$1g')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const singulier = (m) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m);

export const mots = (s) =>
  normaliser(s)
    .split(' ')
    .filter((m) => m && !VIDES.has(m))
    .map(singulier);

// Distance d'édition (fautes de frappe / d'écoute)
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function motProche(m, cible) {
  if (cible.has(m)) return 1;
  let meilleur = 0;
  for (const c of cible) {
    if (c.length >= 4 && m.length >= 3 && (c.startsWith(m) || m.startsWith(c))) meilleur = Math.max(meilleur, 0.75);
    else if (m.length >= 5 && c.length >= 5 && distance(m, c) <= 1) meilleur = Math.max(meilleur, 0.8);
    else if (m.length >= 7 && c.length >= 7 && distance(m, c) <= 2) meilleur = Math.max(meilleur, 0.6);
  }
  return meilleur;
}

// Ressemblance entre ce qui a été dit et un produit (0 à ~1.15)
export function score(demande, produit) {
  const d = mots(demande);
  if (!d.length) return 0;
  const cible = new Set(
    mots(`${produit.nom} ${produit.modele_nom || ''} ${produit.marque_nom || ''} ${produit.categorie_nom || ''}`)
  );
  let ok = 0;
  for (const m of d) ok += motProche(m, cible);
  let s = ok / d.length;
  const nomSeul = mots(produit.nom);
  if (nomSeul.length && nomSeul.every((m) => d.includes(m))) s += 0.15;
  return s;
}

/**
 * Produits du magasin qui ressemblent au texte dit, du plus proche au moins proche.
 * Même forme de résultat que Produit.search (p.* + catégorie, marque, modèle, unité).
 */
export async function chercherProduits(texte, workspaceId, { seuil = 0.5, limite = 10 } = {}) {
  const t = String(texte || '').trim();
  if (!t) return [];
  const [rows] = await pool.execute(
    `SELECT p.*,
            c.nom AS categorie_nom, m.nom AS marque_nom, md.nom AS modele_nom,
            u.nom AS unite_nom, u.symbole AS unite_symbole, f.nom AS fournisseur_nom
       FROM produits p
       LEFT JOIN categories c ON p.id_categorie = c.id_categorie
       LEFT JOIN marques m ON p.id_marque = m.id_marque
       LEFT JOIN modeles md ON p.id_modele = md.id_modele
       LEFT JOIN unites u ON p.id_unite = u.id_unite
       LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
      WHERE p.id_utilisateur = ?`,
    [workspaceId]
  );
  return rows
    .map((p) => ({ p, s: score(t, p) }))
    .filter((x) => x.s >= seuil)
    .sort((a, b) => b.s - a.s || String(a.p.nom).localeCompare(String(b.p.nom)))
    .slice(0, limite)
    .map((x) => ({ ...x.p, _score: Math.round(x.s * 100) / 100 }));
}

/**
 * Vocabulaire du magasin pour aider la dictée (Whisper) à bien écrire
 * les noms de produits, marques et clients. Court : ~200 mots maximum.
 */
export async function vocabulaireMagasin(workspaceId) {
  const [prod] = await pool.execute(
    `SELECT p.nom, m.nom AS marque, md.nom AS modele
       FROM produits p
       LEFT JOIN marques m ON p.id_marque = m.id_marque
       LEFT JOIN modeles md ON p.id_modele = md.id_modele
      WHERE p.id_utilisateur = ?
      ORDER BY p.date_modification DESC
      LIMIT 80`,
    [workspaceId]
  );
  const [cli] = await pool.execute(
    `SELECT nom FROM clients WHERE id_utilisateur = ? AND actif = TRUE ORDER BY id_client DESC LIMIT 30`,
    [workspaceId]
  ).catch(() => [[]]);
  const vus = new Set();
  const liste = [];
  for (const v of [...prod.flatMap((p) => [p.nom, p.marque, p.modele]), ...cli.map((c) => c.nom)]) {
    const t = String(v || '').trim();
    if (t && !vus.has(t.toLowerCase())) {
      vus.add(t.toLowerCase());
      liste.push(t);
    }
  }
  let texte = 'Vente de pièces détachées et lubrifiants. Cartons, bidons, pièces, francs CFA. ';
  for (const t of liste) {
    if ((texte + t).length > 700) break;
    texte += `${t}, `;
  }
  return texte.replace(/, $/, '.');
}
