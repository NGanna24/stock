// models/EmplacementMagasin.js
// ============================================================
// EMPLACEMENTS : emplacement > rayon > étagère
//   ex. « Réserve » > « Rayon B » > « Étagère 3 »
// Deux portées dans la même table :
//   - la boutique : id_entrepot vide, propre au compte (id_utilisateur)
//   - un entrepôt : id_entrepot renseigné, partagé par ses membres
// Un produit pointe vers le niveau le plus précis choisi
// (boutique : produits.id_emplacement_magasin ;
//  entrepôt : produits_entrepot.id_emplacement).
// Les colonnes texte du produit (emplacement, rayon, etagere) sont tenues
// à jour pour l'affichage, les impressions et les anciennes versions.
// ============================================================
import { pool } from '../config/db.js';

const PARENT_ATTENDU = { emplacement: null, rayon: 'emplacement', etagere: 'rayon' };

const fail = (message, statusCode = 400) => {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
};

// Portée — idEntrepot vide = boutique du compte
const portee = (idUtilisateur, idEntrepot) => (idEntrepot
    ? { sql: 'id_entrepot = ?', params: [Number(idEntrepot)], entrepot: Number(idEntrepot) }
    : { sql: 'id_utilisateur = ? AND id_entrepot IS NULL', params: [idUtilisateur], entrepot: null });

// Table des produits rangés selon la portée
const tableProduits = (idEntrepot) => (idEntrepot
    ? { table: 'produits_entrepot', lien: 'id_emplacement', filtre: 'actif = 1' }
    : { table: 'produits', lien: 'id_emplacement_magasin', filtre: 'id_emplacement_magasin IS NOT NULL' });

// Recopie les noms (emplacement, rayon, étagère) dans les colonnes texte des produits
const sqlSynchro = (idEntrepot) => {
    const t = tableProduits(idEntrepot);
    return `
    UPDATE ${t.table} p
    JOIN emplacements_magasin f ON f.id_emplacement = p.${t.lien}
    LEFT JOIN emplacements_magasin p1 ON p1.id_emplacement = f.id_parent
    LEFT JOIN emplacements_magasin p2 ON p2.id_emplacement = p1.id_parent
    SET p.emplacement = LEFT(CASE f.niveau WHEN 'emplacement' THEN f.nom WHEN 'rayon' THEN p1.nom ELSE p2.nom END, 100),
        p.rayon       = LEFT(CASE f.niveau WHEN 'emplacement' THEN NULL WHEN 'rayon' THEN f.nom ELSE p1.nom END, 50),
        p.etagere     = LEFT(CASE f.niveau WHEN 'etagere' THEN f.nom ELSE NULL END, 50)
    WHERE ${idEntrepot ? 'p.id_entrepot = ?' : 'p.id_utilisateur = ?'}`;
};

class EmplacementMagasin {
    static async liste(idUtilisateur, idEntrepot = null) {
        const pt = portee(idUtilisateur, idEntrepot);
        const t = tableProduits(idEntrepot);
        const [rows] = await pool.query(
            `SELECT e.id_emplacement, e.id_parent, e.id_entrepot, e.niveau, e.nom, e.position,
                    (SELECT COUNT(*) FROM ${t.table} p WHERE p.${t.lien} = e.id_emplacement AND p.${t.filtre}) AS nb_produits
             FROM (SELECT * FROM emplacements_magasin WHERE ${pt.sql}) e
             ORDER BY e.position, e.nom`,
            pt.params
        );
        return rows.map((r) => ({ ...r, nb_produits: Number(r.nb_produits) }));
    }

    // Un emplacement par son id, sans contrôle de portée (le contrôleur vérifie l'accès)
    static async parId(id) {
        const [r] = await pool.query('SELECT * FROM emplacements_magasin WHERE id_emplacement = ?', [id]);
        return r[0] || null;
    }

    static async trouver(idUtilisateur, id, idEntrepot = null) {
        const pt = portee(idUtilisateur, idEntrepot);
        const [r] = await pool.query(
            `SELECT * FROM emplacements_magasin WHERE id_emplacement = ? AND ${pt.sql}`,
            [id, ...pt.params]
        );
        return r[0] || null;
    }

    static async _nomLibre(pt, idParent, nom, idExclu = null) {
        const [r] = await pool.query(
            `SELECT id_emplacement FROM emplacements_magasin
             WHERE ${pt.sql} AND ${idParent ? 'id_parent = ?' : 'id_parent IS NULL'}
               AND LOWER(nom) = LOWER(?) ${idExclu ? 'AND id_emplacement <> ?' : ''} LIMIT 1`,
            [...pt.params, ...(idParent ? [idParent] : []), nom, ...(idExclu ? [idExclu] : [])]
        );
        return !r.length;
    }

