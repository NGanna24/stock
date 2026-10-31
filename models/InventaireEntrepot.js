// models/InventaireEntrepot.js
// Inventaire d'un entrepôt : photo du stock -> comptage (unités de vente) -> validation.
// À la validation, le stock des produits comptés est aligné sur le comptage et chaque écart
// est écrit dans le journal des mouvements (type 'inventaire').
// Toutes les quantités sont en UNITÉ DE BASE.
import { pool } from '../config/db.js';
import MouvementEntrepot, { decomposer } from './MouvementEntrepot.js';

const num = (v) => parseFloat(v) || 0;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const fail = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };

class InventaireEntrepot {
    static async _inventaire(conn, id_entrepot, id_inventaire, forUpdate = false) {
        const [rows] = await conn.execute(
            `SELECT * FROM inventaires_entrepot WHERE id_inventaire_entrepot = ? AND id_entrepot = ?${forUpdate ? ' FOR UPDATE' : ''}`,
            [id_inventaire, id_entrepot]
        );
        if (!rows.length) throw fail('Inventaire introuvable', 404);
        return rows[0];
    }

    /** Historique des inventaires avec avancement et écarts */
    static async list(id_entrepot) {
        const [rows] = await pool.execute(
            `SELECT i.id_inventaire_entrepot AS id, i.reference, i.libelle, i.type_inventaire, i.statut, i.notes,
                    i.date_debut, i.date_fin, i.date_creation, i.date_validation, i.valide_par,
                    us.fullname AS auteur,
                    COUNT(l.id_ligne_entrepot) AS total,
                    SUM(l.date_scannage IS NOT NULL) AS comptes,
                    SUM(l.date_scannage IS NOT NULL AND l.ecart <> 0) AS ecarts
               FROM inventaires_entrepot i
               LEFT JOIN inventaire_lignes_entrepot l ON l.id_inventaire_entrepot = i.id_inventaire_entrepot
               LEFT JOIN utilisateurs us ON us.id_utilisateur = i.id_utilisateur
              WHERE i.id_entrepot = ?
              GROUP BY i.id_inventaire_entrepot
              ORDER BY i.id_inventaire_entrepot DESC
              LIMIT 50`,
            [id_entrepot]
        );
        return rows.map((r) => ({ ...r, total: num(r.total), comptes: num(r.comptes), ecarts: num(r.ecarts) }));
    }

    /** Zones (emplacements texte) présentes dans l'entrepôt, pour un inventaire partiel */
    static async zones(id_entrepot) {
        const [rows] = await pool.execute(
            `SELECT emplacement AS zone, COUNT(*) AS produits
               FROM produits_entrepot
              WHERE id_entrepot = ? AND actif = 1 AND emplacement IS NOT NULL AND TRIM(emplacement) <> ''
              GROUP BY emplacement ORDER BY emplacement`,
            [id_entrepot]
        );
        return rows.map((r) => ({ zone: r.zone, produits: num(r.produits) }));
    }

    /** Détail : en-tête + lignes (avec unités de vente pour la saisie) + totaux */
    static async get(id_entrepot, id_inventaire) {
        const inv = await this._inventaire(pool, id_entrepot, id_inventaire);
        const [lignes] = await pool.execute(
            `SELECT l.id_ligne_entrepot AS id, l.id_produit_entrepot, l.quantite_theorique, l.quantite_reelle,
                    l.ecart, l.notes, l.date_scannage,
                    p.nom AS produit, p.emplacement, p.rayon, p.etagere, p.prix_achat, p.quantite_stock AS stock_actuel,
                    u.nom AS unite_nom, ma.nom AS marque_nom, mo.nom AS modele_nom
               FROM inventaire_lignes_entrepot l
               JOIN produits_entrepot p ON p.id_produit_entrepot = l.id_produit_entrepot
               LEFT JOIN unites u ON u.id_unite = p.id_unite
               LEFT JOIN marques ma ON ma.id_marque = p.id_marque
               LEFT JOIN modeles mo ON mo.id_modele = p.id_modele
              WHERE l.id_inventaire_entrepot = ?
              ORDER BY p.emplacement IS NULL, p.emplacement, p.rayon, p.etagere, p.nom`,
            [id_inventaire]
        );
        const unites = await MouvementEntrepot._unites(lignes.map((l) => l.id_produit_entrepot));

        let comptes = 0, ecarts = 0, valeur_manque = 0, valeur_surplus = 0;
        const out = lignes.map((l) => {
            const compte = !!l.date_scannage;
            const ecart = round2(l.ecart);
            const u = (unites[l.id_produit_entrepot] || []).map((x) => ({ nom: x.nom, quantite_base: num(x.quantite_base) }));
            const nomBase = l.unite_nom || 'Unité';
            if (compte) {
                comptes++;
                if (ecart !== 0) {
                    ecarts++;
                    if (ecart < 0) valeur_manque += -ecart * num(l.prix_achat);
                    else valeur_surplus += ecart * num(l.prix_achat);
                }
            }
            return {
                id: l.id,
                id_produit_entrepot: l.id_produit_entrepot,
                produit: l.produit,
                marque: l.marque_nom,
                modele: l.modele_nom,
                emplacement: [l.emplacement, l.rayon, l.etagere].filter(Boolean).join(' · ') || null,
                unite_base: nomBase,
                unites: u,
                theorique: num(l.quantite_theorique),
                reelle: compte ? num(l.quantite_reelle) : null,
                ecart: compte ? ecart : null,
                compte,
                notes: l.notes,
                date_comptage: l.date_scannage,
                theorique_texte: decomposer(u, num(l.quantite_theorique), nomBase).texte,
                reelle_texte: compte ? decomposer(u, num(l.quantite_reelle), nomBase).texte : null,
                ecart_texte: compte && ecart !== 0 ? decomposer(u, ecart, nomBase).texte : null,
                // le stock a bougé depuis la photo (vente, transfert…) : à signaler à la validation
                stock_a_change: round2(l.stock_actuel) !== round2(l.quantite_theorique),
            };
        });

        return {
            inventaire: {
                id: inv.id_inventaire_entrepot,
                reference: inv.reference,
                libelle: inv.libelle,
                type_inventaire: inv.type_inventaire,
                statut: inv.statut,
                notes: inv.notes,
                date_debut: inv.date_debut,
                date_fin: inv.date_fin,
                date_validation: inv.date_validation,
                valide_par: inv.valide_par,
            },
            lignes: out,
            totaux: {
                total: out.length,
                comptes,
                restants: out.length - comptes,
                ecarts,
                valeur_manque: Math.round(valeur_manque),
                valeur_surplus: Math.round(valeur_surplus),
            },
        };
    }

