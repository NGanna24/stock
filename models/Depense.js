// models/Depense.js
//
// Dépenses de fonctionnement (loyer, salaires, électricité, transport…).
// Les achats de marchandises n'en font PAS partie : ils passent par les commandes fournisseurs.
//
// Utilise UNIQUEMENT les tables existantes `depenses` et `categories_depenses`
// (créées par config/codesql.js) : aucune modification de structure.
// Tout est cloisonné par compte : id_utilisateur = req.workspaceId.
import { pool } from '../config/db.js';

export const MODES_PAIEMENT = ['especes', 'carte', 'virement', 'cheque', 'autre'];

/** Catégories créées au premier accès d'un compte qui n'en a encore aucune */
export const CATEGORIES_PAR_DEFAUT = [
    ['Loyer', 'Loyer du magasin, du dépôt…'],
    ['Électricité / Eau', 'Factures CIE, SODECI…'],
    ['Salaires', 'Salaires, primes, avances'],
    ['Transport', 'Taxi, livraison, carburant'],
    ['Communication', 'Crédit téléphone, internet'],
    ['Entretien / Réparations', 'Réparations, nettoyage, petit matériel'],
    ['Taxes / Impôts', 'Patente, impôts, taxes communales'],
    ['Divers', 'Autres dépenses'],
];

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Normalise une date 'YYYY-MM-DD' (ou null) */
const isoDate = (v) => {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`)) ? s : null;
};

const SELECT_DEPENSE = `
    SELECT d.id_depense,
           DATE_FORMAT(d.date_depense, '%Y-%m-%d') AS date_depense,
           d.libelle, d.montant, d.id_categorie_depense, d.mode_paiement,
           d.reference, d.note, d.date_creation,
           c.nom AS categorie_nom
      FROM depenses d
      LEFT JOIN categories_depenses c ON c.id_categorie_depense = d.id_categorie_depense`;

const cast = (r) => ({ ...r, montant: parseFloat(r.montant) || 0 });

class Depense {
    /* ============================================================
       FILTRES COMMUNS
       ============================================================ */
    static _where(id_utilisateur, f = {}) {
        const clauses = ['d.id_utilisateur = ?'];
        const params = [id_utilisateur];
        const debut = isoDate(f.dateDebut);
        const fin = isoDate(f.dateFin);
        if (debut) { clauses.push('d.date_depense >= ?'); params.push(debut); }
        if (fin) { clauses.push('d.date_depense <= ?'); params.push(fin); }
        if (f.id_categorie === 'aucune') {
            clauses.push('d.id_categorie_depense IS NULL');
        } else if (f.id_categorie) {
            clauses.push('d.id_categorie_depense = ?');
            params.push(parseInt(f.id_categorie, 10) || 0);
        }
        if (f.mode_paiement && MODES_PAIEMENT.includes(f.mode_paiement)) {
            clauses.push('d.mode_paiement = ?');
            params.push(f.mode_paiement);
        }
        if (f.search && String(f.search).trim()) {
            const like = `%${String(f.search).trim().replace(/[%_\\]/g, '\\$&')}%`;
            clauses.push('(d.libelle LIKE ? OR d.reference LIKE ? OR d.note LIKE ?)');
            params.push(like, like, like);
        }
        return { where: clauses.join(' AND '), params };
    }

    /* ============================================================
       LISTE
       ============================================================ */
    static async findAll(id_utilisateur, filters = {}) {
        const { where, params } = this._where(id_utilisateur, filters);
        const [rows] = await pool.execute(
            `${SELECT_DEPENSE}
              WHERE ${where}
              ORDER BY d.date_depense DESC, d.id_depense DESC
              LIMIT 2000`,
            params
        );
        return rows.map(cast);
    }

    static async findById(id_depense, id_utilisateur) {
        const [rows] = await pool.execute(
            `${SELECT_DEPENSE} WHERE d.id_depense = ? AND d.id_utilisateur = ?`,
            [id_depense, id_utilisateur]
        );
        return rows[0] ? cast(rows[0]) : null;
    }

    /* ============================================================
       STATISTIQUES (total, par catégorie, par mode, par mois)
       ============================================================ */
    static async getStats(id_utilisateur, filters = {}) {
        const { where, params } = this._where(id_utilisateur, filters);

        const [[tot]] = await pool.execute(
            `SELECT COALESCE(SUM(d.montant), 0) AS total, COUNT(*) AS nombre,
                    COALESCE(MAX(d.montant), 0) AS plus_grosse
               FROM depenses d WHERE ${where}`,
            params
        );
        const [parCategorie] = await pool.execute(
            `SELECT d.id_categorie_depense, COALESCE(c.nom, 'Sans catégorie') AS categorie_nom,
                    SUM(d.montant) AS total, COUNT(*) AS nombre
               FROM depenses d
               LEFT JOIN categories_depenses c ON c.id_categorie_depense = d.id_categorie_depense
              WHERE ${where}
              GROUP BY d.id_categorie_depense, c.nom
              ORDER BY total DESC`,
            params
        );
        const [parMode] = await pool.execute(
            `SELECT d.mode_paiement, SUM(d.montant) AS total, COUNT(*) AS nombre
               FROM depenses d WHERE ${where}
              GROUP BY d.mode_paiement ORDER BY total DESC`,
            params
        );

        const total = parseFloat(tot.total) || 0;
        return {
            total: round2(total),
            nombre: parseInt(tot.nombre, 10) || 0,
            plus_grosse: parseFloat(tot.plus_grosse) || 0,
            par_categorie: parCategorie.map((r) => ({
                id_categorie_depense: r.id_categorie_depense,
                categorie_nom: r.categorie_nom,
                total: parseFloat(r.total) || 0,
                nombre: parseInt(r.nombre, 10) || 0,
                part: total > 0 ? round2(((parseFloat(r.total) || 0) / total) * 100) : 0,
            })),
            par_mode: parMode.map((r) => ({
                mode_paiement: r.mode_paiement,
                total: parseFloat(r.total) || 0,
                nombre: parseInt(r.nombre, 10) || 0,
            })),
        };
    }

    /** Total simple sur une période (utilisé par le rapport Bénéfices & Marges) */
    static async getTotal(id_utilisateur, dateDebut, dateFin) {
        const [[r]] = await pool.execute(
            `SELECT COALESCE(SUM(montant), 0) AS total, COUNT(*) AS nombre
               FROM depenses
              WHERE id_utilisateur = ? AND date_depense BETWEEN ? AND ?`,
            [id_utilisateur, isoDate(dateDebut), isoDate(dateFin)]
        );
        return { total: round2(parseFloat(r.total) || 0), nombre: parseInt(r.nombre, 10) || 0 };
    }

    /** Totaux par catégorie sur une période (rapport Bénéfices & Marges) */
    static async getParCategorie(id_utilisateur, dateDebut, dateFin) {
        const [rows] = await pool.execute(
            `SELECT COALESCE(c.nom, 'Sans catégorie') AS categorie_nom, SUM(d.montant) AS total
               FROM depenses d
               LEFT JOIN categories_depenses c ON c.id_categorie_depense = d.id_categorie_depense
              WHERE d.id_utilisateur = ? AND d.date_depense BETWEEN ? AND ?
              GROUP BY d.id_categorie_depense, c.nom
              ORDER BY total DESC`,
            [id_utilisateur, isoDate(dateDebut), isoDate(dateFin)]
        );
        return rows.map((r) => ({ categorie_nom: r.categorie_nom, total: parseFloat(r.total) || 0 }));
    }

    /* ============================================================
       VALIDATION
       ============================================================ */
    static async _valider(data, id_utilisateur, db = pool) {
        const libelle = String(data.libelle || '').trim();
        if (!libelle) throw fail('Le libellé est obligatoire');
        if (libelle.length > 200) throw fail('Le libellé ne doit pas dépasser 200 caractères');

        const montant = round2(parseFloat(String(data.montant ?? '').replace(',', '.')));
        if (!(montant > 0)) throw fail('Le montant doit être supérieur à 0');
        if (montant > 9999999999999) throw fail('Montant trop élevé');

        const date_depense = isoDate(data.date_depense);
        if (!date_depense) throw fail('La date est obligatoire');

        const mode_paiement = MODES_PAIEMENT.includes(data.mode_paiement) ? data.mode_paiement : 'especes';

        let id_categorie_depense = data.id_categorie_depense ? parseInt(data.id_categorie_depense, 10) : null;
        if (id_categorie_depense) {
            const [cat] = await db.execute(
                `SELECT id_categorie_depense FROM categories_depenses
                  WHERE id_categorie_depense = ? AND id_utilisateur = ?`,
                [id_categorie_depense, id_utilisateur]
            );
            if (cat.length === 0) throw fail('Catégorie introuvable');
        } else {
            id_categorie_depense = null;
        }

        const reference = String(data.reference || '').trim().slice(0, 100) || null;
        const note = String(data.note || '').trim() || null;

        return { libelle, montant, date_depense, mode_paiement, id_categorie_depense, reference, note };
    }

    /* ============================================================
       CRÉER / MODIFIER / SUPPRIMER
       ============================================================ */
    static async create(data, id_utilisateur) {
        const v = await this._valider(data, id_utilisateur);
        const [result] = await pool.execute(
            `INSERT INTO depenses
                (id_utilisateur, date_depense, libelle, montant, id_categorie_depense, mode_paiement, reference, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id_utilisateur, v.date_depense, v.libelle, v.montant, v.id_categorie_depense, v.mode_paiement, v.reference, v.note]
        );
        return this.findById(result.insertId, id_utilisateur);
    }

    /** Plusieurs dépenses en une fois (reprise des dépenses fixes) : tout ou rien */
    static async createMany(items, id_utilisateur) {
        if (!Array.isArray(items) || items.length === 0) throw fail('Aucune dépense à enregistrer');
        if (items.length > 100) throw fail('100 dépenses maximum à la fois');

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const ids = [];
            for (let i = 0; i < items.length; i += 1) {
                let v;
                try {
                    v = await this._valider(items[i], id_utilisateur, conn);
                } catch (e) {
                    e.message = `Ligne ${i + 1} (${items[i]?.libelle || 'sans libellé'}) : ${e.message}`;
                    throw e;
                }
                const [r] = await conn.execute(
                    `INSERT INTO depenses
                        (id_utilisateur, date_depense, libelle, montant, id_categorie_depense, mode_paiement, reference, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id_utilisateur, v.date_depense, v.libelle, v.montant, v.id_categorie_depense, v.mode_paiement, v.reference, v.note]
                );
                ids.push(r.insertId);
            }
            await conn.commit();
            return ids;
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    static async update(id_depense, data, id_utilisateur) {
        const existante = await this.findById(id_depense, id_utilisateur);
        if (!existante) throw fail('Dépense introuvable', 404);
        const v = await this._valider({ ...existante, ...data }, id_utilisateur);
        await pool.execute(
            `UPDATE depenses
                SET date_depense = ?, libelle = ?, montant = ?, id_categorie_depense = ?,
                    mode_paiement = ?, reference = ?, note = ?
              WHERE id_depense = ? AND id_utilisateur = ?`,
            [v.date_depense, v.libelle, v.montant, v.id_categorie_depense, v.mode_paiement, v.reference, v.note,
             id_depense, id_utilisateur]
        );
        return this.findById(id_depense, id_utilisateur);
    }

    static async delete(id_depense, id_utilisateur) {
        const [r] = await pool.execute(
            `DELETE FROM depenses WHERE id_depense = ? AND id_utilisateur = ?`,
            [id_depense, id_utilisateur]
        );
        if (r.affectedRows === 0) throw fail('Dépense introuvable', 404);
        return true;
    }

    /* ============================================================
       REPRISE : dépenses du mois précédent, à recopier sur le mois choisi
       mois = 'YYYY-MM' (mois de destination)
       ============================================================ */
    static async getMoisPrecedent(id_utilisateur, mois) {
        const m = /^(\d{4})-(\d{2})$/.exec(String(mois || ''));
        if (!m) throw fail('Mois invalide (format AAAA-MM)');
        const annee = parseInt(m[1], 10);
        const idx = parseInt(m[2], 10) - 1; // 0..11
        if (idx < 0 || idx > 11) throw fail('Mois invalide');

        const debutPrec = new Date(Date.UTC(annee, idx - 1, 1));
        const finPrec = new Date(Date.UTC(annee, idx, 0));
        const iso = (d) => d.toISOString().slice(0, 10);

        const rows = await this.findAll(id_utilisateur, { dateDebut: iso(debutPrec), dateFin: iso(finPrec) });
        return {
            mois_source: iso(debutPrec).slice(0, 7),
            mois_cible: `${m[1]}-${m[2]}`,
            dernier_jour_cible: new Date(Date.UTC(annee, idx + 1, 0)).getUTCDate(),
            depenses: rows.reverse(), // ordre chronologique
        };
    }
}

/* ============================================================
   CATÉGORIES
   ============================================================ */
export class CategorieDepense {
    static async findAll(id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT c.id_categorie_depense, c.nom, c.description, c.actif, c.date_creation,
                    COUNT(d.id_depense) AS nb_depenses
               FROM categories_depenses c
               LEFT JOIN depenses d ON d.id_categorie_depense = c.id_categorie_depense
              WHERE c.id_utilisateur = ?
              GROUP BY c.id_categorie_depense
              ORDER BY c.actif DESC, c.nom ASC`,
            [id_utilisateur]
        );
        return rows.map((r) => ({ ...r, actif: !!r.actif, nb_depenses: parseInt(r.nb_depenses, 10) || 0 }));
    }

    /** Crée les catégories par défaut si le compte n'en a encore aucune. */
    static async initialiserSiVide(id_utilisateur) {
        const [[r]] = await pool.execute(
            `SELECT COUNT(*) AS n FROM categories_depenses WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );
        if ((parseInt(r.n, 10) || 0) > 0) return false;
        for (const [nom, description] of CATEGORIES_PAR_DEFAUT) {
            // INSERT IGNORE : deux requêtes simultanées ne créent pas de doublon (clé unique nom + compte)
            await pool.execute(
                `INSERT IGNORE INTO categories_depenses (id_utilisateur, nom, description) VALUES (?, ?, ?)`,
                [id_utilisateur, nom, description]
            );
        }
        return true;
    }

    static async create({ nom, description }, id_utilisateur) {
        const n = String(nom || '').trim();
        if (!n) throw fail('Le nom de la catégorie est obligatoire');
        if (n.length > 100) throw fail('Nom trop long (100 caractères maximum)');
        try {
            const [r] = await pool.execute(
                `INSERT INTO categories_depenses (id_utilisateur, nom, description) VALUES (?, ?, ?)`,
                [id_utilisateur, n, String(description || '').trim() || null]
            );
            return r.insertId;
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') throw fail('Une catégorie porte déjà ce nom', 409);
            throw e;
        }
    }

    static async update(id, data, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT * FROM categories_depenses WHERE id_categorie_depense = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        if (rows.length === 0) throw fail('Catégorie introuvable', 404);
        const c = rows[0];
        const nom = data.nom !== undefined ? String(data.nom).trim() : c.nom;
        if (!nom) throw fail('Le nom de la catégorie est obligatoire');
        if (nom.length > 100) throw fail('Nom trop long (100 caractères maximum)');
        const description = data.description !== undefined ? (String(data.description).trim() || null) : c.description;
        const actif = data.actif !== undefined ? (data.actif ? 1 : 0) : (c.actif ? 1 : 0);
        try {
            await pool.execute(
                `UPDATE categories_depenses SET nom = ?, description = ?, actif = ?
                  WHERE id_categorie_depense = ? AND id_utilisateur = ?`,
                [nom, description, actif, id, id_utilisateur]
            );
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') throw fail('Une catégorie porte déjà ce nom', 409);
            throw e;
        }
        return true;
    }
}

export default Depense;
