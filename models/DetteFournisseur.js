// models/DetteFournisseur.js
//
// Ce que l'on doit aux fournisseurs, calculé sur ce qui a été RÉELLEMENT REÇU :
//
//   dette = réceptions non annulées − retours fournisseurs TRAITÉS − paiements
//
// Un paiement peut viser une commande d'achat précise, ou non (id_commande_achat NULL) :
// dans ce cas il est réparti automatiquement sur les commandes les plus anciennes
// encore dues, et le surplus éventuel reste comme AVANCE chez le fournisseur.
// Les paiements fournisseurs sont hors caisse (ils ne touchent pas au tiroir).
import crypto from 'crypto';
import { pool } from '../config/db.js';

import { CODES_MODES } from '../utils/modesPaiement.js';
export const MODES_PAIEMENT_FOURNISSEUR = CODES_MODES;

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;
const isoDate = (v) => {
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

class DetteFournisseur {
    /* ============================================================
       CALCULS
       ============================================================ */

    /** Situation de chaque commande d'achat (non annulée). */
    static async _commandes(db, id_utilisateur, id_fournisseur = null) {
        const params = [id_utilisateur, id_utilisateur, id_utilisateur, id_utilisateur];
        let filtre = '';
        if (id_fournisseur) { filtre = ' AND ca.id_fournisseur = ?'; params.push(id_fournisseur); }
        const [rows] = await db.execute(
            `SELECT ca.id_commande_achat, ca.numero_commande, ca.date_commande, ca.statut,
                    ca.montant_total AS montant_commande, ca.id_fournisseur,
                    COALESCE(r.recu, 0) AS recu, r.derniere_reception, COALESCE(r.nb_receptions, 0) AS nb_receptions,
                    COALESCE(rt.retours, 0) AS retours,
                    COALESCE(p.paye, 0) AS paye, p.dernier_paiement
               FROM commandes_achat ca
               LEFT JOIN (
                    SELECT id_commande_achat, SUM(montant_total) AS recu, MAX(date_reception) AS derniere_reception,
                           COUNT(*) AS nb_receptions
                      FROM receptions
                     WHERE id_utilisateur = ? AND statut <> 'annulee' AND id_commande_achat IS NOT NULL
                     GROUP BY id_commande_achat
               ) r ON r.id_commande_achat = ca.id_commande_achat
               LEFT JOIN (
                    SELECT id_commande_achat, SUM(montant_total) AS retours
                      FROM retours_fournisseurs
                     WHERE id_utilisateur = ? AND statut = 'traite' AND id_commande_achat IS NOT NULL
                     GROUP BY id_commande_achat
               ) rt ON rt.id_commande_achat = ca.id_commande_achat
               LEFT JOIN (
                    SELECT id_commande_achat, SUM(montant) AS paye, MAX(date_paiement) AS dernier_paiement
                      FROM paiements_fournisseurs
                     WHERE id_utilisateur = ? AND id_commande_achat IS NOT NULL AND annule = 0
                     GROUP BY id_commande_achat
               ) p ON p.id_commande_achat = ca.id_commande_achat
              WHERE ca.id_utilisateur = ? AND ca.statut <> 'annulee'${filtre}
              ORDER BY COALESCE(r.derniere_reception, ca.date_commande) ASC, ca.id_commande_achat ASC`,
            params
        );
        return rows.map((c) => {
            const recu = num(c.recu);
            const retours = num(c.retours);
            const paye = num(c.paye);
            return {
                ...c,
                montant_commande: num(c.montant_commande),
                recu, retours, paye,
                nb_receptions: parseInt(c.nb_receptions, 10) || 0,
                reste: r2(recu - retours - paye),
            };
        });
    }

    /** Retours traités et paiements NON rattachés à une commande, par fournisseur. */
    static async _horsCommande(db, id_utilisateur, id_fournisseur = null) {
        const filtreF = id_fournisseur ? ' AND id_fournisseur = ?' : '';
        const p = id_fournisseur ? [id_utilisateur, id_fournisseur] : [id_utilisateur];
        const [ret] = await db.execute(
            `SELECT id_fournisseur, SUM(montant_total) AS total FROM retours_fournisseurs
              WHERE id_utilisateur = ? AND statut = 'traite' AND id_commande_achat IS NULL${filtreF}
              GROUP BY id_fournisseur`, p);
        const [pay] = await db.execute(
            `SELECT id_fournisseur, SUM(montant) AS total, MAX(date_paiement) AS dernier FROM paiements_fournisseurs
              WHERE id_utilisateur = ? AND id_commande_achat IS NULL AND annule = 0${filtreF}
              GROUP BY id_fournisseur`, p);
        const [enCours] = await db.execute(
            `SELECT id_fournisseur, SUM(montant_total) AS total, COUNT(*) AS nb FROM retours_fournisseurs
              WHERE id_utilisateur = ? AND statut IN ('en_attente', 'envoye', 'recu_par_fournisseur')${filtreF}
              GROUP BY id_fournisseur`, p);
        const parF = new Map();
        const get = (id) => {
            if (!parF.has(id)) parF.set(id, { retours: 0, avances: 0, dernier: null, retours_en_cours: 0, nb_retours_en_cours: 0 });
            return parF.get(id);
        };
        ret.forEach((r) => { get(r.id_fournisseur).retours = num(r.total); });
        pay.forEach((r) => { const x = get(r.id_fournisseur); x.avances = num(r.total); x.dernier = r.dernier; });
        enCours.forEach((r) => { const x = get(r.id_fournisseur); x.retours_en_cours = num(r.total); x.nb_retours_en_cours = parseInt(r.nb, 10) || 0; });
        return parF;
    }

    static _synthese(fournisseur, commandes, hors) {
        const recu = commandes.reduce((s, c) => s + c.recu, 0);
        const retours = commandes.reduce((s, c) => s + c.retours, 0) + (hors?.retours || 0);
        const paye = commandes.reduce((s, c) => s + c.paye, 0) + (hors?.avances || 0);
        const dates = [hors?.dernier, ...commandes.map((c) => c.dernier_paiement)].filter(Boolean).map((d) => new Date(d));
        const solde = r2(recu - retours - paye);
        return {
            ...fournisseur,
            recu: r2(recu),
            retours: r2(retours),
            paye: r2(paye),
            avances_non_affectees: r2(hors?.avances || 0),
            solde,                                  // > 0 : on doit ; < 0 : avance chez le fournisseur
            reste_a_payer: Math.max(0, solde),
            avance: Math.max(0, -solde),
            nb_commandes_dues: commandes.filter((c) => c.reste > 0.009).length,
            dernier_paiement: dates.length ? new Date(Math.max(...dates)) : null,
            retours_en_cours: r2(hors?.retours_en_cours || 0),
            nb_retours_en_cours: hors?.nb_retours_en_cours || 0,
        };
    }

    /* ============================================================
       LECTURE
       ============================================================ */

    /** Tous les fournisseurs ayant une activité, avec leur solde, + totaux. */
    static async liste(id_utilisateur) {
        const [fournisseurs] = await pool.execute(
            `SELECT id_fournisseur, nom, telephone, email, ville, actif
               FROM fournisseurs WHERE id_utilisateur = ? ORDER BY nom ASC`,
            [id_utilisateur]
        );
        const commandes = await this._commandes(pool, id_utilisateur);
        const hors = await this._horsCommande(pool, id_utilisateur);
        const parF = new Map();
        commandes.forEach((c) => {
            if (!parF.has(c.id_fournisseur)) parF.set(c.id_fournisseur, []);
            parF.get(c.id_fournisseur).push(c);
        });

        const lignes = fournisseurs
            .map((f) => this._synthese({ ...f, actif: !!f.actif }, parF.get(f.id_fournisseur) || [], hors.get(f.id_fournisseur)))
            .filter((f) => f.recu > 0 || f.paye > 0 || f.retours > 0 || f.retours_en_cours > 0)
            .sort((a, b) => b.solde - a.solde || a.nom.localeCompare(b.nom));

        return {
            fournisseurs: lignes,
            totaux: {
                total_du: r2(lignes.reduce((s, f) => s + f.reste_a_payer, 0)),
                total_avances: r2(lignes.reduce((s, f) => s + f.avance, 0)),
                nb_fournisseurs_dus: lignes.filter((f) => f.reste_a_payer > 0.009).length,
                total_recu: r2(lignes.reduce((s, f) => s + f.recu, 0)),
                total_paye: r2(lignes.reduce((s, f) => s + f.paye, 0)),
            },
        };
    }

    static async _fournisseur(db, id_fournisseur, id_utilisateur) {
        const [rows] = await db.execute(
            `SELECT id_fournisseur, nom, telephone, email, ville, actif
               FROM fournisseurs WHERE id_fournisseur = ? AND id_utilisateur = ?`,
            [id_fournisseur, id_utilisateur]
        );
        if (!rows[0]) throw fail('Fournisseur introuvable', 404);
        return { ...rows[0], actif: !!rows[0].actif };
    }

    /** Détail d'un fournisseur : synthèse, commandes, historique des paiements. */
    static async detail(id_fournisseur, id_utilisateur) {
        const f = await this._fournisseur(pool, id_fournisseur, id_utilisateur);
        const commandes = await this._commandes(pool, id_utilisateur, id_fournisseur);
        const hors = (await this._horsCommande(pool, id_utilisateur, id_fournisseur)).get(Number(id_fournisseur));
        const [paiements] = await pool.execute(
            `SELECT p.id_paiement_fournisseur, DATE_FORMAT(p.date_paiement, '%Y-%m-%d') AS date_paiement,
                    p.montant, p.mode_paiement, p.reference, p.note, p.id_commande_achat,
                    ca.numero_commande, p.cree_par_nom, p.date_creation, p.groupe,
                    p.justificatif IS NOT NULL AS a_justificatif
               FROM paiements_fournisseurs p
               LEFT JOIN commandes_achat ca ON ca.id_commande_achat = p.id_commande_achat
              WHERE p.id_utilisateur = ? AND p.id_fournisseur = ? AND p.annule = 0
              ORDER BY p.date_paiement DESC, p.id_paiement_fournisseur DESC
              LIMIT 500`,
            [id_utilisateur, id_fournisseur]
        );
        return {
            fournisseur: this._synthese(f, commandes, hors),
            commandes: commandes
                .filter((c) => c.recu > 0 || c.paye > 0 || c.retours > 0)
                .map((c) => ({ ...c, date_commande: isoDate(c.date_commande instanceof Date ? c.date_commande.toISOString() : c.date_commande) || c.date_commande })),
            commandes_sans_reception: commandes.filter((c) => c.nb_receptions === 0 && c.paye === 0).length,
            paiements: paiements.map((p) => ({ ...p, montant: num(p.montant), a_justificatif: !!p.a_justificatif })),
        };
    }

    /* ============================================================
       PAIEMENT
       ============================================================ */

    /**
     * Enregistre un paiement.
     *  - avec id_commande_achat : sur cette commande (sans dépasser son reste)
     *  - sans : réparti sur les commandes les plus anciennes encore dues ; le surplus = avance
     * Retourne les lignes créées.
     */
    static async payer({ id_utilisateur, id_fournisseur, id_commande_achat, montant, date_paiement,
                         mode_paiement, reference, note, par, justificatif = null }) {
        const total = r2(num(String(montant ?? '').replace(',', '.')));
        if (!(total > 0)) throw fail('Le montant doit être supérieur à 0');
        const mode = MODES_PAIEMENT_FOURNISSEUR.includes(mode_paiement) ? mode_paiement : 'especes';
        const date = isoDate(date_paiement) || new Date().toISOString().slice(0, 10);
        const ref = String(reference || '').trim().slice(0, 100) || null;
        const texte = String(note || '').trim() || null;

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            // Verrou sur le fournisseur : deux paiements simultanés ne se répartissent pas sur la même dette
            const [fr] = await conn.execute(
                'SELECT id_fournisseur FROM fournisseurs WHERE id_fournisseur = ? AND id_utilisateur = ? FOR UPDATE',
                [id_fournisseur, id_utilisateur]
            );
            if (!fr[0]) throw fail('Fournisseur introuvable', 404);

            const commandes = await this._commandes(conn, id_utilisateur, id_fournisseur);
            const affectations = [];

            if (id_commande_achat) {
                const c = commandes.find((x) => Number(x.id_commande_achat) === Number(id_commande_achat));
                if (!c) throw fail("Cette commande n'appartient pas à ce fournisseur (ou elle est annulée)");
                if (total > c.reste + 0.009) {
                    throw fail(`Le montant dépasse le reste à payer de la commande ${c.numero_commande} (${Math.round(c.reste)} FCFA). `
                        + 'Choisissez « Répartition automatique » pour payer plusieurs commandes ou verser une avance.');
                }
                affectations.push({ id_commande_achat: c.id_commande_achat, montant: total, numero: c.numero_commande });
            } else {
                let restant = total;
                for (const c of commandes) {
                    if (restant <= 0.009) break;
                    if (c.reste <= 0.009) continue;
                    const part = r2(Math.min(c.reste, restant));
                    affectations.push({ id_commande_achat: c.id_commande_achat, montant: part, numero: c.numero_commande });
                    restant = r2(restant - part);
                }
                if (restant > 0.009) affectations.push({ id_commande_achat: null, montant: restant, numero: null });
            }

            const crees = [];
            // Un même versement réparti sur plusieurs commandes = un seul « groupe »
            const groupe = `v-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
            for (const a of affectations) {
                const [r] = await conn.execute(
                    `INSERT INTO paiements_fournisseurs
                        (id_utilisateur, id_fournisseur, id_commande_achat, date_paiement, montant, mode_paiement,
                         reference, note, cree_par_type, cree_par_id, cree_par_nom, justificatif, groupe)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id_utilisateur, id_fournisseur, a.id_commande_achat, date, a.montant, mode, ref,
                     affectations.length > 1 ? [texte, `Paiement réparti (${total} FCFA au total)`].filter(Boolean).join(' · ') : texte,
                     par.type, par.id ?? null, par.nom || null, justificatif || null, groupe]
                );
                crees.push({ id_paiement_fournisseur: r.insertId, ...a });
            }
            await conn.commit();
            return { total, groupe, affectations: crees };
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    /**
     * Annule un versement (on ne supprime jamais) : toutes les lignes du même groupe
     * (versement réparti sur plusieurs commandes) sont annulées ensemble.
     */
    static async annulerPaiement(id_paiement, id_utilisateur, motif, par) {
        const raison = String(motif || '').trim().slice(0, 500);
        if (!raison) throw fail("Expliquez la raison de l'annulation");
        const [rows] = await pool.execute(
            'SELECT id_paiement_fournisseur, groupe, annule FROM paiements_fournisseurs WHERE id_paiement_fournisseur = ? AND id_utilisateur = ?',
            [id_paiement, id_utilisateur]
        );
        const p = rows[0];
        if (!p) throw fail('Paiement introuvable', 404);
        if (p.annule) throw fail('Ce versement est déjà annulé');
        const [r] = await pool.execute(
            `UPDATE paiements_fournisseurs SET annule = 1, motif_annulation = ?, annule_le = NOW(), annule_par_nom = ?
              WHERE id_utilisateur = ? AND annule = 0 AND ${p.groupe ? 'groupe = ?' : 'id_paiement_fournisseur = ?'}`,
            [raison, par?.nom || null, id_utilisateur, p.groupe || p.id_paiement_fournisseur]
        );
        return r.affectedRows;
    }
}

export default DetteFournisseur;
