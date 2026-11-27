// Services/SuppressionCompte.js
// Suppression d'un compte patron, demandée depuis l'application (exigence Google Play).
//  1. Demande : le compte et ses employés sont bloqués tout de suite, toutes les sessions fermées.
//  2. Pendant 30 jours : annulation possible par l'assistance (scripts/annuler-suppression.js).
//  3. Après 30 jours : la boutique et toutes ses données sont effacées.
import { pool } from '../config/db.js';

export const DELAI_JOURS = 30;

const dateEffacement = (depuis) => {
    const d = new Date(depuis || Date.now());
    d.setDate(d.getDate() + DELAI_JOURS);
    return d;
};

/** Enregistre la demande, bloque le patron et ses employés, ferme leurs sessions. */
export async function demanderSuppression(idUtilisateur) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `UPDATE utilisateurs
                SET suppression_demandee_le = COALESCE(suppression_demandee_le, NOW()),
                    actif = 0, session_version = session_version + 1
              WHERE id_utilisateur = ?`,
            [idUtilisateur]
        );
        // On note quels employés étaient actifs, pour pouvoir les réactiver si la demande est annulée
        await conn.query(
            `UPDATE employes
                SET bloque_par_suppression = 1, actif = 0, session_version = session_version + 1
              WHERE id_utilisateur = ? AND actif = 1`,
            [idUtilisateur]
        );
        const [[u]] = await conn.query('SELECT suppression_demandee_le FROM utilisateurs WHERE id_utilisateur = ?', [idUtilisateur]);
        await conn.commit();
        return { date_demande: u?.suppression_demandee_le, date_effacement: dateEffacement(u?.suppression_demandee_le) };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

/** Annule une demande encore en attente : le patron et ses employés retrouvent l'accès. */
export async function annulerSuppression(idUtilisateur) {
    const [r] = await pool.query(
        `UPDATE utilisateurs SET suppression_demandee_le = NULL, actif = 1
          WHERE id_utilisateur = ? AND suppression_demandee_le IS NOT NULL`,
        [idUtilisateur]
    );
    if (!r.affectedRows) return false;
    await pool.query(
        'UPDATE employes SET actif = 1, bloque_par_suppression = 0 WHERE id_utilisateur = ? AND bloque_par_suppression = 1',
        [idUtilisateur]
    );
    return true;
}

const tableExiste = async (conn, table) => {
    const [r] = await conn.query(
        'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
    );
    return r.length > 0;
};

/**
 * Efface définitivement un compte et toutes les données de sa boutique.
 * Presque toutes les tables suivent la suppression du patron (ON DELETE CASCADE) ;
 * on retire d'abord celles qui bloqueraient cette cascade.
 */
export async function effacerCompte(idUtilisateur) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [entrepots] = await conn.query('SELECT id_entrepot FROM entrepots WHERE id_utilisateur_proprietaire = ?', [idUtilisateur]);
        const [magasins] = await conn.query('SELECT id_magasin FROM magasins WHERE id_utilisateur = ?', [idUtilisateur]);
        const ids = (rows, k) => (rows.length ? rows.map((r) => r[k]) : [0]);
        // Transferts liés à ses entrepôts ou magasins (leurs liens empêchent la cascade)
        await conn.query(
            `DELETE FROM transferts_stock
              WHERE id_entrepot_source IN (?) OR id_magasin_destination IN (?) OR id_utilisateur_destination = ?`,
            [ids(entrepots, 'id_entrepot'), ids(magasins, 'id_magasin'), idUtilisateur]
        );
        // Achats et retours fournisseurs avant les fournisseurs (lien bloquant)
        await conn.query('DELETE FROM retours_fournisseurs WHERE id_utilisateur = ?', [idUtilisateur]);
        await conn.query('DELETE FROM commandes_achat WHERE id_utilisateur = ?', [idUtilisateur]);
        // Tables sans lien vers le compte
        if (await tableExiste(conn, 'ia_consommation')) {
            await conn.query('DELETE FROM ia_consommation WHERE id_utilisateur = ?', [idUtilisateur]);
        }
        // Le reste suit la suppression du compte
        const [r] = await conn.query('DELETE FROM utilisateurs WHERE id_utilisateur = ?', [idUtilisateur]);
        await conn.commit();
        return r.affectedRows > 0;
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

/** Efface les comptes dont la demande a plus de 30 jours. Appelé au démarrage puis toutes les 6 heures. */
export async function effacerComptesEchus() {
    const [rows] = await pool.query(
        `SELECT id_utilisateur FROM utilisateurs
          WHERE suppression_demandee_le IS NOT NULL
            AND suppression_demandee_le <= NOW() - INTERVAL ${DELAI_JOURS} DAY`
    );
    for (const { id_utilisateur } of rows) {
        try {
            await effacerCompte(id_utilisateur);
            console.log(` [Suppression] Compte ${id_utilisateur} effacé (demande de plus de ${DELAI_JOURS} jours)`);
        } catch (e) {
            console.error(` [Suppression] Compte ${id_utilisateur} : effacement impossible :`, e.message);
        }
    }
    return rows.length;
}

export function demarrerEffacementAutomatique() {
    const lancer = () => effacerComptesEchus().catch((e) => console.error(' [Suppression]', e.message));
    setTimeout(lancer, 60 * 1000);
    setInterval(lancer, 6 * 60 * 60 * 1000).unref();
}

export { dateEffacement };
