// utils/recu.js
//
// Numéro de reçu fixe pour chaque encaissement : 1, 2, 3… par boutique, affiché « REC-000001 ».
// Il ne change jamais, même si d'autres paiements sont supprimés ensuite.
// Seuls les vrais encaissements reçoivent un numéro (pas les remboursements ni les avoirs).

export const formaterRecu = (n) => (n ? `REC-${String(n).padStart(6, '0')}` : null);

/**
 * Donne le numéro suivant au paiement, dans la même transaction que son enregistrement.
 * Lecture verrouillée + index unique (boutique, numéro) : deux encaissements simultanés
 * ne peuvent pas recevoir le même numéro.
 */
export async function numeroterRecu(conn, id_utilisateur, id_paiement) {
    for (let essai = 0; essai < 6; essai++) {
        try {
            const [[r]] = await conn.query(
                'SELECT COALESCE(MAX(numero_recu), 0) + 1 AS n FROM paiements WHERE id_utilisateur = ? FOR UPDATE',
                [id_utilisateur]
            );
            await conn.query(
                'UPDATE paiements SET numero_recu = ? WHERE id_paiement = ? AND id_utilisateur = ? AND numero_recu IS NULL',
                [r.n, id_paiement, id_utilisateur]
            );
            return r.n;
        } catch (e) {
            // Colonne pas encore créée (migration) : le paiement reste valable, sans numéro
            if (e.code === 'ER_BAD_FIELD_ERROR') return null;
            if (e.code !== 'ER_DUP_ENTRY' || essai === 5) throw e;
            await new Promise((ok) => setTimeout(ok, 20 + Math.random() * 80));
        }
    }
    return null;
}

/** Numérotation des encaissements déjà enregistrés (une seule fois, au démarrage) */
export async function numeroterAnciensRecus(conn) {
    const [boutiques] = await conn.query(
        `SELECT DISTINCT id_utilisateur FROM paiements
         WHERE numero_recu IS NULL AND montant > 0 AND mode_paiement <> 'avoir'`
    );
    for (const { id_utilisateur } of boutiques) {
        const [[m]] = await conn.query('SELECT COALESCE(MAX(numero_recu), 0) AS n FROM paiements WHERE id_utilisateur = ?', [id_utilisateur]);
        const [rows] = await conn.query(
            `SELECT id_paiement FROM paiements
             WHERE id_utilisateur = ? AND numero_recu IS NULL AND montant > 0 AND mode_paiement <> 'avoir'
             ORDER BY date_paiement, id_paiement`,
            [id_utilisateur]
        );
        let n = Number(m.n) || 0;
        for (const r of rows) {
            n += 1;
            await conn.query('UPDATE paiements SET numero_recu = ? WHERE id_paiement = ?', [n, r.id_paiement]);
        }
    }
    if (boutiques.length) console.log(` [Migration] Numéros de reçu donnés aux encaissements existants (${boutiques.length} boutique(s))`);
}
