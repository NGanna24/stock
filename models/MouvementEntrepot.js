// models/MouvementEntrepot.js
// Journal des mouvements de stock d'un entrepôt (entrées, sorties, transferts, ajustements)
// + synthèse (aperçu) de l'entrepôt. Toutes les quantités sont stockées en UNITÉ DE BASE ;
// l'affichage est calculé en UNITÉS DE VENTE ("16 Carton + 6 Pièce").
import { pool } from '../config/db.js';

const num = (v) => parseFloat(v) || 0;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** 30 bidons avec un carton de 12 => "2 Carton + 6 Bidon" (de la plus grande unité à la plus petite) */
export function decomposer(unites, quantiteBase, nomBase = 'Unité') {
    const total = round2(Math.abs(quantiteBase));
    const liste = (unites || [])
        .filter((u) => num(u.quantite_base) > 1)
        .sort((a, b) => num(b.quantite_base) - num(a.quantite_base));
    let reste = total;
    const parts = [];
    for (const u of liste) {
        const qb = num(u.quantite_base);
        const n = Math.floor(reste / qb + 1e-9);
        if (n > 0) {
            parts.push({ n, nom: u.nom });
            reste = round2(reste - n * qb);
        }
    }
    if (reste > 0 || parts.length === 0) parts.push({ n: reste, nom: nomBase });
    return {
        parts,
        texte: parts.map((p) => `${p.n.toLocaleString('fr-FR')} ${p.nom}`).join(' + '),
    };
}

export const TYPES = {
    entree: 'Entrée',
    sortie: 'Sortie',
    transfert_sortie: 'Transfert vers un magasin',
    perte: 'Perte / casse',
    ajustement: 'Ajustement',
    inventaire: 'Inventaire',
};

