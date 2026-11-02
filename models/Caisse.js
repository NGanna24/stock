// models/Caisse.js
//
// Caisse journalière : ouverture (fond de caisse) → ventes / dépenses → clôture (comptage).
//
// Espèces attendues dans le tiroir =
//     fond initial
//   + paiements en espèces encaissés depuis l'ouverture   (table paiements, montant > 0)
//   − remboursements en espèces (retours clients)           (table paiements, montant < 0)
//   − dépenses payées en espèces depuis l'ouverture         (table depenses)
//
// Les autres modes (carte, virement, chèque, mobile money…) sont affichés à titre
// d'information : ils ne sont pas dans le tiroir.
// On se base sur la date d'ENREGISTREMENT (date_creation) pour rester exact à la minute.
import { pool } from '../config/db.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;

const castSession = (s) => {
    if (!s) return null;
    const out = { ...s };
    for (const k of ['fond_initial', 'especes_encaissees', 'especes_remboursees', 'depenses_especes',
        'autres_encaissements', 'montant_theorique', 'montant_compte', 'ecart']) {
        if (out[k] !== null && out[k] !== undefined) out[k] = num(out[k]);
    }
    if (out.detail_comptage) {
        try { out.detail_comptage = JSON.parse(out.detail_comptage); } catch { /* texte libre */ }
    }
    return out;
};

class Caisse {
    /* ============================================================
       CALCULS
       ============================================================ */

    /** Totaux entre deux instants (fin = maintenant si null). */
    static async _totaux(db, id_utilisateur, debut, fin = null) {
        const borne = fin ? 'AND date_creation <= ?' : '';
        const p = fin ? [id_utilisateur, debut, fin] : [id_utilisateur, debut];

        const [pay] = await db.execute(
            `SELECT mode_paiement,
                    COALESCE(SUM(CASE WHEN montant > 0 THEN montant ELSE 0 END), 0) AS encaisse,
                    COALESCE(SUM(CASE WHEN montant < 0 THEN -montant ELSE 0 END), 0) AS rembourse,
                    COUNT(*) AS nombre
               FROM paiements
              WHERE id_utilisateur = ? AND date_creation >= ? ${borne}
              GROUP BY mode_paiement`,
            p
        );
        const [dep] = await db.execute(
            `SELECT mode_paiement, COALESCE(SUM(montant), 0) AS total, COUNT(*) AS nombre
               FROM depenses
              WHERE id_utilisateur = ? AND date_creation >= ? ${borne}
              GROUP BY mode_paiement`,
            p
        );

        const especes = pay.find((r) => r.mode_paiement === 'especes');
        const depEspeces = dep.find((r) => r.mode_paiement === 'especes');
        const autres = pay.filter((r) => r.mode_paiement !== 'especes');

        return {
            especes_encaissees: r2(num(especes?.encaisse)),
            especes_remboursees: r2(num(especes?.rembourse)),
            depenses_especes: r2(num(depEspeces?.total)),
            nb_paiements: pay.reduce((s, r) => s + (parseInt(r.nombre, 10) || 0), 0),
            nb_depenses: dep.reduce((s, r) => s + (parseInt(r.nombre, 10) || 0), 0),
            autres_modes: autres.map((r) => ({
                mode_paiement: r.mode_paiement,
                encaisse: r2(num(r.encaisse) - num(r.rembourse)),
                nombre: parseInt(r.nombre, 10) || 0,
            })),
            autres_encaissements: r2(autres.reduce((s, r) => s + num(r.encaisse) - num(r.rembourse), 0)),
            depenses_autres_modes: r2(dep.filter((r) => r.mode_paiement !== 'especes').reduce((s, r) => s + num(r.total), 0)),
        };
    }

    static _theorique(fond, t) {
        return r2(num(fond) + t.especes_encaissees - t.especes_remboursees - t.depenses_especes);
    }