    /** Démarre un inventaire (complet, ou partiel sur une zone) : photo du stock actuel */
    static async creer(id_entrepot, id_utilisateur, { zone = null, libelle = null } = {}) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // un seul inventaire ouvert à la fois par entrepôt (verrou sur l'entrepôt)
            await conn.execute('SELECT id_entrepot FROM entrepots WHERE id_entrepot = ? FOR UPDATE', [id_entrepot]);
            const [ouverts] = await conn.execute(
                `SELECT reference FROM inventaires_entrepot WHERE id_entrepot = ? AND statut IN ('planifie','en_cours') LIMIT 1`,
                [id_entrepot]
            );
            if (ouverts.length) throw fail(`L'inventaire ${ouverts[0].reference} est déjà en cours. Terminez-le ou annulez-le avant d'en démarrer un autre.`, 409);

            const zoneNette = zone && String(zone).trim() ? String(zone).trim() : null;
            const where = ['id_entrepot = ?', 'actif = 1'];
            const params = [id_entrepot];
            if (zoneNette) { where.push('emplacement = ?'); params.push(zoneNette); }
            const [produits] = await conn.execute(
                `SELECT id_produit_entrepot, quantite_stock FROM produits_entrepot WHERE ${where.join(' AND ')}`,
                params
            );
            if (!produits.length) throw fail(zoneNette ? 'Aucun produit dans cette zone' : "Cet entrepôt ne contient aucun produit à inventorier");

            const jour = new Date().toISOString().slice(0, 10);
            const [[{ n }]] = await conn.execute(
                'SELECT COUNT(*) AS n FROM inventaires_entrepot WHERE id_entrepot = ?', [id_entrepot]
            );
            const reference = `INV-E${id_entrepot}-${jour.replace(/-/g, '')}-${String(n + 1).padStart(2, '0')}`;
            const titre = (libelle && String(libelle).trim())
                || (zoneNette ? `Inventaire ${zoneNette}` : 'Inventaire complet');

            const [res] = await conn.execute(
                `INSERT INTO inventaires_entrepot
                    (id_entrepot, id_utilisateur, reference, libelle, date_debut, type_inventaire, statut, notes)
                 VALUES (?, ?, ?, ?, ?, ?, 'en_cours', ?)`,
                [id_entrepot, id_utilisateur, reference, titre.slice(0, 200), jour,
                 zoneNette ? 'partiel' : 'complet', zoneNette ? `Zone : ${zoneNette}` : null]
            );
            const id = res.insertId;

            const valeurs = produits.map((p) => [id, p.id_produit_entrepot, round2(p.quantite_stock), 0, 0]);
            await conn.query(
                `INSERT INTO inventaire_lignes_entrepot
                    (id_inventaire_entrepot, id_produit_entrepot, quantite_theorique, quantite_reelle, ecart)
                 VALUES ?`,
                [valeurs]
            );