class MouvementEntrepot {
    /** Écrit une ligne du journal (dans la transaction `conn` si fournie) */
    static async log(conn, {
        id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
        quantite, ancienne_quantite = 0, nouvelle_quantite = 0,
        type_reference = null, id_reference = null, notes = null,
    }) {
        await (conn || pool).execute(
            `INSERT INTO mouvements_entrepot
                (id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
                 quantite, ancienne_quantite, nouvelle_quantite, type_reference, id_reference, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
             round2(quantite), round2(ancienne_quantite), round2(nouvelle_quantite),
             type_reference, id_reference, notes]
        );
    }

    /** Unités de vente actives de plusieurs produits d'entrepôt : { id_produit_entrepot: [unités] } */
    static async _unites(ids) {
        const map = {};
        if (!ids.length) return map;
        const [rows] = await pool.query(
            `SELECT id_produit_entrepot, nom, quantite_base
               FROM unites_vente_entrepot
              WHERE actif = 1 AND id_produit_entrepot IN (?)`,
            [ids]
        );
        rows.forEach((u) => { (map[u.id_produit_entrepot] ||= []).push(u); });
        return map;
    }

    /* ============================================================
       JOURNAL (filtres + pagination)
       filtres : type ('entree'|'sortie'|…|'entrees'|'sorties'), q, id_produit_entrepot,
                 date_debut, date_fin (YYYY-MM-DD), page, limit
       ============================================================ */
    static async list(id_entrepot, f = {}) {
        const where = ['m.id_entrepot = ?'];
        const params = [id_entrepot];

        // Groupes pratiques : "entrees" / "sorties" (selon le sens réel du mouvement)
        if (f.type === 'entrees') where.push('(m.nouvelle_quantite - m.ancienne_quantite) > 0');
        else if (f.type === 'sorties') where.push('(m.nouvelle_quantite - m.ancienne_quantite) < 0');
        else if (f.type && TYPES[f.type]) { where.push('m.type_mouvement = ?'); params.push(f.type); }

        if (f.id_produit_entrepot) { where.push('m.id_produit_entrepot = ?'); params.push(Number(f.id_produit_entrepot)); }
        if (/^\d{4}-\d{2}-\d{2}$/.test(f.date_debut || '')) { where.push('m.date_mouvement >= ?'); params.push(`${f.date_debut} 00:00:00`); }
        if (/^\d{4}-\d{2}-\d{2}$/.test(f.date_fin || '')) { where.push('m.date_mouvement <= ?'); params.push(`${f.date_fin} 23:59:59`); }
        if (f.q && String(f.q).trim()) {
            const like = `%${String(f.q).trim().replace(/[%_\\]/g, '\\$&')}%`;
            where.push('(p.nom LIKE ? OR m.notes LIKE ? OR ma.nom LIKE ?)');
            params.push(like, like, like);
        }

        const limit = Math.min(200, Math.max(1, parseInt(f.limit, 10) || 25));
        const page = Math.max(1, parseInt(f.page, 10) || 1);
        const from = `
            FROM mouvements_entrepot m
            JOIN produits_entrepot p ON p.id_produit_entrepot = m.id_produit_entrepot
            LEFT JOIN marques ma ON ma.id_marque = p.id_marque
            LEFT JOIN modeles mo ON mo.id_modele = p.id_modele
            LEFT JOIN unites u ON u.id_unite = p.id_unite
            LEFT JOIN utilisateurs us ON us.id_utilisateur = m.id_utilisateur
           WHERE ${where.join(' AND ')}`;

        const [[tot]] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM((m.nouvelle_quantite - m.ancienne_quantite) > 0) AS nb_entrees,
                    SUM((m.nouvelle_quantite - m.ancienne_quantite) < 0) AS nb_sorties,
                    COALESCE(SUM(GREATEST(m.nouvelle_quantite - m.ancienne_quantite, 0) * p.prix_achat), 0) AS valeur_entrees,
                    COALESCE(SUM(GREATEST(m.ancienne_quantite - m.nouvelle_quantite, 0) * p.prix_achat), 0) AS valeur_sorties
             ${from}`,
            params
        );

        const [rows] = await pool.query(
            `SELECT m.id_mouvement_entrepot, m.id_produit_entrepot, m.type_mouvement,
                    m.quantite, m.ancienne_quantite, m.nouvelle_quantite,
                    m.nom_unite_vente, m.quantite_base, m.quantite_saisie,
                    m.num_lot, m.type_reference, m.id_reference, m.notes, m.date_mouvement,
                    p.nom AS produit_nom, ma.nom AS marque_nom, mo.nom AS modele_nom,
                    u.nom AS unite_nom, us.fullname AS auteur
             ${from}
             ORDER BY m.date_mouvement DESC, m.id_mouvement_entrepot DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, (page - 1) * limit]
        );

        const unites = await this._unites([...new Set(rows.map((r) => r.id_produit_entrepot))]);
        const mouvements = rows.map((r) => {
            const delta = round2(num(r.nouvelle_quantite) - num(r.ancienne_quantite));
            const nomBase = r.unite_nom || 'Unité';
            const u = unites[r.id_produit_entrepot] || [];
            return {
                id: r.id_mouvement_entrepot,
                date: r.date_mouvement,
                type: r.type_mouvement,
                type_libelle: TYPES[r.type_mouvement] || r.type_mouvement,
                sens: delta > 0 ? 'entree' : delta < 0 ? 'sortie' : 'neutre',
                produit: { id: r.id_produit_entrepot, nom: r.produit_nom, marque: r.marque_nom, modele: r.modele_nom },
                variation_base: delta,
                variation: decomposer(u, delta || num(r.quantite), nomBase),
                avant: decomposer(u, num(r.ancienne_quantite), nomBase),
                apres: decomposer(u, num(r.nouvelle_quantite), nomBase),
                unite_base: nomBase,
                saisie: r.quantite_saisie != null && num(r.quantite_base) > 1
                    ? `${num(r.quantite_saisie)} ${r.nom_unite_vente}` : null,
                lot: r.num_lot || null,
                reference: r.type_reference ? { type: r.type_reference, id: r.id_reference } : null,
                notes: r.notes || null,
                auteur: r.auteur || null,
            };
        });

        return {
            mouvements,
            pagination: { page, limit, total: Number(tot.total) || 0, pages: Math.max(1, Math.ceil((Number(tot.total) || 0) / limit)) },
            totaux: {
                nb_entrees: Number(tot.nb_entrees) || 0,
                nb_sorties: Number(tot.nb_sorties) || 0,
                valeur_entrees: num(tot.valeur_entrees),
                valeur_sorties: num(tot.valeur_sorties),
            },
        };
    }

    /* ============================================================
       SYNTHÈSE — tout ce qui compte sur l'entrepôt, en un appel
       ============================================================ */
    static async synthese(id_entrepot, jours = 30) {
        const [[ent]] = await pool.query(
            `SELECT e.id_entrepot, e.nom, e.ville, e.date_creation,
                    e.id_utilisateur_proprietaire, up.fullname AS proprietaire
               FROM entrepots e
               LEFT JOIN utilisateurs up ON up.id_utilisateur = e.id_utilisateur_proprietaire
              WHERE e.id_entrepot = ?`,
            [id_entrepot]
        );

        const [[stock]] = await pool.query(
            `SELECT COUNT(*) AS nb_produits,
                    COALESCE(SUM(quantite_stock * prix_achat), 0) AS valeur_achat,
                    COALESCE(SUM(quantite_stock * prix_vente), 0) AS valeur_vente,
                    COALESCE(SUM(quantite_stock <= 0), 0) AS nb_ruptures,
                    COALESCE(SUM(quantite_stock > 0 AND quantite_minimale > 0 AND quantite_stock <= quantite_minimale), 0) AS nb_stock_bas,
                    COUNT(DISTINCT NULLIF(TRIM(emplacement), '')) AS nb_emplacements,
                    COUNT(*) - COUNT(NULLIF(TRIM(emplacement), '')) AS nb_non_ranges
               FROM produits_entrepot WHERE id_entrepot = ? AND actif = 1`,
            [id_entrepot]
        );

        const [[periode]] = await pool.query(
            `SELECT COALESCE(SUM((m.nouvelle_quantite - m.ancienne_quantite) > 0), 0) AS nb_entrees,
                    COALESCE(SUM((m.nouvelle_quantite - m.ancienne_quantite) < 0), 0) AS nb_sorties,
                    COALESCE(SUM(GREATEST(m.nouvelle_quantite - m.ancienne_quantite, 0) * p.prix_achat), 0) AS valeur_entrees,
                    COALESCE(SUM(GREATEST(m.ancienne_quantite - m.nouvelle_quantite, 0) * p.prix_achat), 0) AS valeur_sorties
               FROM mouvements_entrepot m
               JOIN produits_entrepot p ON p.id_produit_entrepot = m.id_produit_entrepot
              WHERE m.id_entrepot = ? AND m.date_mouvement >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [id_entrepot, jours]
        );

        // Courbe : valeur entrée / sortie par jour sur 14 jours
        const [jourRows] = await pool.query(
            `SELECT DATE(m.date_mouvement) AS jour,
                    COALESCE(SUM(GREATEST(m.nouvelle_quantite - m.ancienne_quantite, 0) * p.prix_achat), 0) AS entrees,
                    COALESCE(SUM(GREATEST(m.ancienne_quantite - m.nouvelle_quantite, 0) * p.prix_achat), 0) AS sorties
               FROM mouvements_entrepot m
               JOIN produits_entrepot p ON p.id_produit_entrepot = m.id_produit_entrepot
              WHERE m.id_entrepot = ? AND m.date_mouvement >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
              GROUP BY DATE(m.date_mouvement)`,
            [id_entrepot]
        );
        const parJour = new Map(jourRows.map((r) => [new Date(r.jour).toISOString().slice(0, 10), r]));
        const serie = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const cle = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            const r = parJour.get(cle);
            serie.push({ jour: cle, entrees: r ? num(r.entrees) : 0, sorties: r ? num(r.sorties) : 0 });
        }