    /** Liste chronologique des mouvements d'une session (paiements + dépenses). */
    static async _mouvements(db, id_utilisateur, debut, fin = null, limite = 300) {
        const borne = fin ? 'AND p.date_creation <= ?' : '';
        const borneD = fin ? 'AND d.date_creation <= ?' : '';
        const p = fin ? [id_utilisateur, debut, fin] : [id_utilisateur, debut];
        const [paiements] = await db.execute(
            `SELECT p.id_paiement AS id, p.date_creation AS date, p.montant, p.mode_paiement,
                    p.reference, p.note, f.numero_facture, cv.nomclient
               FROM paiements p
               LEFT JOIN factures_vente f ON f.id_facture = p.id_facture
               LEFT JOIN commandes_vente cv ON cv.id_commande = f.id_commande
              WHERE p.id_utilisateur = ? AND p.date_creation >= ? ${borne}
              ORDER BY p.date_creation DESC
              LIMIT ${Number(limite)}`,
            p
        );
        const [depenses] = await db.execute(
            `SELECT d.id_depense AS id, d.date_creation AS date, d.montant, d.mode_paiement,
                    d.libelle, d.reference, c.nom AS categorie_nom
               FROM depenses d
               LEFT JOIN categories_depenses c ON c.id_categorie_depense = d.id_categorie_depense
              WHERE d.id_utilisateur = ? AND d.date_creation >= ? ${borneD}
              ORDER BY d.date_creation DESC
              LIMIT ${Number(limite)}`,
            p
        );
        return [
            ...paiements.map((x) => ({
                type: num(x.montant) < 0 ? 'remboursement' : 'encaissement',
                id: x.id, date: x.date, montant: Math.abs(num(x.montant)), mode_paiement: x.mode_paiement,
                libelle: num(x.montant) < 0
                    ? `Remboursement${x.reference ? ` ${x.reference}` : ''}`
                    : `Facture ${x.numero_facture || '-'}${x.nomclient ? ` · ${x.nomclient}` : ''}`,
                reference: x.reference,
            })),
            ...depenses.map((x) => ({
                type: 'depense', id: x.id, date: x.date, montant: num(x.montant), mode_paiement: x.mode_paiement,
                libelle: x.libelle, categorie_nom: x.categorie_nom, reference: x.reference,
            })),
        ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limite);
    }

    /* ============================================================
       LECTURE
       ============================================================ */
    static async _ouverte(db, id_utilisateur, lock = false) {
        const [rows] = await db.execute(
            `SELECT * FROM sessions_caisse
              WHERE id_utilisateur = ? AND statut = 'ouverte'
              ORDER BY date_ouverture DESC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
            [id_utilisateur]
        );
        return rows[0] || null;
    }

    /** Session ouverte avec ses totaux en direct, ou null ; + la dernière clôture. */
    static async getCourante(id_utilisateur) {
        const s = await this._ouverte(pool, id_utilisateur);
        const [der] = await pool.execute(
            `SELECT * FROM sessions_caisse
              WHERE id_utilisateur = ? AND statut = 'cloturee'
              ORDER BY date_cloture DESC LIMIT 1`,
            [id_utilisateur]
        );
        const derniere = castSession(der[0] || null);
        if (!s) return { session: null, derniere_cloture: derniere };

        const t = await this._totaux(pool, id_utilisateur, s.date_ouverture);
        const [[now]] = await pool.query('SELECT NOW() AS maintenant');
        return {
            session: {
                ...castSession(s),
                ...t,
                montant_theorique: this._theorique(s.fond_initial, t),
                maintenant: now.maintenant,
            },
            mouvements: await this._mouvements(pool, id_utilisateur, s.date_ouverture),
            derniere_cloture: derniere,
        };
    }

    static async getById(id_session, id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT * FROM sessions_caisse WHERE id_session = ? AND id_utilisateur = ?`,
            [id_session, id_utilisateur]
        );
        const s = rows[0];
        if (!s) throw fail('Session de caisse introuvable', 404);
        const fin = s.statut === 'cloturee' ? s.date_cloture : null;
        let session = castSession(s);
        if (s.statut === 'ouverte') {
            const t = await this._totaux(pool, id_utilisateur, s.date_ouverture);
            session = { ...session, ...t, montant_theorique: this._theorique(s.fond_initial, t) };
        } else {
            const t = await this._totaux(pool, id_utilisateur, s.date_ouverture, fin);
            session = { ...session, autres_modes: t.autres_modes, nb_paiements: t.nb_paiements, nb_depenses: t.nb_depenses };
        }
        return { session, mouvements: await this._mouvements(pool, id_utilisateur, s.date_ouverture, fin) };
    }

