// Nom de l'unité d'une ligne (vente, achat, réception, transfert…).
// Quand on travaille dans l'unité de base du produit, on enregistre son vrai
// nom (Pièce, Litre, Bidon…) et non le mot passe-partout « Unité ».

const GENERIQUES = new Set(['', 'unite', 'unité', 'unité(s)', 'unite(s)', 'unites', 'unités']);

/** Vrai si le nom ne dit rien (vide ou « Unité ») */
export const estNomGenerique = (nom) => GENERIQUES.has(String(nom ?? '').trim().toLowerCase());

/** Nom de l'unité de base d'un produit du magasin ou de l'entrepôt */
export async function nomUniteBase(conn, { id_produit = null, id_produit_entrepot = null } = {}) {
    let rows = [];
    if (id_produit_entrepot) {
        [rows] = await conn.execute(
            `SELECT u.nom FROM produits_entrepot p JOIN unites u ON u.id_unite = p.id_unite
              WHERE p.id_produit_entrepot = ?`,
            [id_produit_entrepot]
        );
    }
    if (!rows.length && id_produit) {
        [rows] = await conn.execute(
            `SELECT u.nom FROM produits p JOIN unites u ON u.id_unite = p.id_unite
              WHERE p.id_produit = ?`,
            [id_produit]
        );
    }
    return rows[0]?.nom || null;
}

/**
 * Nom à enregistrer sur une ligne : celui reçu, sauf s'il est vide ou « Unité »
 * pour une quantité en unité de base ; on prend alors le nom de l'unité du produit.
 */
export async function nomUniteLigne(conn, nom, quantiteBase, ids) {
    if (!estNomGenerique(nom) || (parseFloat(quantiteBase) || 1) !== 1) return nom || 'Unité';
    return (await nomUniteBase(conn, ids)) || (String(nom ?? '').trim() || 'Unité');
}