        // Produits les plus sortis (30 j)
        const [topRows] = await pool.query(
            `SELECT m.id_produit_entrepot AS id, p.nom, ma.nom AS marque_nom, u.nom AS unite_nom,
                    SUM(GREATEST(m.ancienne_quantite - m.nouvelle_quantite, 0)) AS total_sorti
               FROM mouvements_entrepot m
               JOIN produits_entrepot p ON p.id_produit_entrepot = m.id_produit_entrepot
               LEFT JOIN marques ma ON ma.id_marque = p.id_marque
               LEFT JOIN unites u ON u.id_unite = p.id_unite
              WHERE m.id_entrepot = ? AND m.date_mouvement >= DATE_SUB(NOW(), INTERVAL ? DAY)
              GROUP BY m.id_produit_entrepot, p.nom, ma.nom, u.nom
             HAVING total_sorti > 0
              ORDER BY total_sorti DESC LIMIT 5`,
            [id_entrepot, jours]
        );
        const unitesTop = await this._unites(topRows.map((r) => r.id));
        const top_sorties = topRows.map((r) => ({
            id: r.id, nom: r.nom, marque: r.marque_nom,
            total_base: num(r.total_sorti),
            quantite: decomposer(unitesTop[r.id] || [], num(r.total_sorti), r.unite_nom || 'Unité'),
        }));