    static async historique(id_utilisateur, { dateDebut, dateFin } = {}) {
        const params = [id_utilisateur];
        let filtre = '';
        if (dateDebut) { filtre += ' AND date_ouverture >= ?'; params.push(`${String(dateDebut).slice(0, 10)} 00:00:00`); }
        if (dateFin) { filtre += ' AND date_ouverture <= ?'; params.push(`${String(dateFin).slice(0, 10)} 23:59:59`); }
        const [rows] = await pool.execute(
            `SELECT * FROM sessions_caisse
              WHERE id_utilisateur = ?${filtre}
              ORDER BY date_ouverture DESC
              LIMIT 500`,
            params
        );
        return rows.map(castSession);
    }

    /* ============================================================
       OUVRIR / CLÔTURER
       ============================================================ */
    static async ouvrir({ id_utilisateur, fond_initial, note, par }) {
        const fond = r2(num(String(fond_initial ?? '0').replace(',', '.')));
        if (fond < 0) throw fail('Le fond de caisse ne peut pas être négatif');

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            // Verrou sur le compte : deux personnes ne peuvent pas ouvrir la caisse en même temps
            await conn.execute('SELECT id_utilisateur FROM utilisateurs WHERE id_utilisateur = ? FOR UPDATE', [id_utilisateur]);
            const deja = await this._ouverte(conn, id_utilisateur, true);
            if (deja) throw fail(`La caisse est déjà ouverte (par ${deja.ouvert_par_nom || 'un utilisateur'}).`, 409);

            const [r] = await conn.execute(
                `INSERT INTO sessions_caisse
                    (id_utilisateur, statut, date_ouverture, ouvert_par_type, ouvert_par_id, ouvert_par_nom,
                     fond_initial, note_ouverture)
                 VALUES (?, 'ouverte', NOW(), ?, ?, ?, ?, ?)`,
                [id_utilisateur, par.type, par.id, par.nom || null, fond, String(note || '').trim() || null]
            );
            await conn.commit();
            return r.insertId;
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    static async cloturer({ id_session, id_utilisateur, montant_compte, detail_comptage, note, par }) {
        const compte = r2(num(String(montant_compte ?? '').replace(',', '.')));
        if (montant_compte === undefined || montant_compte === null || montant_compte === '' || compte < 0) {
            throw fail('Saisissez le montant compté dans le tiroir');
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [rows] = await conn.execute(
                `SELECT * FROM sessions_caisse WHERE id_session = ? AND id_utilisateur = ? FOR UPDATE`,
                [id_session, id_utilisateur]
            );
            const s = rows[0];
            if (!s) throw fail('Session de caisse introuvable', 404);
            if (s.statut !== 'ouverte') throw fail('Cette caisse est déjà clôturée', 409);

            const [[now]] = await conn.query('SELECT NOW() AS maintenant');
            const t = await this._totaux(conn, id_utilisateur, s.date_ouverture, now.maintenant);
            const theorique = this._theorique(s.fond_initial, t);
            const ecart = r2(compte - theorique);
            const texte = String(note || '').trim();
            if (Math.abs(ecart) >= 1 && !texte) {
                throw fail(`Écart de ${ecart > 0 ? '+' : ''}${ecart} FCFA : indiquez une explication avant de clôturer.`);
            }

            await conn.execute(
                `UPDATE sessions_caisse
                    SET statut = 'cloturee', date_cloture = ?,
                        cloture_par_type = ?, cloture_par_id = ?, cloture_par_nom = ?,
                        especes_encaissees = ?, especes_remboursees = ?, depenses_especes = ?,
                        autres_encaissements = ?, montant_theorique = ?, montant_compte = ?, ecart = ?,
                        detail_comptage = ?, note_cloture = ?
                  WHERE id_session = ?`,
                [now.maintenant, par.type, par.id, par.nom || null,
                 t.especes_encaissees, t.especes_remboursees, t.depenses_especes,
                 t.autres_encaissements, theorique, compte, ecart,
                 detail_comptage ? JSON.stringify(detail_comptage) : null, texte || null,
                 id_session]
            );
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        return this.getById(id_session, id_utilisateur);
    }
}

export default Caisse;