            await conn.commit();
            return { id, reference };
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    /**
     * Enregistre le comptage d'une ligne.
     * quantite_base = quantité réellement comptée (unité de base) ; conforme=true => égale au théorique.
     */
    static async compter(id_entrepot, id_inventaire, id_ligne, { quantite_base, conforme = false, notes = null }) {
        const inv = await this._inventaire(pool, id_entrepot, id_inventaire);
        if (inv.statut !== 'en_cours') throw fail("Cet inventaire n'est plus ouvert au comptage", 409);

        const [rows] = await pool.execute(
            `SELECT id_ligne_entrepot, quantite_theorique FROM inventaire_lignes_entrepot
              WHERE id_ligne_entrepot = ? AND id_inventaire_entrepot = ?`,
            [id_ligne, id_inventaire]
        );
        if (!rows.length) throw fail('Ligne introuvable', 404);

        const theorique = num(rows[0].quantite_theorique);
        const reelle = conforme ? theorique : round2(quantite_base);
        if (!Number.isFinite(reelle) || reelle < 0) throw fail('Quantité invalide');

        await pool.execute(
            `UPDATE inventaire_lignes_entrepot
                SET quantite_reelle = ?, ecart = ?, notes = ?, date_scannage = NOW()
              WHERE id_ligne_entrepot = ?`,
            [reelle, round2(reelle - theorique), notes ? String(notes).slice(0, 500) : null, id_ligne]
        );
        return { reelle, ecart: round2(reelle - theorique) };
    }

    /** Remet une ligne « à compter » */
    static async annulerComptage(id_entrepot, id_inventaire, id_ligne) {
        const inv = await this._inventaire(pool, id_entrepot, id_inventaire);
        if (inv.statut !== 'en_cours') throw fail("Cet inventaire n'est plus ouvert au comptage", 409);
        await pool.execute(
            `UPDATE inventaire_lignes_entrepot SET quantite_reelle = 0, ecart = 0, notes = NULL, date_scannage = NULL
              WHERE id_ligne_entrepot = ? AND id_inventaire_entrepot = ?`,
            [id_ligne, id_inventaire]
        );
    }

    /** Marque toutes les lignes restantes comme conformes (compté = théorique) */
    static async toutConforme(id_entrepot, id_inventaire) {
        const inv = await this._inventaire(pool, id_entrepot, id_inventaire);
        if (inv.statut !== 'en_cours') throw fail("Cet inventaire n'est plus ouvert au comptage", 409);
        const [r] = await pool.execute(
            `UPDATE inventaire_lignes_entrepot
                SET quantite_reelle = quantite_theorique, ecart = 0, date_scannage = NOW()
              WHERE id_inventaire_entrepot = ? AND date_scannage IS NULL`,
            [id_inventaire]
        );
        return r.affectedRows;
    }

    /**
     * Valide : aligne le stock des produits COMPTÉS sur le comptage et journalise chaque écart.
     * Les produits non comptés ne sont pas touchés.
     */
    static async valider(id_entrepot, id_inventaire, id_utilisateur) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const inv = await this._inventaire(conn, id_entrepot, id_inventaire, true);
            if (inv.statut !== 'en_cours') throw fail("Cet inventaire n'est plus ouvert", 409);

            const [lignes] = await conn.execute(
                `SELECT l.id_produit_entrepot, l.quantite_reelle, l.quantite_theorique
                   FROM inventaire_lignes_entrepot l
                  WHERE l.id_inventaire_entrepot = ? AND l.date_scannage IS NOT NULL`,
                [id_inventaire]
            );
            if (!lignes.length) throw fail("Comptez au moins un produit avant de terminer l'inventaire");

            let corriges = 0;
            for (const l of lignes) {
                const [[p]] = await conn.execute(
                    'SELECT quantite_stock FROM produits_entrepot WHERE id_produit_entrepot = ? AND id_entrepot = ? FOR UPDATE',
                    [l.id_produit_entrepot, id_entrepot]
                );
                if (!p) continue;
                const avant = round2(p.quantite_stock);
                const apres = round2(l.quantite_reelle);
                if (avant === apres) continue;

                await conn.execute(
                    'UPDATE produits_entrepot SET quantite_stock = ? WHERE id_produit_entrepot = ?',
                    [apres, l.id_produit_entrepot]
                );
                await MouvementEntrepot.log(conn, {
                    id_entrepot,
                    id_produit_entrepot: l.id_produit_entrepot,
                    id_utilisateur,
                    type_mouvement: 'inventaire',
                    quantite: Math.abs(apres - avant),
                    ancienne_quantite: avant,
                    nouvelle_quantite: apres,
                    type_reference: 'inventaire',
                    id_reference: id_inventaire,
                    notes: `Inventaire ${inv.reference}`,
                });
                corriges++;
            }

            const [[u]] = await conn.execute('SELECT fullname FROM utilisateurs WHERE id_utilisateur = ?', [id_utilisateur]);
            await conn.execute(
                `UPDATE inventaires_entrepot
                    SET statut = 'termine', date_fin = CURDATE(), date_validation = NOW(), valide_par = ?
                  WHERE id_inventaire_entrepot = ?`,
                [u?.fullname || null, id_inventaire]
            );
            await conn.commit();
            return { corriges, comptes: lignes.length };
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    static async annuler(id_entrepot, id_inventaire) {
        const inv = await this._inventaire(pool, id_entrepot, id_inventaire);
        if (inv.statut !== 'en_cours' && inv.statut !== 'planifie') throw fail("Seul un inventaire en cours peut être annulé", 409);
        await pool.execute(
            `UPDATE inventaires_entrepot SET statut = 'annule', date_fin = CURDATE() WHERE id_inventaire_entrepot = ?`,
            [id_inventaire]
        );
    }
}

export default InventaireEntrepot;