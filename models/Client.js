// models/Client.js
//
// Fiches clients.
//   - une fiche par client (table clients), reconnue par son téléphone sous une forme unique
//     (« 07 07 08 09 10 » = « +225 0707080910 ») ;
//   - chaque vente est rattachée à sa fiche (commandes_vente.id_client) ; si on vend à un
//     nouveau numéro, la fiche est créée automatiquement ;
//   - « doit » = factures non annulées − ce qui a été payé dessus ;
//   - plafond de crédit facultatif ; relevé de compte ; fusion de deux fiches en double.
import { pool } from '../config/db.js';
import normaliserTelephone from '../utils/telephone.js';
import { attribuerCodeClient } from '../config/migrations.js';

const TYPES = ['particulier', 'revendeur', 'entreprise'];
const erreur = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const jour = (d) => {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const texte = (v, max) => {
    if (v === undefined) return undefined;
    const t = v === null ? '' : String(v).trim();
    return t ? t.slice(0, max) : null;
};

// Agrégats par client (ventes non annulées, reste dû des factures non annulées)
const AGREGATS = `
    LEFT JOIN (
        SELECT id_client, COUNT(*) AS nb_ventes, SUM(montant_total) AS total_achats,
               MAX(date_commande) AS derniere_vente, MIN(date_commande) AS premiere_vente
        FROM commandes_vente
        WHERE id_utilisateur = ? AND statut <> 'annulee' AND id_client IS NOT NULL
        GROUP BY id_client
    ) a ON a.id_client = c.id_client
    LEFT JOIN (
        SELECT cv.id_client,
               SUM(GREATEST(fv.montant_total - COALESCE(p.paye, 0), 0)) AS du,
               SUM(CASE WHEN fv.date_echeance < CURDATE() THEN GREATEST(fv.montant_total - COALESCE(p.paye, 0), 0) ELSE 0 END) AS du_en_retard
        FROM factures_vente fv
        JOIN commandes_vente cv ON cv.id_commande = fv.id_commande
        LEFT JOIN (SELECT id_facture, SUM(montant) AS paye FROM paiements WHERE id_utilisateur = ? GROUP BY id_facture) p
               ON p.id_facture = fv.id_facture
        WHERE fv.id_utilisateur = ? AND fv.statut <> 'annulee' AND cv.statut <> 'annulee' AND cv.id_client IS NOT NULL
        GROUP BY cv.id_client
    ) d ON d.id_client = c.id_client
`;

const formater = (r) => ({
    id_client: r.id_client,
    code_client: r.code_client || null,
    nom: r.nom,
    type_client: r.type_client || 'particulier',
    telephone: r.telephone,
    telephone2: r.telephone2,
    email: r.email,
    adresse: r.adresse,
    quartier: r.quartier,
    ville: r.ville,
    note: r.note ?? r.description ?? null,
    numero_tva: r.numero_tva,
    plafond_credit: r.plafond_credit === null || r.plafond_credit === undefined ? null : num(r.plafond_credit),
    actif: !!r.actif,
    date_creation: r.date_creation,
    nb_ventes: Number(r.nb_ventes) || 0,
    total_achats: num(r.total_achats),
    derniere_vente: jour(r.derniere_vente),
    premiere_vente: jour(r.premiere_vente),
    du: num(r.du),
    du_en_retard: num(r.du_en_retard),
    depasse_plafond: r.plafond_credit !== null && r.plafond_credit !== undefined && num(r.du) > num(r.plafond_credit) + 0.009,
    // compatibilité avec les anciens écrans
    nomclient: r.nom,
    montant_impaye: num(r.du),
    nb_commandes: Number(r.nb_ventes) || 0,
    derniere_commande: jour(r.derniere_vente),
});

class Client {
    // ============================================================
    // LISTE + STATISTIQUES
    // ============================================================
    /**
     * filtres : search, type, statut ('dette' | 'depasse' | 'inactifs' | 'nouveaux'), inclureInactifs
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findAll');
        const where = ['c.id_utilisateur = ?', 'c.fusionne_dans IS NULL'];
        const params = [id_utilisateur, id_utilisateur, id_utilisateur, id_utilisateur];
        if (!(filters.inclureInactifs === true || filters.inclureInactifs === 'true' || filters.inclureInactifs === '1')) where.push('c.actif = TRUE');
        if (filters.type && TYPES.includes(filters.type)) { where.push('c.type_client = ?'); params.push(filters.type); }
        if (filters.search && String(filters.search).trim()) {
            const s = String(filters.search).trim();
            const t = `%${s}%`;
            const norme = normaliserTelephone(s);
            where.push(`(c.nom LIKE ? OR c.telephone LIKE ? OR c.telephone2 LIKE ? OR c.quartier LIKE ? OR c.ville LIKE ?
                         OR c.code_client LIKE ?
                         ${norme ? 'OR c.telephone_normalise = ? OR c.telephone2_normalise = ?' : ''})`);
            params.push(t, t, t, t, t, t);
            if (norme) params.push(norme, norme);
        }
        if (filters.statut === 'dette') where.push('COALESCE(d.du, 0) > 0.009');
        if (filters.statut === 'depasse') where.push('c.plafond_credit IS NOT NULL AND COALESCE(d.du, 0) > c.plafond_credit + 0.009');
        if (filters.statut === 'inactifs') where.push('a.derniere_vente IS NOT NULL AND a.derniere_vente < DATE_SUB(CURDATE(), INTERVAL 60 DAY)');
        if (filters.statut === 'nouveaux') where.push("c.date_creation >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");

        const tris = {
            nom: 'c.nom ASC',
            du: 'COALESCE(d.du, 0) DESC, c.nom ASC',
            achats: 'COALESCE(a.total_achats, 0) DESC',
            recent: 'a.derniere_vente IS NULL, a.derniere_vente DESC, c.id_client DESC',
            nouveaux: 'c.date_creation DESC',
        };
        const tri = tris[filters.tri] || tris.recent;
        const limite = Math.min(Math.max(parseInt(filters.limit, 10) || 2000, 1), 5000);

        const [rows] = await pool.query(
            `SELECT c.*, a.nb_ventes, a.total_achats, a.derniere_vente, a.premiere_vente, d.du, d.du_en_retard
             FROM clients c ${AGREGATS}
             WHERE ${where.join(' AND ')}
             ORDER BY ${tri}
             LIMIT ${limite}`,
            params
        );
        return rows.map(formater);
    }

    static async getStats(id_utilisateur) {
        const [[s]] = await pool.query(
            `SELECT COUNT(*) AS nb_clients,
                    SUM(COALESCE(d.du, 0)) AS total_du,
                    SUM(COALESCE(d.du_en_retard, 0)) AS total_du_retard,
                    SUM(COALESCE(d.du, 0) > 0.009) AS nb_avec_dette,
                    SUM(c.plafond_credit IS NOT NULL AND COALESCE(d.du, 0) > c.plafond_credit + 0.009) AS nb_depasse,
                    SUM(c.date_creation >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS nouveaux_mois,
                    SUM(a.derniere_vente IS NOT NULL AND a.derniere_vente < DATE_SUB(CURDATE(), INTERVAL 60 DAY)) AS nb_inactifs,
                    SUM(c.type_client = 'revendeur') AS nb_revendeurs,
                    SUM(c.type_client = 'entreprise') AS nb_entreprises
             FROM clients c ${AGREGATS}
             WHERE c.id_utilisateur = ? AND c.fusionne_dans IS NULL AND c.actif = TRUE`,
            [id_utilisateur, id_utilisateur, id_utilisateur, id_utilisateur]
        );
        return {
            nb_clients: Number(s.nb_clients) || 0,
            total_du: num(s.total_du),
            total_du_retard: num(s.total_du_retard),
            nb_avec_dette: Number(s.nb_avec_dette) || 0,
            nb_depasse: Number(s.nb_depasse) || 0,
            nouveaux_mois: Number(s.nouveaux_mois) || 0,
            nb_inactifs: Number(s.nb_inactifs) || 0,
            nb_revendeurs: Number(s.nb_revendeurs) || 0,
            nb_entreprises: Number(s.nb_entreprises) || 0,
            // compatibilité
            total_clients: Number(s.nb_clients) || 0,
            montant_impaye_total: num(s.total_du),
        };
    }

    /** Recherche rapide (vente) : nom ou téléphone, avec ce que le client doit et son plafond. */
    static async search(keyword, limit = 10, id_utilisateur) {
        const s = String(keyword || '').trim();
        if (s.length < 2) return [];
        const lignes = await Client.findAll({ search: s, tri: 'recent', limit: Math.min(parseInt(limit, 10) || 10, 30) }, id_utilisateur);
        return lignes;
    }

    // ============================================================
    // FICHE
    // ============================================================
    /** Trouve un client par id (court) ou par téléphone (n'importe quelle forme). Suit les fusions. */
    static async resoudre(cle, id_utilisateur) {
        const brut = String(cle || '').trim();
        let rows = [];
        if (/^CL-\d+$/i.test(brut)) {
            [rows] = await pool.query('SELECT id_client, fusionne_dans FROM clients WHERE code_client = ? AND id_utilisateur = ?', [brut.toUpperCase(), id_utilisateur]);
        }
        if (/^\d{1,7}$/.test(brut)) {
            [rows] = await pool.query('SELECT id_client, fusionne_dans FROM clients WHERE id_client = ? AND id_utilisateur = ?', [Number(brut), id_utilisateur]);
        }
        if (!rows.length) {
            const norme = normaliserTelephone(brut);
            if (norme) {
                [rows] = await pool.query(
                    `SELECT id_client, fusionne_dans FROM clients
                     WHERE id_utilisateur = ? AND (telephone_normalise = ? OR telephone2_normalise = ?)
                     ORDER BY fusionne_dans IS NOT NULL, actif DESC, id_client ASC LIMIT 1`,
                    [id_utilisateur, norme, norme]
                );
            }
        }
        if (!rows.length) return null;
        return rows[0].fusionne_dans || rows[0].id_client;
    }

    static async findById(id_client, id_utilisateur) {
        const [rows] = await pool.query(
            `SELECT c.*, a.nb_ventes, a.total_achats, a.derniere_vente, a.premiere_vente, d.du, d.du_en_retard
             FROM clients c ${AGREGATS}
             WHERE c.id_client = ? AND c.id_utilisateur = ?`,
            [id_utilisateur, id_utilisateur, id_utilisateur, id_client, id_utilisateur]
        );
        return rows[0] ? formater(rows[0]) : null;
    }

    /** Fiche complète : client, ventes, produits préférés, relances. */
    static async fiche(cle, id_utilisateur) {
        const id = await Client.resoudre(cle, id_utilisateur);
        if (!id) return null;
        const client = await Client.findById(id, id_utilisateur);
        if (!client) return null;

        const [ventes] = await pool.query(
            `SELECT cv.id_commande, cv.numero_commande, cv.date_commande, cv.statut, cv.montant_total, cv.nomclient,
                    fv.id_facture, fv.numero_facture, fv.statut AS statut_facture, fv.date_echeance,
                    COALESCE(p.paye, 0) AS paye
             FROM commandes_vente cv
             LEFT JOIN factures_vente fv ON fv.id_commande = cv.id_commande
             LEFT JOIN (SELECT id_facture, SUM(montant) AS paye FROM paiements WHERE id_utilisateur = ? GROUP BY id_facture) p
                    ON p.id_facture = fv.id_facture
             WHERE cv.id_utilisateur = ? AND cv.id_client = ?
             ORDER BY cv.date_commande DESC, cv.id_commande DESC
             LIMIT 200`,
            [id_utilisateur, id_utilisateur, id]
        );

        const [produits] = await pool.query(
            `SELECT l.id_produit, p.nom, SUM(l.quantite) AS quantite, MAX(l.nom_unite_vente) AS unite,
                    SUM(l.quantite * l.prix_vente * (1 - COALESCE(l.remise, 0) / 100)) AS montant,
                    COUNT(DISTINCT l.id_commande) AS nb_ventes, MAX(cv.date_commande) AS dernier_achat
             FROM ligne_commande_vente l
             JOIN commandes_vente cv ON cv.id_commande = l.id_commande
             JOIN produits p ON p.id_produit = l.id_produit
             WHERE cv.id_utilisateur = ? AND cv.id_client = ? AND cv.statut <> 'annulee'
             GROUP BY l.id_produit, p.nom
             ORDER BY montant DESC
             LIMIT 8`,
            [id_utilisateur, id]
        );

        let relances = [];
        try {
            const [r] = await pool.query(
                `SELECT rc.id_relance, rc.canal, rc.montant_du, rc.par_nom, rc.date_relance, rc.note
                 FROM relances_clients rc
                 WHERE rc.id_utilisateur = ?
                   AND rc.telephone IN (SELECT DISTINCT cv.telephone FROM commandes_vente cv
                                        WHERE cv.id_utilisateur = ? AND cv.id_client = ? AND cv.telephone IS NOT NULL)
                 ORDER BY rc.date_relance DESC LIMIT 20`,
                [id_utilisateur, id_utilisateur, id]
            );
            relances = r;
        } catch { /* table des relances absente : sans importance */ }

        return {
            client,
            ventes: ventes.map((v) => {
                const annulee = v.statut === 'annulee' || v.statut_facture === 'annulee';
                const reste = annulee ? 0 : Math.max(0, num(v.montant_total) - num(v.paye));
                return {
                    id_commande: v.id_commande,
                    numero_commande: v.numero_commande,
                    numero_facture: v.numero_facture,
                    date_commande: jour(v.date_commande),
                    date_echeance: jour(v.date_echeance),
                    statut: v.statut,
                    statut_facture: v.statut_facture,
                    montant_total: num(v.montant_total),
                    paye: num(v.paye),
                    reste: num(reste),
                    annulee,
                };
            }),
            produits: produits.map((p) => ({
                id_produit: p.id_produit, nom: p.nom, unite: p.unite, quantite: num(p.quantite),
                montant: num(p.montant), nb_ventes: Number(p.nb_ventes), dernier_achat: jour(p.dernier_achat),
            })),
            relances: relances.map((r) => ({ ...r, montant_du: num(r.montant_du) })),
        };
    }

    /** Ancienne route (par téléphone) : renvoie la fiche au format le plus proche de l'ancien. */
    static async findByTelephone(telephone, id_utilisateur) {
        const f = await Client.fiche(telephone, id_utilisateur);
        return f ? { ...f.client, commandes: f.ventes } : null;
    }

    // ============================================================
    // CRÉATION / MODIFICATION
    // ============================================================
    static _champs(data, { peutFixerPlafond }) {
        const c = {};
        if (data.nom !== undefined) {
            const n = texte(data.nom, 200);
            if (!n) throw erreur('Le nom du client est obligatoire');
            c.nom = n;
        }
        if (data.type_client !== undefined) {
            if (!TYPES.includes(data.type_client)) throw erreur('Type de client invalide');
            c.type_client = data.type_client;
        }
        for (const [k, max] of [['email', 100], ['adresse', 500], ['quartier', 100], ['ville', 100], ['note', 2000], ['numero_tva', 50]]) {
            if (data[k] !== undefined) c[k] = texte(data[k], max);
        }
        if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw erreur('Adresse e-mail invalide');
        for (const [k, kn] of [['telephone', 'telephone_normalise'], ['telephone2', 'telephone2_normalise']]) {
            if (data[k] !== undefined) {
                const t = texte(data[k], k === 'telephone' ? 20 : 30);
                const n = t ? normaliserTelephone(t) : null;
                if (t && !n) throw erreur(`Numéro de téléphone invalide : ${t}`);
                c[k] = t;
                c[kn] = n;
            }
        }
        if (data.plafond_credit !== undefined && peutFixerPlafond) {
            if (data.plafond_credit === null || data.plafond_credit === '') c.plafond_credit = null;
            else {
                const p = num(String(data.plafond_credit).replace(/\s/g, '').replace(',', '.'));
                if (!(p >= 0)) throw erreur('Plafond de crédit invalide');
                c.plafond_credit = p;
            }
        }
        return c;
    }

    /** Un autre client actif a-t-il déjà ce numéro ? */
    static async _doublon(id_utilisateur, normes, saufId = 0) {
        const liste = normes.filter(Boolean);
        if (!liste.length) return null;
        const marques = liste.map(() => '?').join(',');
        const [rows] = await pool.query(
            `SELECT id_client, nom, telephone FROM clients
             WHERE id_utilisateur = ? AND id_client <> ? AND fusionne_dans IS NULL
               AND (telephone_normalise IN (${marques}) OR telephone2_normalise IN (${marques}))
             LIMIT 1`,
            [id_utilisateur, saufId, ...liste, ...liste]
        );
        return rows[0] || null;
    }

    static async create(data, id_utilisateur, { peutFixerPlafond = false } = {}) {
        if (!texte(data.nom, 200)) throw erreur('Le nom du client est obligatoire');
        const c = Client._champs({ type_client: 'particulier', ...data }, { peutFixerPlafond });
        const doublon = await Client._doublon(id_utilisateur, [c.telephone_normalise, c.telephone2_normalise]);
        if (doublon) throw Object.assign(erreur(`Ce numéro appartient déjà au client « ${doublon.nom} »`, 409), { id_client_existant: doublon.id_client });
        const cols = Object.keys(c);
        const [r] = await pool.query(
            `INSERT INTO clients (id_utilisateur, ${cols.map((k) => `\`${k}\``).join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
            [id_utilisateur, ...cols.map((k) => c[k])]
        );
        await attribuerCodeClient(pool, r.insertId, id_utilisateur);
        return Client.findById(r.insertId, id_utilisateur);
    }

    static async update(id_client, data, id_utilisateur, { peutFixerPlafond = false } = {}) {
        const existant = await Client.findById(id_client, id_utilisateur);
        if (!existant) throw erreur('Client introuvable', 404);
        const c = Client._champs(data, { peutFixerPlafond });
        const doublon = await Client._doublon(id_utilisateur, [c.telephone_normalise, c.telephone2_normalise], id_client);
        if (doublon) throw Object.assign(erreur(`Ce numéro appartient déjà au client « ${doublon.nom} »`, 409), { id_client_existant: doublon.id_client });
        const cols = Object.keys(c);
        if (cols.length) {
            await pool.query(
                `UPDATE clients SET ${cols.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id_client = ? AND id_utilisateur = ?`,
                [...cols.map((k) => c[k]), id_client, id_utilisateur]
            );
        }
        return Client.findById(id_client, id_utilisateur);
    }

    static async setActif(id_client, actif, id_utilisateur) {
        const [r] = await pool.query(
            'UPDATE clients SET actif = ? WHERE id_client = ? AND id_utilisateur = ? AND fusionne_dans IS NULL',
            [actif ? 1 : 0, id_client, id_utilisateur]
        );
        if (!r.affectedRows) throw erreur('Client introuvable', 404);
        return Client.findById(id_client, id_utilisateur);
    }

    /**
     * Fusionne la fiche « source » dans la fiche « cible » (doublon) :
     * les ventes passent sur la cible, le numéro de la source devient le 2e numéro de la cible
     * s'il est libre, et la source est désactivée (gardée pour l'historique).
     */
    static async fusionner(id_cible, id_source, id_utilisateur) {
        if (Number(id_cible) === Number(id_source)) throw erreur('Choisissez deux fiches différentes');
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [fiches] = await conn.query(
                `SELECT * FROM clients WHERE id_utilisateur = ? AND id_client IN (?, ?) AND fusionne_dans IS NULL FOR UPDATE`,
                [id_utilisateur, id_cible, id_source]
            );
            const cible = fiches.find((f) => f.id_client === Number(id_cible));
            const source = fiches.find((f) => f.id_client === Number(id_source));
            if (!cible || !source) throw erreur('Client introuvable', 404);

            const [deplacees] = await conn.query(
                'UPDATE commandes_vente SET id_client = ? WHERE id_client = ? AND id_utilisateur = ?',
                [cible.id_client, source.id_client, id_utilisateur]
            );
            const maj = {};
            if (!cible.telephone2 && source.telephone && source.telephone_normalise !== cible.telephone_normalise) {
                maj.telephone2 = source.telephone;
                maj.telephone2_normalise = source.telephone_normalise;
            }
            for (const k of ['email', 'adresse', 'quartier', 'ville']) if (!cible[k] && source[k]) maj[k] = source[k];
            if (source.note) maj.note = [cible.note, `(fiche fusionnée « ${source.nom} ») ${source.note}`].filter(Boolean).join('\n');
            if (Object.keys(maj).length) {
                await conn.query(
                    `UPDATE clients SET ${Object.keys(maj).map((k) => `\`${k}\` = ?`).join(', ')} WHERE id_client = ?`,
                    [...Object.values(maj), cible.id_client]
                );
            }
            await conn.query('UPDATE clients SET actif = 0, fusionne_dans = ? WHERE id_client = ?', [cible.id_client, source.id_client]);
            await conn.commit();
            return { client: await Client.findById(cible.id_client, id_utilisateur), ventes_deplacees: deplacees.affectedRows };
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    // ============================================================
    // RELEVÉ DE COMPTE
    // ============================================================
    /**
     * Ventes (débit) et paiements (crédit) d'une période, avec le solde avant la période et
     * le solde après chaque opération. Les ventes annulées ne sont pas incluses.
     */
    static async releve(id_client, id_utilisateur, { dateDebut, dateFin } = {}) {
        const client = await Client.findById(id_client, id_utilisateur);
        if (!client) throw erreur('Client introuvable', 404);
        const debut = /^\d{4}-\d{2}-\d{2}$/.test(dateDebut || '') ? dateDebut : '1970-01-01';
        const fin = /^\d{4}-\d{2}-\d{2}$/.test(dateFin || '') ? dateFin : '2999-12-31';

        const [ops] = await pool.query(
            `SELECT 'vente' AS type, fv.date_facture AS date_op, fv.date_creation AS horodatage,
                    fv.numero_facture AS reference, cv.numero_commande AS vente, fv.montant_total AS debit, 0 AS credit,
                    NULL AS mode_paiement
             FROM factures_vente fv
             JOIN commandes_vente cv ON cv.id_commande = fv.id_commande
             WHERE fv.id_utilisateur = ? AND cv.id_client = ? AND fv.statut <> 'annulee' AND cv.statut <> 'annulee'
             UNION ALL
             SELECT IF(p.montant < 0, 'remboursement', 'paiement'), p.date_paiement, p.date_creation,
                    fv.numero_facture, cv.numero_commande,
                    IF(p.montant < 0, -p.montant, 0), IF(p.montant > 0, p.montant, 0), p.mode_paiement
             FROM paiements p
             JOIN factures_vente fv ON fv.id_facture = p.id_facture
             JOIN commandes_vente cv ON cv.id_commande = fv.id_commande
             WHERE p.id_utilisateur = ? AND cv.id_client = ? AND fv.statut <> 'annulee' AND cv.statut <> 'annulee'
             ORDER BY date_op ASC, horodatage ASC`,
            [id_utilisateur, id_client, id_utilisateur, id_client]
        );

        let solde = 0;
        let soldeOuverture = 0;
        const lignes = [];
        let totalDebit = 0;
        let totalCredit = 0;
        for (const o of ops) {
            const d = jour(o.date_op);
            const debit = num(o.debit);
            const credit = num(o.credit);
            solde = num(solde + debit - credit);
            if (d < debut) { soldeOuverture = solde; continue; }
            if (d > fin) break;
            totalDebit = num(totalDebit + debit);
            totalCredit = num(totalCredit + credit);
            lignes.push({ type: o.type, date: d, reference: o.reference, vente: o.vente, debit, credit, mode_paiement: o.mode_paiement, solde });
        }
        return {
            client,
            periode: { debut: debut === '1970-01-01' ? null : debut, fin: fin === '2999-12-31' ? null : fin },
            solde_ouverture: soldeOuverture,
            total_debit: totalDebit,
            total_credit: totalCredit,
            solde_cloture: num(soldeOuverture + totalDebit - totalCredit),
            lignes,
        };
    }

    // ============================================================
    // RATTACHEMENT D'UNE VENTE (appelé à la création d'une vente)
    // ============================================================
    /**
     * Trouve (ou crée) la fiche du client d'une vente. db = connexion de la transaction de la vente.
     * → { id_client, nom, telephone } ou null (vente sans client identifiable).
     */
    static async rattacherVente(db, id_utilisateur, { id_client, nomclient, telephone }) {
        if (id_client) {
            const [rows] = await db.query(
                'SELECT id_client, nom, telephone, fusionne_dans FROM clients WHERE id_client = ? AND id_utilisateur = ?',
                [id_client, id_utilisateur]
            );
            if (!rows[0]) throw erreur('Client introuvable');
            if (rows[0].fusionne_dans) return Client.rattacherVente(db, id_utilisateur, { id_client: rows[0].fusionne_dans, nomclient, telephone });
            return { id_client: rows[0].id_client, nom: rows[0].nom, telephone: rows[0].telephone };
        }
        const norme = normaliserTelephone(telephone);
        if (!norme) return null;
        const [trouves] = await db.query(
            `SELECT id_client, nom, telephone, fusionne_dans FROM clients
             WHERE id_utilisateur = ? AND (telephone_normalise = ? OR telephone2_normalise = ?)
             ORDER BY fusionne_dans IS NOT NULL, actif DESC, id_client ASC LIMIT 1`,
            [id_utilisateur, norme, norme]
        );
        if (trouves[0]) {
            const id = trouves[0].fusionne_dans || trouves[0].id_client;
            return { id_client: id, nom: trouves[0].nom, telephone: trouves[0].telephone };
        }
        const nom = texte(nomclient, 200) || 'Client';
        const [r] = await db.query(
            'INSERT INTO clients (id_utilisateur, nom, telephone, telephone_normalise) VALUES (?, ?, ?, ?)',
            [id_utilisateur, nom, String(telephone).trim().slice(0, 20), norme]
        );
        await attribuerCodeClient(db, r.insertId, id_utilisateur);
        return { id_client: r.insertId, nom, telephone: String(telephone).trim() };
    }

    /** Export (même filtre que la liste). */
    static async export(filters = {}, id_utilisateur) {
        return Client.findAll({ ...filters, limit: 5000 }, id_utilisateur);
    }

    /** Ancienne méthode « top clients » (gardée pour compatibilité). */
    static async getTopClients(limit = 10, id_utilisateur) {
        return Client.findAll({ tri: 'achats', limit }, id_utilisateur);
    }
}

export default Client;