    static async creer(idUtilisateur, { niveau, nom, id_parent }, idEntrepot = null) {
        if (!(niveau in PARENT_ATTENDU)) throw fail('Niveau inconnu');
        const propre = String(nom || '').trim().slice(0, 100);
        if (!propre) throw fail('Donnez un nom');
        const pt = portee(idUtilisateur, idEntrepot);
        let parent = null;
        if (PARENT_ATTENDU[niveau]) {
            parent = id_parent ? await this.trouver(idUtilisateur, id_parent, idEntrepot) : null;
            if (!parent || parent.niveau !== PARENT_ATTENDU[niveau]) {
                throw fail(niveau === 'rayon' ? "Choisissez d'abord l'emplacement du rayon" : "Choisissez d'abord le rayon de l'étagère");
            }
        }
        if (!(await this._nomLibre(pt, parent?.id_emplacement, propre))) {
            throw fail(`« ${propre} » existe déjà ici`, 409);
        }
        const [pos] = await pool.query(
            `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM emplacements_magasin
             WHERE ${pt.sql} AND ${parent ? 'id_parent = ?' : 'id_parent IS NULL'}`,
            [...pt.params, ...(parent ? [parent.id_emplacement] : [])]
        );
        const [ins] = await pool.query(
            'INSERT INTO emplacements_magasin (id_utilisateur, id_entrepot, id_parent, niveau, nom, position) VALUES (?, ?, ?, ?, ?, ?)',
            [idUtilisateur, pt.entrepot, parent?.id_emplacement || null, niveau, propre, pos[0].p]
        );
        return {
            id_emplacement: ins.insertId, id_parent: parent?.id_emplacement || null, id_entrepot: pt.entrepot,
            niveau, nom: propre, nb_produits: 0,
        };
    }

    static async renommer(idUtilisateur, id, nom, idEntrepot = null) {
        const e = await this.trouver(idUtilisateur, id, idEntrepot);
        if (!e) throw fail('Emplacement introuvable', 404);
        const propre = String(nom || '').trim().slice(0, 100);
        if (!propre) throw fail('Donnez un nom');
        const pt = portee(idUtilisateur, idEntrepot);
        if (!(await this._nomLibre(pt, e.id_parent, propre, id))) throw fail(`« ${propre} » existe déjà ici`, 409);
        await pool.query('UPDATE emplacements_magasin SET nom = ? WHERE id_emplacement = ?', [propre, id]);
        await this.synchroniser(idUtilisateur, idEntrepot);
        return { ...e, nom: propre };
    }

    // Refusé tant que des produits y sont rangés (lui ou ce qu'il contient)
    static async supprimer(idUtilisateur, id, idEntrepot = null) {
        const e = await this.trouver(idUtilisateur, id, idEntrepot);
        if (!e) throw fail('Emplacement introuvable', 404);
        const t = tableProduits(idEntrepot);
        const [n] = await pool.query(
            `SELECT COUNT(*) AS n FROM ${t.table} p
             JOIN emplacements_magasin f ON f.id_emplacement = p.${t.lien}
             LEFT JOIN emplacements_magasin p1 ON p1.id_emplacement = f.id_parent
             WHERE p.${t.filtre} AND (f.id_emplacement = ? OR f.id_parent = ? OR p1.id_parent = ?)`,
            [id, id, id]
        );
        if (Number(n[0].n) > 0) {
            throw fail(`${n[0].n} produit(s) sont rangés ici. Changez leur emplacement avant de le supprimer.`, 409);
        }
        await pool.query('DELETE FROM emplacements_magasin WHERE id_emplacement = ?', [id]);
        return true;
    }

    // Vérifie l'emplacement choisi pour un produit (même boutique / même entrepôt) ; renvoie l'id (ou null)
    static async verifierPourProduit(idUtilisateur, id, idEntrepot = null) {
        if (id === null || id === '' || id === 0 || id === '0') return null;
        const e = await this.trouver(idUtilisateur, Number(id), idEntrepot);
        if (!e) throw fail('Emplacement introuvable');
        return e.id_emplacement;
    }

    static async synchroniser(idUtilisateur, idEntrepot = null) {
        await pool.query(sqlSynchro(idEntrepot), [idEntrepot ? Number(idEntrepot) : idUtilisateur]);
    }
}

export default EmplacementMagasin;