        const [[tr]] = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(numero_lot, numero_transfert)) AS nb
               FROM transferts_stock WHERE id_entrepot_source = ? AND statut = 'en_attente'`,
            [id_entrepot]
        );

        const [[cmd]] = await pool.query(
            `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS montant
               FROM commandes_achat
              WHERE destination = 'entrepot' AND id_entrepot = ?
                AND statut IN ('en_attente', 'envoyee', 'partiellement_recue')`,
            [id_entrepot]
        );

        const [membres] = await pool.query(
            `SELECT u.id_utilisateur, u.fullname, me.role_membre
               FROM membres_entrepot me
               JOIN utilisateurs u ON u.id_utilisateur = me.id_utilisateur
              WHERE me.id_entrepot = ? AND me.actif = 1
              ORDER BY (me.role_membre = 'proprietaire') DESC, u.fullname ASC`,
            [id_entrepot]
        );

        const recents = await this.list(id_entrepot, { limit: 8 });

        return {
            entrepot: {
                id_entrepot: ent?.id_entrepot, nom: ent?.nom, ville: ent?.ville,
                cree_le: ent?.date_creation, proprietaire: ent?.proprietaire,
                id_proprietaire: ent?.id_utilisateur_proprietaire,
            },
            jours,
            stock: {
                nb_produits: Number(stock.nb_produits) || 0,
                valeur_achat: num(stock.valeur_achat),
                valeur_vente: num(stock.valeur_vente),
                marge_potentielle: round2(num(stock.valeur_vente) - num(stock.valeur_achat)),
                nb_ruptures: Number(stock.nb_ruptures) || 0,
                nb_stock_bas: Number(stock.nb_stock_bas) || 0,
                nb_emplacements: Number(stock.nb_emplacements) || 0,
                nb_non_ranges: Number(stock.nb_non_ranges) || 0,
            },
            periode: {
                nb_entrees: Number(periode.nb_entrees) || 0,
                nb_sorties: Number(periode.nb_sorties) || 0,
                valeur_entrees: num(periode.valeur_entrees),
                valeur_sorties: num(periode.valeur_sorties),
            },
            serie,
            top_sorties,
            transferts_en_attente: Number(tr.nb) || 0,
            commandes_en_cours: { nb: Number(cmd.nb) || 0, montant: num(cmd.montant) },
            membres,
            derniers_mouvements: recents.mouvements,
        };
    }
}

export default MouvementEntrepot;