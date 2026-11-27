// Annule une demande de suppression de compte (pendant les 30 jours).
// Utilisation, dans le dossier backend : node scripts/annuler-suppression.js 0712345678
import 'dotenv/config';
import { pool } from '../config/db.js';
import { annulerSuppression } from '../Services/SuppressionCompte.js';

const tel = String(process.argv[2] || '').replace(/\D/g, '');
if (!tel) {
    console.log('Indiquez le numéro du patron : node scripts/annuler-suppression.js 0712345678');
    process.exit(1);
}
const [rows] = await pool.query(
    `SELECT id_utilisateur, fullname, telephone, suppression_demandee_le FROM utilisateurs
      WHERE REPLACE(REPLACE(telephone, ' ', ''), '+', '') LIKE ?`,
    [`%${tel.slice(-8)}`]
);
const enAttente = rows.filter((r) => r.suppression_demandee_le);
if (!enAttente.length) {
    console.log(rows.length ? 'Ce compte n\'a pas de demande de suppression en attente.' : 'Aucun compte avec ce numéro.');
} else if (enAttente.length > 1) {
    console.log('Plusieurs comptes correspondent, précisez le numéro :');
    console.table(enAttente);
} else {
    const u = enAttente[0];
    await annulerSuppression(u.id_utilisateur);
    console.log(`Suppression annulée pour ${u.fullname} (${u.telephone}). Le compte et ses employés sont réactivés.`);
}
await pool.end();
