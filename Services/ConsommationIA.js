// Services/ConsommationIA.js
// ============================================================
// COMPTEUR DE CONSOMMATION DE L'ASSISTANT MIYO
// ------------------------------------------------------------
// Pour chaque question : jetons envoyés, jetons pris dans le cache de Google,
// jetons reçus, et coût ESTIMÉ (prix publics de Google, formule payante).
// En formule gratuite, Google ne facture rien : le coût montre ce que la
// question coûterait une fois la facturation activée.
//
// Voir le résumé : node scripts/consommation-ia.js   (depuis le dossier backend)
// ============================================================
import { pool } from '../config/db.js';

// Prix publics en dollars pour 1 million de jetons (texte), formule payante.
// À vérifier de temps en temps : https://ai.google.dev/gemini-api/docs/pricing
// entree = jetons envoyés, sortie = jetons reçus (réflexion comprise).
// Les jetons pris dans le cache coûtent environ 10 % du prix d'entrée.
// Liste revue le 23/11/2026. L'ordre compte : le plus précis d'abord.
// « double » = date à partir de laquelle Google double le prix.
const PRIX = [
  [/^gemini-2\.5-flash-lite/, { entree: 0.1, sortie: 0.4 }],
  [/^gemini-2\.5-flash/, { entree: 0.3, sortie: 2.5 }], // redirigé vers 3.5 Flash-Lite, même prix
  [/^gemini-3\.1-flash-lite/, { entree: 0.25, sortie: 1.5 }],
  [/^gemini-3\.5-flash-lite/, { entree: 0.3, sortie: 2.5 }],
  [/^gemini-3-flash/, { entree: 0.5, sortie: 3.0 }],
  [/^gemini-3\.[68]-flash/, { entree: 0.75, sortie: 3.75, double: '2027-01-01' }],
  [/^gemini-3\.5-flash/, { entree: 1.5, sortie: 9.0 }],
  // Autres « lite » : prix d'un lite récent ; autres Flash : prix le plus haut, par prudence
  [/flash-lite/, { entree: 0.3, sortie: 2.5 }],
  [/flash/, { entree: 1.5, sortie: 9.0 }],
];
const PART_CACHE = 0.1;
const TAUX_FCFA = Number(process.env.IA_TAUX_DOLLAR_FCFA) || 600;

const TABLE = `
CREATE TABLE IF NOT EXISTS ia_consommation (
    id_conso INT AUTO_INCREMENT PRIMARY KEY,
    id_utilisateur INT NULL,
    date_question DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fournisseur VARCHAR(20) NOT NULL,
    modele VARCHAR(60) NULL,
    voix TINYINT(1) NOT NULL DEFAULT 0,
    appels TINYINT NOT NULL DEFAULT 0,
    outils_envoyes SMALLINT NOT NULL DEFAULT 0,
    tous_les_outils TINYINT(1) NOT NULL DEFAULT 1,
    sujets VARCHAR(120) NULL,
    jetons_entree INT NOT NULL DEFAULT 0,
    jetons_cache INT NOT NULL DEFAULT 0,
    jetons_sortie INT NOT NULL DEFAULT 0,
    cout_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
    duree_ms INT NULL,
    INDEX idx_conso_date (date_question),
    INDEX idx_conso_util (id_utilisateur, date_question)
)`;

let tablePrete = null;
const preparerTable = () => {
  tablePrete ||= pool.query(TABLE).catch((e) => {
    tablePrete = null;
    throw e;
  });
  return tablePrete;
};

const prixDe = (modele, quand = new Date()) => {
  const p = (PRIX.find(([re]) => re.test(String(modele || ''))) || [null, { entree: 0, sortie: 0 }])[1];
  const x = p.double && quand >= new Date(`${p.double}T00:00:00Z`) ? 2 : 1;
  return { entree: p.entree * x, sortie: p.sortie * x };
};

/** Coût en dollars d'un appel */
export function coutAppel(modele, { entree = 0, cache = 0, sortie = 0 }) {
  const p = prixDe(modele);
  const plein = Math.max(0, entree - cache);
  return (plein * p.entree + cache * p.entree * PART_CACHE + sortie * p.sortie) / 1e6;
}

/** Consommation lue dans une réponse de Gemini (usageMetadata) ou de Groq (usage) */
export function lireUsage(reponse) {
  const g = reponse?._usage;
  if (g) return g;
  const u = reponse?.usage;
  if (u) return { modele: reponse.model || 'groq', entree: u.prompt_tokens || 0, cache: 0, sortie: u.completion_tokens || 0, fournisseur: 'groq' };
  return null;
}

/** Une question : la somme de ses appels. Écrite sans bloquer la réponse. */
export function enregistrerQuestion({ id_utilisateur, appels = [], voix = false, outilsEnvoyes = 0, complet = true, sujets = [], dureeMs = null }) {
  if (!appels.length) return;
  const total = appels.reduce(
    (t, a) => {
      t.entree += a.entree || 0;
      t.cache += a.cache || 0;
      t.sortie += a.sortie || 0;
      t.cout += a.fournisseur === 'groq' ? 0 : coutAppel(a.modele, a);
      return t;
    },
    { entree: 0, cache: 0, sortie: 0, cout: 0 }
  );
  const dernier = appels[appels.length - 1];
  const partCache = total.entree ? Math.round((total.cache / total.entree) * 100) : 0;
  console.log(
    `[Miyo IA] ${appels.length} appel(s) · ${dernier.modele} · ${outilsEnvoyes} outils${complet ? ' (tous)' : ''}` +
      ` · envoyés ${total.entree} jetons dont ${partCache} % en cache · reçus ${total.sortie}` +
      ` · environ ${(total.cout * TAUX_FCFA).toFixed(1)} FCFA`
  );
  preparerTable()
    .then(() =>
      pool.execute(
        `INSERT INTO ia_consommation
           (id_utilisateur, fournisseur, modele, voix, appels, outils_envoyes, tous_les_outils, sujets,
            jetons_entree, jetons_cache, jetons_sortie, cout_usd, duree_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id_utilisateur || null,
          dernier.fournisseur || 'gemini',
          String(dernier.modele || '').slice(0, 60),
          voix ? 1 : 0,
          Math.min(appels.length, 127),
          outilsEnvoyes,
          complet ? 1 : 0,
          sujets.join(',').slice(0, 120) || null,
          total.entree,
          total.cache,
          total.sortie,
          total.cout.toFixed(6),
          dureeMs,
        ]
      )
    )
    .catch((e) => console.warn('[Miyo IA] compteur non enregistré :', e.message));
}

/** Résumé par jour (pour le script) */
export async function resumeParJour(jours = 7) {
  await preparerTable();
  const [rows] = await pool.query(
    `SELECT DATE(date_question) AS jour, COUNT(*) AS questions,
            SUM(voix) AS vocales, SUM(tous_les_outils = 0) AS allegees,
            SUM(jetons_entree) AS entree, SUM(jetons_cache) AS cache, SUM(jetons_sortie) AS sortie,
            SUM(cout_usd) AS cout_usd
       FROM ia_consommation
      WHERE date_question >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(date_question)
      ORDER BY jour DESC`,
    [jours]
  );
  return rows.map((r) => ({ ...r, cout_fcfa: Number(r.cout_usd) * TAUX_FCFA }));
}

export const TAUX_DOLLAR_FCFA = TAUX_FCFA;
