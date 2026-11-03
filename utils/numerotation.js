// utils/numerotation.js
//
// Numéros de documents (CV-202611-0004, FV-…, BC-…, REC-…, RT-…, INV-…).
//
// ⚠️ Ancienne méthode : COUNT(*) des documents du mois + 1.
//    Dès qu'un document est supprimé, le compte baisse et le numéro suivant est DÉJÀ PRIS
//    → « Duplicate entry 'CV-202611-0002-11' for key 'unique_numero_par_user' ».
// ✅ Nouvelle méthode : plus grand numéro déjà utilisé avec ce préfixe + 1.
//    Une suppression ne fait jamais réutiliser un numéro.
import { pool } from '../config/db.js';

// Tables et colonnes autorisées (aucune donnée utilisateur dans le SQL)
const AUTORISES = {
    commandes_vente: 'numero_commande',
    factures_vente: 'numero_facture',
    commandes_achat: 'numero_commande',
    receptions: 'numero_reception',
    retours_clients: 'numero_retour',
    retours_fournisseurs: 'numero_retour',
    inventaires: 'reference',
    clients: 'code_client',
};

/** Préfixe du mois en cours : « CV-202611- » */
export const prefixeDuMois = (code, date = new Date()) =>
    `${code}-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}-`;

/**
 * Prochain numéro libre pour ce compte et ce préfixe.
 * @param {object} p { table, prefixe, id_utilisateur, db? (connexion de transaction ou pool) }
 */
export async function prochainNumero({ table, prefixe, id_utilisateur, db = pool }) {
    const colonne = AUTORISES[table];
    if (!colonne) throw new Error(`Numérotation non prévue pour la table ${table}`);
    if (!id_utilisateur) throw new Error('id_utilisateur requis pour la numérotation');
    const [rows] = await db.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(\`${colonne}\`, ?) AS UNSIGNED)), 0) AS dernier
         FROM \`${table}\`
         WHERE id_utilisateur = ? AND \`${colonne}\` LIKE ?`,
        [prefixe.length + 1, id_utilisateur, `${prefixe.replace(/[%_]/g, '\\$&')}%`]
    );
    return `${prefixe}${String((parseInt(rows[0].dernier, 10) || 0) + 1).padStart(4, '0')}`;
}

/** Vrai si l'erreur MySQL est un doublon de numéro (deux enregistrements au même instant). */
export const estDoublonNumero = (err) =>
    err?.code === 'ER_DUP_ENTRY' && /unique_numero_par_user|unique_ref_par_user|uniq_code_client/.test(String(err.sqlMessage || err.message));

/** Petite pause aléatoire avant de retenter (évite que deux ventes se recroisent encore). */
export const attendreUnPeu = () => new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 60)));
