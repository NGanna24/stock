// models/Recette.js
//
// Recettes = argent reçu des clients (table paiements).
//   - un encaissement est un paiement POSITIF ;
//   - un remboursement (retour client remboursé en espèces) est un paiement NÉGATIF ;
//   - le net de la période = encaissements − remboursements.
//
// Règles :
//   - une recette met à jour le statut de sa facture (en attente → partielle → payée)
//     et ne peut pas dépasser ce qui reste à payer ;
//   - supprimer une recette recalcule le statut de la facture ;
//   - un remboursement se gère depuis son retour client, pas d'ici.
import { pool } from '../config/db.js';

import { CODES_MODES } from '../utils/modesPaiement.js';
const MODES = CODES_MODES;
const erreur = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const jourISO = (d) => {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Statut d'une facture d'après ce qui a été payé (même règle que l'encaissement d'une vente). */
const statutDepuis = (paye, total) => {
    if (paye >= total - 0.009 && total > 0) return 'payee';
    if (paye > 0.009) return 'partiellement_payee';
    return 'en_attente';
};

class Recette {
    /**
     * Paiements de la période (encaissements ET remboursements), filtrés.
     * Chaque ligne indique si la vente d'origine a été supprimée ou annulée.
     */
    static async findAll(id_utilisateur, filters = {}) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findAll');

        const conditions = ['pa.id_utilisateur = ?'];
        const params = [id_utilisateur];

        if (filters.dateDebut) { conditions.push('pa.date_paiement >= ?'); params.push(filters.dateDebut); }
        if (filters.dateFin) { conditions.push('pa.date_paiement <= ?'); params.push(filters.dateFin); }
        if (filters.modePaiement && MODES.includes(filters.modePaiement)) {
            conditions.push('pa.mode_paiement = ?'); params.push(filters.modePaiement);
        }
        if (filters.type === 'encaissements') conditions.push('pa.montant > 0');
        if (filters.type === 'remboursements') conditions.push('pa.montant < 0');
        if (filters.search && String(filters.search).trim()) {
            conditions.push(`(fv.numero_facture LIKE ? OR cv.numero_commande LIKE ? OR cv.nomclient LIKE ?
                              OR cv.telephone LIKE ? OR pa.reference LIKE ?)`);
            const term = `%${String(filters.search).trim()}%`;
            params.push(term, term, term, term, term);
        }

        const [rows] = await pool.query(
            `SELECT
                pa.id_paiement, pa.date_paiement, pa.montant, pa.mode_paiement, pa.note, pa.reference,
                pa.date_creation,
                fv.id_facture, fv.numero_facture, fv.statut AS statut_facture, fv.montant_total AS montant_facture,
                cv.id_commande, cv.numero_commande, cv.nomclient, cv.telephone, cv.statut AS statut_commande,
                DATE_FORMAT(pa.date_paiement, '%d/%m/%Y') AS date_formatee,
                DATE_FORMAT(pa.date_creation, '%d/%m/%Y %H:%i') AS date_creation_formatee
             FROM paiements pa
             LEFT JOIN factures_vente fv ON pa.id_facture = fv.id_facture AND fv.id_utilisateur = pa.id_utilisateur
             LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
             WHERE ${conditions.join(' AND ')}
             ORDER BY pa.date_paiement DESC, pa.date_creation DESC, pa.id_paiement DESC`,
            params
        );

        return rows.map((r) => ({
            ...r,
            date_paiement: jourISO(r.date_paiement),
            montant: num(r.montant),
            montant_facture: num(r.montant_facture),
            type: num(r.montant) < 0 ? 'remboursement' : 'encaissement',
            vente_supprimee: !!r.id_facture && !r.id_commande,
            vente_annulee: r.statut_commande === 'annulee' || r.statut_facture === 'annulee',
        }));
    }

    /**
     * Totaux, courbe par jour (jours sans recette inclus), répartition par mode et meilleurs clients,
     * calculés sur les MÊMES lignes que la liste (les chiffres correspondent toujours au tableau).
     */
    static resumer(lignes, { dateDebut, dateFin } = {}) {
        const enc = lignes.filter((l) => l.montant > 0);
        const rem = lignes.filter((l) => l.montant < 0);
        const somme = (arr) => num(arr.reduce((s, l) => s + l.montant, 0));
        const totalEnc = somme(enc);
        const totalRem = -somme(rem);

        const parMode = {};
        MODES.forEach((m) => { parMode[m] = 0; });
        // Un ancien mode inconnu compte quand même
        enc.forEach((l) => { if (!(l.mode_paiement in parMode)) parMode[l.mode_paiement] = 0; });
        enc.forEach((l) => { parMode[l.mode_paiement] = num((parMode[l.mode_paiement] || 0) + l.montant); });

        // Par jour : tous les jours de la période (max 400), même sans recette
        const parJourMap = new Map();
        if (dateDebut && dateFin && dateDebut <= dateFin) {
            const d = new Date(`${dateDebut}T00:00:00Z`);
            const fin = new Date(`${dateFin}T00:00:00Z`);
            for (let i = 0; d <= fin && i < 400; i++) {
                parJourMap.set(jourISO(d), { date: jourISO(d), encaisse: 0, rembourse: 0, net: 0, nombre_paiements: 0 });
                d.setUTCDate(d.getUTCDate() + 1);
            }
        }
        lignes.forEach((l) => {
            const j = l.date_paiement;
            if (!parJourMap.has(j)) parJourMap.set(j, { date: j, encaisse: 0, rembourse: 0, net: 0, nombre_paiements: 0 });
            const x = parJourMap.get(j);
            if (l.montant > 0) { x.encaisse = num(x.encaisse + l.montant); x.nombre_paiements++; } else x.rembourse = num(x.rembourse - l.montant);
            x.net = num(x.encaisse - x.rembourse);
        });
        const parJour = [...parJourMap.values()].sort((a, b) => a.date.localeCompare(b.date))
            // compatibilité : l'ancien champ « total » = net du jour
            .map((x) => ({ ...x, total: x.net }));

        // Meilleurs clients (par téléphone, sinon par nom)
        const clients = new Map();
        enc.forEach((l) => {
            if (!l.nomclient && !l.telephone) return;
            const cle = l.telephone || l.nomclient;
            const c = clients.get(cle) || { nomclient: l.nomclient, telephone: l.telephone, total_recettes: 0, nombre_paiements: 0, factures: new Set() };
            c.total_recettes = num(c.total_recettes + l.montant);
            c.nombre_paiements++;
            if (l.id_facture) c.factures.add(l.id_facture);
            if (!c.nomclient && l.nomclient) c.nomclient = l.nomclient;
            clients.set(cle, c);
        });
        const topClients = [...clients.values()]
            .map(({ factures, ...c }) => ({ ...c, nombre_factures: factures.size }))
            .sort((a, b) => b.total_recettes - a.total_recettes)
            .slice(0, 10);

        return {
            stats: {
                total_encaisse: totalEnc,
                total_rembourse: totalRem,
                net: num(totalEnc - totalRem),
                nombre_encaissements: enc.length,
                nombre_remboursements: rem.length,
                nombre_factures: new Set(enc.map((l) => l.id_facture).filter(Boolean)).size,
                moyenne_paiement: enc.length ? num(totalEnc / enc.length) : 0,
                nb_ventes_supprimees: lignes.filter((l) => l.vente_supprimee).length,
                par_mode: parMode,
                // compatibilité avec l'ancienne page
                total_recettes: num(totalEnc - totalRem),
                nombre_paiements: enc.length,
            },
            par_jour: parJour,
            par_mode: Object.keys(parMode).map((m) => ({
                mode_paiement: m,
                nombre: enc.filter((l) => l.mode_paiement === m).length,
                total: parMode[m],
            })).filter((m) => m.nombre > 0).sort((a, b) => b.total - a.total),
            top_clients: topClients,
        };
    }

    /** Statistiques seules (même calcul que la page). */
    static async getStats(id_utilisateur, filters = {}) {
        const lignes = await Recette.findAll(id_utilisateur, filters);
        return Recette.resumer(lignes, filters).stats;
    }

    /**
     * Encaisser une facture (recette manuelle).
     * Vérifie que la facture est à ce compte, non annulée, et que le montant ne dépasse pas le reste.
     */
    static async create(data, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour create');
        const idFacture = parseInt(data.id_facture, 10);
        const montant = num(data.montant);
        if (!idFacture) throw erreur('La facture est obligatoire');
        if (!(montant > 0)) throw erreur('Le montant doit être supérieur à 0');
        if (!data.date_paiement || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date_paiement))) {
            throw erreur('La date de paiement est obligatoire');
        }
        const mode = MODES.includes(data.mode_paiement) ? data.mode_paiement : 'especes';

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            // Verrou sur la facture : deux encaissements simultanés ne peuvent pas dépasser le total
            const [factures] = await connection.query(
                `SELECT fv.id_facture, fv.numero_facture, fv.montant_total, fv.statut, cv.statut AS statut_commande
                 FROM factures_vente fv
                 LEFT JOIN commandes_vente cv ON cv.id_commande = fv.id_commande
                 WHERE fv.id_facture = ? AND fv.id_utilisateur = ?
                 FOR UPDATE`,
                [idFacture, id_utilisateur]
            );
            const f = factures[0];
            if (!f) throw erreur('Facture introuvable', 404);
            if (f.statut === 'annulee' || f.statut_commande === 'annulee') throw erreur('Cette facture est annulée : impossible de l\'encaisser');

            const [[{ paye }]] = await connection.query(
                'SELECT COALESCE(SUM(montant), 0) AS paye FROM paiements WHERE id_facture = ? AND id_utilisateur = ?',
                [idFacture, id_utilisateur]
            );
            const total = num(f.montant_total);
            const reste = num(total - num(paye));
            if (reste <= 0.009) throw erreur(`La facture ${f.numero_facture} est déjà entièrement payée`);
            if (montant > reste + 0.009) {
                throw erreur(`Le montant dépasse ce qui reste à payer sur ${f.numero_facture} (${reste.toLocaleString('fr-FR')} FCFA)`);
            }

            const [result] = await connection.execute(
                `INSERT INTO paiements (id_utilisateur, id_facture, date_paiement, montant, mode_paiement, note, reference)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id_utilisateur, idFacture, data.date_paiement, montant, mode,
                 data.note ? String(data.note).slice(0, 1000) : null,
                 data.reference ? String(data.reference).slice(0, 100) : null]
            );

            await connection.execute(
                'UPDATE factures_vente SET statut = ? WHERE id_facture = ? AND id_utilisateur = ?',
                [statutDepuis(num(paye) + montant, total), idFacture, id_utilisateur]
            );
            await connection.commit();
            return result.insertId;
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    }

    /** Une recette par son id (pour la réponse après création). */
    static async findById(id, id_utilisateur) {
        const lignes = await Recette.findAll(id_utilisateur, {});
        return lignes.find((r) => r.id_paiement === Number(id)) || null;
    }

    /**
     * Supprimer un encaissement (erreur de saisie) et remettre la facture au bon statut.
     * Les remboursements (montant négatif) sont liés à un retour client : refusés ici.
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour delete');
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(
                'SELECT id_paiement, id_facture, montant FROM paiements WHERE id_paiement = ? AND id_utilisateur = ? FOR UPDATE',
                [id, id_utilisateur]
            );
            const p = rows[0];
            if (!p) throw erreur('Recette non trouvée', 404);
            if (num(p.montant) < 0) {
                throw erreur('Ceci est un remboursement lié à un retour client : il ne peut pas être supprimé depuis les recettes');
            }

            await connection.execute('DELETE FROM paiements WHERE id_paiement = ? AND id_utilisateur = ?', [id, id_utilisateur]);

            if (p.id_facture) {
                const [fs] = await connection.query(
                    'SELECT montant_total, statut FROM factures_vente WHERE id_facture = ? AND id_utilisateur = ? FOR UPDATE',
                    [p.id_facture, id_utilisateur]
                );
                if (fs[0] && fs[0].statut !== 'annulee') {
                    const [[{ paye }]] = await connection.query(
                        'SELECT COALESCE(SUM(montant), 0) AS paye FROM paiements WHERE id_facture = ? AND id_utilisateur = ?',
                        [p.id_facture, id_utilisateur]
                    );
                    await connection.execute(
                        'UPDATE factures_vente SET statut = ? WHERE id_facture = ? AND id_utilisateur = ?',
                        [statutDepuis(num(paye), num(fs[0].montant_total)), p.id_facture, id_utilisateur]
                    );
                }
            }
            await connection.commit();
            return true;
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    }

    static async exists(id, id_utilisateur) {
        const [rows] = await pool.query(
            'SELECT 1 FROM paiements WHERE id_paiement = ? AND id_utilisateur = ? LIMIT 1',
            [id, id_utilisateur]
        );
        return rows.length > 0;
    }

    /**
     * Factures qui restent à encaisser (reste calculé sur les paiements de CE compte).
     * Exclut les factures annulées et les ventes annulées.
     */
    static async getFacturesImpayees(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getFacturesImpayees');
        const [rows] = await pool.query(
            `SELECT fv.id_facture, fv.numero_facture, fv.date_facture, fv.date_echeance, fv.montant_total, fv.statut,
                    cv.numero_commande, cv.nomclient, cv.telephone,
                    COALESCE(p.paye, 0) AS montant_paye,
                    fv.montant_total - COALESCE(p.paye, 0) AS montant_restant
             FROM factures_vente fv
             LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
             LEFT JOIN (SELECT id_facture, SUM(montant) AS paye FROM paiements WHERE id_utilisateur = ? GROUP BY id_facture) p
                    ON p.id_facture = fv.id_facture
             WHERE fv.id_utilisateur = ?
               AND fv.statut <> 'annulee'
               AND (cv.statut IS NULL OR cv.statut <> 'annulee')
               AND fv.montant_total - COALESCE(p.paye, 0) > 0.009
             ORDER BY fv.date_echeance ASC, fv.id_facture ASC`,
            [id_utilisateur, id_utilisateur]
        );
        return rows.map((r) => ({
            ...r,
            date_facture: jourISO(r.date_facture),
            date_echeance: jourISO(r.date_echeance),
            montant_total: num(r.montant_total),
            montant_paye: num(r.montant_paye),
            montant_restant: num(r.montant_restant),
        }));
    }
}

export default Recette;
