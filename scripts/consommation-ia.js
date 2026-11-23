// scripts/consommation-ia.js
// Résumé de la consommation de l'assistant Miyo, jour par jour.
// Lancer depuis le dossier backend :  node scripts/consommation-ia.js        (7 derniers jours)
//                                     node scripts/consommation-ia.js 30     (30 derniers jours)
import dotenv from 'dotenv';
dotenv.config();

const { resumeParJour, TAUX_DOLLAR_FCFA } = await import('../Services/ConsommationIA.js');
const { pool } = await import('../config/db.js');

const jours = Math.max(1, parseInt(process.argv[2], 10) || 7);
const lignes = await resumeParJour(jours);
const fcfa = (n) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

if (!lignes.length) {
  console.log(`Aucune question posée à l'assistant ces ${jours} derniers jours.`);
} else {
  console.log(`\nAssistant Miyo : consommation des ${jours} derniers jours (1 dollar = ${TAUX_DOLLAR_FCFA} FCFA)\n`);
  console.table(
    lignes.map((r, i) => ({
      'N°': i + 1,
      Jour: new Date(r.jour).toLocaleDateString('fr-FR'),
      Questions: Number(r.questions),
      'Dont vocales': Number(r.vocales),
      'Outils allégés': Number(r.allegees),
      'Jetons envoyés': Number(r.entree),
      'Part en cache': `${r.entree ? Math.round((Number(r.cache) / Number(r.entree)) * 100) : 0} %`,
      'Jetons reçus': Number(r.sortie),
      'Coût estimé': fcfa(r.cout_fcfa),
      'Par question': fcfa(r.cout_fcfa / Math.max(1, Number(r.questions))),
    }))
  );
  const total = lignes.reduce((t, r) => t + r.cout_fcfa, 0);
  const questions = lignes.reduce((t, r) => t + Number(r.questions), 0);
  console.log(`\nTotal : ${questions} questions, environ ${fcfa(total)}.`);
  console.log(`Projection sur 30 jours au même rythme : environ ${fcfa((total / jours) * 30)}.\n`);
}
await pool.end();
