// models/TransfertStock.js
//
// Transfert ENTREPÔT -> MON PROPRE MAGASIN, avec approbation du propriétaire.
//
//   1. Un membre de l'entrepôt fait une DEMANDE : produit d'entrepôt, unité, quantité
//      et produit de destination dans SON catalogue (existant, ou à créer).
//      -> statut « en_attente », AUCUN stock ne bouge.
//   2. Le propriétaire de l'entrepôt :
//        - approuve -> (une seule transaction) stock entrepôt ↓ et stock du catalogue du demandeur ↑
//        - refuse   -> rien ne bouge
//   3. Le demandeur peut annuler tant que la demande est en attente.
//
//   Si le demandeur EST le propriétaire, la demande est approuvée immédiatement.
//
// Le stock est vérifié à la demande, puis revérifié (avec verrou FOR UPDATE) à l'approbation.
// Toutes les quantités sont en UNITÉ DE BASE.
//
// `id_utilisateur_destination` = le compte DEMANDEUR (propriétaire du catalogue qui reçoit).
// `id_utilisateur_validateur`  = le propriétaire qui a approuvé / refusé.
import { pool } from '../config/db.js';

const fail = (message, statusCode = 400, code = null) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    if (code) err.code = code;
    return err;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || '').trim().toLowerCase();

class TransfertStock {
    /* ============================================================
       HELPERS
       ============================================================ */
    /**
     * Numéro séquentiel PAR ENTREPÔT : TRF-E2-00001, TRF-E2-00002, …
     * La ligne de l'entrepôt est verrouillée (FOR UPDATE) pour que deux demandes
     * simultanées n'obtiennent jamais le même numéro.
     * (Les anciens numéros aléatoires restent tels quels : ils sont ignorés par la séquence.)
     */
    static async _prochainNumero(conn, id_entrepot) {
        await conn.execute(`SELECT id_entrepot FROM entrepots WHERE id_entrepot = ? FOR UPDATE`, [id_entrepot]);
        const prefix = `TRF-E${Number(id_entrepot)}-`;
        const [rows] = await conn.execute(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(numero_transfert, ?) AS UNSIGNED)), 0) AS n
               FROM transferts_stock
              WHERE id_entrepot_source = ? AND numero_transfert LIKE ?`,
            [prefix.length + 1, id_entrepot, `${prefix}%`]
        );
        return `${prefix}${String((parseInt(rows[0].n, 10) || 0) + 1).padStart(5, '0')}`;
    }

    /** Numéro de bon pour un panier : BT-E1-00001 */
    static async _prochainNumeroLot(conn, id_entrepot) {
        await conn.execute(`SELECT id_entrepot FROM entrepots WHERE id_entrepot = ? FOR UPDATE`, [id_entrepot]);
        const prefix = `BT-E${Number(id_entrepot)}-`;
        const [rows] = await conn.execute(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(numero_lot, ?) AS UNSIGNED)), 0) AS n
               FROM transferts_stock
              WHERE id_entrepot_source = ? AND numero_lot LIKE ?`,
            [prefix.length + 1, id_entrepot, `${prefix}%`]
        );
        return `${prefix}${String((parseInt(rows[0].n, 10) || 0) + 1).padStart(5, '0')}`;
    }

    static _cast(t) {
        t.quantite        = parseFloat(t.quantite)        || 0;
        t.quantite_base   = parseFloat(t.quantite_base)   || 1;
        t.quantite_saisie = t.quantite_saisie !== null && t.quantite_saisie !== undefined
            ? parseFloat(t.quantite_saisie) || 0
            : t.quantite;
        if (t.stock_entrepot !== undefined) t.stock_entrepot = parseFloat(t.stock_entrepot) || 0;
        return t;
    }

    static async _lock(conn, id_transfert) {
        const [rows] = await conn.execute(
            `SELECT * FROM transferts_stock WHERE id_transfert = ? FOR UPDATE`,
            [id_transfert]
        );
        return rows[0] || null;
    }

    /** Propriétaire d'un entrepôt actif (id utilisateur) ou null */
    static async getProprietaire(id_entrepot, db = pool) {
        const [rows] = await db.execute(
            `SELECT id_utilisateur_proprietaire FROM entrepots WHERE id_entrepot = ? AND actif = 1`,
            [id_entrepot]
        );
        return rows.length ? Number(rows[0].id_utilisateur_proprietaire) : null;
    }

    static async estProprietaire(id_entrepot, id_utilisateur) {
        const p = await this.getProprietaire(id_entrepot);
        return p !== null && p === Number(id_utilisateur);
    }

    /** Valeur de référentiel (catégorie, marque, modèle, unité) équivalente dans le compte, sans la créer */
    static async _findRef(conn, table, idCol, sourceId, id_utilisateur) {
        if (!sourceId) return null;
        const [src] = await conn.execute(`SELECT nom FROM ${table} WHERE ${idCol} = ? LIMIT 1`, [sourceId]);
        if (src.length === 0) return null;
        const [ex] = await conn.execute(
            `SELECT ${idCol} AS id FROM ${table}
              WHERE id_utilisateur = ? AND LOWER(TRIM(nom)) = LOWER(TRIM(?)) LIMIT 1`,
            [id_utilisateur, src[0].nom]
        );
        return ex.length ? ex[0].id : null;
    }

    /**
     * Retrouve (ou crée) dans le catalogue du compte l'équivalent d'une valeur de référentiel.
     * Les référentiels sont PAR COMPTE : on ne réutilise jamais l'id d'un autre compte.
     */
    static async _mapRef(conn, table, idCol, sourceId, id_utilisateur) {
        if (!sourceId) return null;
        const [src] = await conn.execute(`SELECT * FROM ${table} WHERE ${idCol} = ? LIMIT 1`, [sourceId]);
        if (src.length === 0) return null;
        const s = src[0];

        const existant = await this._findRef(conn, table, idCol, sourceId, id_utilisateur);
        if (existant) return existant;

        let result;
        switch (table) {
            case 'categories':
                [result] = await conn.execute(
                    `INSERT INTO categories (id_utilisateur, nom, description) VALUES (?, ?, ?)`,
                    [id_utilisateur, s.nom, s.description || null]
                );
                break;
            case 'marques':
                [result] = await conn.execute(
                    `INSERT INTO marques (id_utilisateur, nom, description) VALUES (?, ?, ?)`,
                    [id_utilisateur, s.nom, s.description || null]
                );
                break;
            case 'modeles':
                [result] = await conn.execute(
                    `INSERT INTO modeles (id_utilisateur, nom) VALUES (?, ?)`,
                    [id_utilisateur, s.nom]
                );
                break;
            case 'unites':
                [result] = await conn.execute(
                    `INSERT INTO unites (id_utilisateur, nom, symbole, description) VALUES (?, ?, ?, ?)`,
                    [id_utilisateur, s.nom, s.symbole, s.description || null]
                );
                break;
            default:
                throw new Error(`Référentiel inconnu : ${table}`);
        }
        return result.insertId;
    }

    /** Un produit identique (nom + marque + modèle) existe-t-il déjà dans le catalogue du compte ? (lecture seule) */
    static async _doublonExiste(conn, src, id_utilisateur) {
        return (await this._doublonId(conn, src, id_utilisateur)) !== null;
    }

    /** Id du produit identique (nom + marque + modèle) dans le catalogue du compte, sinon null */
    static async _doublonId(conn, src, id_utilisateur) {
        const hasMarque = !!src.id_marque;
        const hasModele = !!src.id_modele;
        const idMarque = await this._findRef(conn, 'marques', 'id_marque', src.id_marque, id_utilisateur);
        const idModele = await this._findRef(conn, 'modeles', 'id_modele', src.id_modele, id_utilisateur);
        // Une marque/un modèle qui n'existe pas encore chez le demandeur : pas de doublon possible
        if ((hasMarque && !idMarque) || (hasModele && !idModele)) return null;

        const [dup] = await conn.execute(
            `SELECT id_produit FROM produits
              WHERE id_utilisateur = ?
                AND LOWER(TRIM(nom)) = LOWER(TRIM(?))
                AND id_marque <=> ?
                AND id_modele <=> ?
              LIMIT 1`,
            [id_utilisateur, src.nom, idMarque, idModele]
        );
        return dup.length > 0 ? dup[0].id_produit : null;
    }

    /**
     * Décision AUTOMATIQUE de la destination dans le catalogue du demandeur :
     *  - produit identique (nom + marque + modèle) -> on l'alimente (jamais de doublon) ;
     *  - sinon -> le produit est créé (copié) chez lui.
     * Retourne { mode: 'existant'|'creer', id_produit_destination, produit? }
     */
    static async _destinationAuto(conn, src, id_utilisateur) {
        const id = await this._doublonId(conn, src, id_utilisateur);
        if (!id) return { mode: 'creer', id_produit_destination: null };
        const [rows] = await conn.execute(
            `SELECT p.id_produit, p.nom, p.quantite_stock, u.nom AS unite_nom, u.symbole AS unite_symbole
               FROM produits p LEFT JOIN unites u ON u.id_unite = p.id_unite
              WHERE p.id_produit = ?`,
            [id]
        );
        const p = rows[0];
        const uSrc = norm(src.unite_nom);
        // Même produit (nom + marque + modèle) : on l'alimente toujours, jamais de doublon.
        // Si l'unité de base diffère, les quantités s'ajoutent telles quelles (signalé à l'utilisateur).
        const uniteDiff = !!(p && uSrc && norm(p.unite_nom) && uSrc !== norm(p.unite_nom));
        return {
            mode: 'existant',
            id_produit_destination: id,
            unite_differente: uniteDiff,
            produit: p ? { ...p, quantite_stock: parseFloat(p.quantite_stock) || 0 } : null,
        };
    }

    /** Produit d'entrepôt avec le nom de son unité de base */
    static async _produitEntrepot(conn, id_produit_entrepot, id_entrepot, lock = false) {
        const [rows] = await conn.execute(
            `SELECT pe.*, u.nom AS unite_nom
               FROM produits_entrepot pe
               LEFT JOIN unites u ON u.id_unite = pe.id_unite
              WHERE pe.id_produit_entrepot = ? AND pe.id_entrepot = ? AND pe.actif = 1
              ${lock ? 'FOR UPDATE' : ''}`,
            [id_produit_entrepot, id_entrepot]
        );
        return rows[0] || null;
    }

    /**
     * Applique l'approbation : stock entrepôt ↓ puis stock du catalogue du demandeur ↑.
     * À appeler DANS une transaction, avec le transfert déjà verrouillé et « en_attente ».
     */
    static async _executer(conn, t, id_approbateur) {
        const dest = Number(t.id_utilisateur_destination);
        const quantite = parseFloat(t.quantite) || 0;

        /* ---- 1) Entrepôt : stock revérifié sous verrou, puis ↓ ---- */
        const src = await this._produitEntrepot(conn, t.id_produit_entrepot, t.id_entrepot_source, true);
        if (!src) throw fail("Ce produit n'existe plus dans l'entrepôt : refusez la demande", 409, 'PRODUIT_ENTREPOT_INTROUVABLE');

        const ancienEnt = parseFloat(src.quantite_stock) || 0;
        if (ancienEnt < quantite) {
            throw fail(
                `Stock insuffisant dans l'entrepôt : ${ancienEnt} disponible(s), ${quantite} demandé(s)`,
                409,
                'STOCK_INSUFFISANT'
            );
        }
        const nouveauEnt = round2(ancienEnt - quantite);

        await conn.execute(
            `UPDATE produits_entrepot SET quantite_stock = ? WHERE id_produit_entrepot = ?`,
            [nouveauEnt, t.id_produit_entrepot]
        );

        await conn.execute(
            `INSERT INTO mouvements_entrepot
                (id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
                 quantite, ancienne_quantite, nouvelle_quantite,
                 id_unite_vente_entrepot, nom_unite_vente, quantite_base, quantite_saisie,
                 type_reference, id_reference, notes)
             VALUES (?, ?, ?, 'transfert_sortie', ?, ?, ?, ?, ?, ?, ?, 'transfert', ?, ?)`,
            [
                t.id_entrepot_source, t.id_produit_entrepot, id_approbateur,
                quantite, ancienEnt, nouveauEnt,
                t.id_unite_vente_entrepot || null, t.nom_unite_vente || 'Unité',
                t.quantite_base || 1, t.quantite_saisie ?? quantite,
                t.id_transfert, `Transfert ${t.numero_transfert}`,
            ]
        );

        await conn.execute(
            `INSERT INTO sorties_stock_entrepot
                (id_entrepot, id_utilisateur, reference, date_sortie, id_produit_entrepot,
                 id_unite_vente_entrepot, nom_unite_vente, quantite_base,
                 quantite, quantite_totale_base, type_sortie, id_transfert, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'transfert', ?, ?)`,
            [
                t.id_entrepot_source, id_approbateur, t.numero_transfert, today(), t.id_produit_entrepot,
                t.id_unite_vente_entrepot || null, t.nom_unite_vente || 'Unité', t.quantite_base || 1,
                t.quantite_saisie ?? quantite, quantite, t.id_transfert, t.motif || null,
            ]
        );

        /* ---- 2) Catalogue du demandeur : produit existant ou création ---- */
        let idProduit;
        let ancien = 0;
        let cree = false;

        if (t.mode_destination === 'existant') {
            if (!t.id_produit_destination) {
                throw fail("Le produit de destination n'existe plus chez le demandeur : refusez la demande", 409, 'PRODUIT_DEST_INTROUVABLE');
            }
            const [pRows] = await conn.execute(
                `SELECT p.id_produit, p.quantite_stock, u.nom AS unite_nom
                   FROM produits p
                   LEFT JOIN unites u ON u.id_unite = p.id_unite
                  WHERE p.id_produit = ? AND p.id_utilisateur = ?
                  FOR UPDATE`,
                [t.id_produit_destination, dest]
            );
            if (pRows.length === 0) {
                throw fail("Le produit de destination n'existe plus chez le demandeur : refusez la demande", 409, 'PRODUIT_DEST_INTROUVABLE');
            }
            if (!t.unite_forcee && norm(src.unite_nom) && norm(pRows[0].unite_nom)
                && norm(src.unite_nom) !== norm(pRows[0].unite_nom)) {
                throw fail(
                    `L'unité de base diffère (« ${src.unite_nom} » / « ${pRows[0].unite_nom} ») : refusez la demande`,
                    409,
                    'UNITE_DIFFERENTE'
                );
            }
            idProduit = pRows[0].id_produit;
            ancien = parseFloat(pRows[0].quantite_stock) || 0;
        } else {
            if (await this._doublonExiste(conn, src, dest)) {
                throw fail(
                    'Un produit identique existe maintenant dans le catalogue du demandeur : refusez la demande',
                    409,
                    'DUPLICATE_PRODUIT'
                );
            }
            const idCat    = await this._mapRef(conn, 'categories', 'id_categorie', src.id_categorie, dest);
            const idMarque = await this._mapRef(conn, 'marques',    'id_marque',    src.id_marque,    dest);
            const idModele = await this._mapRef(conn, 'modeles',    'id_modele',    src.id_modele,    dest);
            const idUnite  = await this._mapRef(conn, 'unites',     'id_unite',     src.id_unite,     dest);

            // Le fournisseur de l'entrepôt n'est pas forcément celui du magasin : laissé vide
            const [ins] = await conn.execute(
                `INSERT INTO produits
                    (id_utilisateur, nom, description, id_categorie, id_marque, id_modele,
                     id_unite, id_fournisseur, prix_achat, prix_vente,
                     quantite_stock, quantite_minimale, quantite_maximale, statut)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, 'rupture')`,
                [
                    dest, src.nom, src.description || null,
                    idCat, idMarque, idModele, idUnite,
                    parseFloat(src.prix_achat) || 0, parseFloat(src.prix_vente) || 0,
                    parseFloat(src.quantite_minimale) || 0, parseFloat(src.quantite_maximale) || 0,
                ]
            );
            idProduit = ins.insertId;
            cree = true;

            const [unitesSrc] = await conn.execute(
                `SELECT nom, quantite_base, prix_vente, prix_achat, est_principal
                   FROM unites_vente_entrepot
                  WHERE id_produit_entrepot = ? AND actif = 1
                  ORDER BY est_principal DESC, id_unite_vente_entrepot ASC`,
                [t.id_produit_entrepot]
            );
            if (unitesSrc.length > 0) {
                for (const u of unitesSrc) {
                    await conn.execute(
                        `INSERT INTO unites_vente
                            (id_produit, nom, quantite_base, prix_vente, prix_achat, est_principal, actif)
                         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                        [idProduit, u.nom, parseFloat(u.quantite_base) || 1,
                         parseFloat(u.prix_vente) || 0, parseFloat(u.prix_achat) || 0, !!u.est_principal]
                    );
                }
            } else {
                await conn.execute(
                    `INSERT INTO unites_vente
                        (id_produit, nom, quantite_base, prix_vente, prix_achat, est_principal, actif)
                     VALUES (?, 'Unité', 1, ?, ?, TRUE, TRUE)`,
                    [idProduit, parseFloat(src.prix_vente) || 0, parseFloat(src.prix_achat) || 0]
                );
            }
        }

        /* ---- 3) Stock du catalogue du demandeur ↑ + traces ---- */
        const nouveau = round2(ancien + quantite);
        await conn.execute(
            `UPDATE produits
                SET quantite_stock = ?,
                    statut = IF(? > 0, 'disponible', 'rupture')
              WHERE id_produit = ? AND id_utilisateur = ?`,
            [nouveau, nouveau, idProduit, dest]
        );

        await conn.execute(
            `INSERT INTO entrees_stock
                (id_utilisateur, reference, id_produit, nom_unite_vente, quantite_base,
                 quantite, quantite_totale_base, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                dest, t.numero_transfert, idProduit,
                t.nom_unite_vente || 'Unité', parseFloat(t.quantite_base) || 1,
                parseFloat(t.quantite_saisie) || quantite, quantite,
                `Transfert ${t.numero_transfert} depuis l'entrepôt`,
            ]
        );
        await conn.execute(
            `INSERT INTO mouvements_stock
                (id_utilisateur, id_produit, type_mouvement, quantite,
                 ancienne_quantite, nouvelle_quantite, id_reference, type_reference, notes)
             VALUES (?, ?, 'entree', ?, ?, ?, ?, 'transfert', ?)`,
            [dest, idProduit, quantite, ancien, nouveau, t.id_transfert, `Transfert ${t.numero_transfert}`]
        );

        /* ---- 4) Clôture ---- */
        await conn.execute(
            `UPDATE transferts_stock
                SET statut = 'valide', id_produit_destination = ?,
                    id_utilisateur_validateur = ?, date_validation = NOW()
              WHERE id_transfert = ?`,
            [idProduit, id_approbateur, t.id_transfert]
        );

        return { id_produit_destination: idProduit, cree };
    }

    /* ============================================================
       CREATE — un membre demande un transfert vers SON catalogue
       mode = 'existant' : id_produit_destination (produit de son catalogue)
       mode = 'creer'    : copie du produit d'entrepôt dans son catalogue
       ============================================================ */
    /** Crée UN transfert dans la transaction `conn` (sans commit) */
    static async _creerUn(conn, {
        id_entrepot,
        id_utilisateur,
        id_produit_entrepot,
        id_unite_vente_entrepot = null,
        quantite_saisie,
        mode,
        id_produit_destination = null,
        forcer = false,
        date_transfert = null,
        motif = null,
        notes = null,
        numero_lot = null,
    }) {
        const qSaisie = parseFloat(quantite_saisie);
        if (!(qSaisie > 0)) throw fail('La quantité doit être supérieure à 0');
        if (!['existant', 'creer'].includes(mode)) {
            throw fail("Choisissez un produit existant de votre catalogue ou la création d'un nouveau produit");
        }
        const dateT = /^\d{4}-\d{2}-\d{2}$/.test(date_transfert || '') ? date_transfert : today();

        // 1) Le demandeur : membre actif de l'entrepôt, avec un magasin
        const [membre] = await conn.execute(
            `SELECT (SELECT MIN(m.id_magasin) FROM magasins m
                      WHERE m.id_utilisateur = me.id_utilisateur AND m.actif = 1) AS id_magasin
               FROM membres_entrepot me
               JOIN utilisateurs u ON u.id_utilisateur = me.id_utilisateur
              WHERE me.id_entrepot = ? AND me.id_utilisateur = ? AND me.actif = 1 AND u.actif = 1
              LIMIT 1`,
            [id_entrepot, id_utilisateur]
        );
        if (membre.length === 0) throw fail("Vous n'êtes pas membre de cet entrepôt", 403);
        if (!membre[0].id_magasin) throw fail("Vous n'avez pas de magasin configuré");

        // 2) Produit d'entrepôt
        const src = await this._produitEntrepot(conn, id_produit_entrepot, id_entrepot);
        if (!src) throw fail("Produit d'entrepôt introuvable", 404);

        // 3) Unité choisie (sinon unité de base)
        let uv = { id: null, nom: src.unite_nom || 'Unité', base: 1 };
        if (id_unite_vente_entrepot) {
            const [uRows] = await conn.execute(
                `SELECT id_unite_vente_entrepot, nom, quantite_base
                   FROM unites_vente_entrepot
                  WHERE id_unite_vente_entrepot = ? AND id_produit_entrepot = ? AND actif = 1`,
                [id_unite_vente_entrepot, id_produit_entrepot]
            );
            if (uRows.length === 0) throw fail('Unité de vente introuvable pour ce produit');
            uv = {
                id: uRows[0].id_unite_vente_entrepot,
                nom: uRows[0].nom,
                base: parseFloat(uRows[0].quantite_base) || 1,
            };
        }

        // 4) Quantité en unité de base + contrôle du stock (revérifié à l'approbation)
        const quantite = round2(qSaisie * uv.base);
        const stock = parseFloat(src.quantite_stock) || 0;
        if (stock < quantite) {
            throw fail(`Stock insuffisant : ${stock} disponible(s), ${quantite} demandé(s)`, 400, 'STOCK_INSUFFISANT');
        }

        // 5) Destination dans le catalogue du demandeur
        let idDest = null;
        let uniteForcee = 0;
        if (mode === 'existant') {
            if (!id_produit_destination) throw fail('Sélectionnez le produit de votre catalogue qui recevra le stock');
            const [pRows] = await conn.execute(
                `SELECT p.id_produit, u.nom AS unite_nom
                   FROM produits p
                   LEFT JOIN unites u ON u.id_unite = p.id_unite
                  WHERE p.id_produit = ? AND p.id_utilisateur = ?`,
                [id_produit_destination, id_utilisateur]
            );
            if (pRows.length === 0) throw fail('Produit introuvable dans votre catalogue', 404);

            if (norm(src.unite_nom) && norm(pRows[0].unite_nom) && norm(src.unite_nom) !== norm(pRows[0].unite_nom)) {
                if (!forcer) {
                    throw fail(
                        `L'unité de base diffère : « ${src.unite_nom} » dans l'entrepôt, « ${pRows[0].unite_nom} » dans votre produit.`,
                        409,
                        'UNITE_DIFFERENTE'
                    );
                }
                uniteForcee = 1;
            }
            idDest = pRows[0].id_produit;
        } else if (await this._doublonExiste(conn, src, id_utilisateur)) {
            throw fail(
                'Un produit identique existe déjà dans votre catalogue : choisissez-le dans la liste.',
                409,
                'DUPLICATE_PRODUIT'
            );
        }

        // 6) La demande
        const numero = await this._prochainNumero(conn, id_entrepot);
        const [ins] = await conn.execute(
            `INSERT INTO transferts_stock
                (numero_transfert, numero_lot, id_entrepot_source, id_produit_entrepot,
                 id_magasin_destination, id_utilisateur_destination,
                 id_produit_destination, mode_destination, unite_forcee,
                 quantite, id_unite_vente_entrepot, nom_unite_vente, quantite_base, quantite_saisie,
                 date_transfert, statut, motif, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
            [
                numero, numero_lot, id_entrepot, id_produit_entrepot,
                membre[0].id_magasin, id_utilisateur,
                idDest, mode, uniteForcee,
                quantite, uv.id, uv.nom, uv.base, qSaisie,
                dateT, motif ? String(motif).slice(0, 200) : null, notes || null,
            ]
        );
        const id_transfert = ins.insertId;

        // 7) Le propriétaire n'a pas à s'approuver lui-même : exécution immédiate
        let statut = 'en_attente';
        let resultat = null;
        const proprietaire = await this.getProprietaire(id_entrepot, conn);
        if (proprietaire === Number(id_utilisateur)) {
            const t = await this._lock(conn, id_transfert);
            resultat = await this._executer(conn, t, id_utilisateur);
            statut = 'valide';
        }

        return { id_transfert, numero_transfert: numero, numero_lot, statut, ...(resultat || {}) };
    }

    static async create(params) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            let p = params;
            if (!p.mode || p.mode === 'auto') {
                const src = await this._produitEntrepot(conn, p.id_produit_entrepot, p.id_entrepot);
                if (!src) throw fail("Produit d'entrepôt introuvable", 404);
                const d = await this._destinationAuto(conn, src, p.id_utilisateur);
                p = { ...p, mode: d.mode, id_produit_destination: d.id_produit_destination, forcer: p.forcer === true || d.unite_differente === true };
            }
            const r = await this._creerUn(conn, p);
            await conn.commit();
            return r;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /* ============================================================
       CREATE LOT — plusieurs produits d'un coup (panier). TOUT OU RIEN :
       si une ligne échoue, rien n'est créé et l'erreur nomme le produit.
       items : [{ id_produit_entrepot, id_unite_vente_entrepot?, quantite_saisie, forcer? }]
       Destination automatique : produit identique (nom + marque + modèle) déjà dans
       le catalogue du demandeur -> on l'alimente, sinon il est créé.
       Un transfert (donc un numéro et un bon) par produit.
       ============================================================ */
    static async createLot({ id_entrepot, id_utilisateur, items, date_transfert = null, motif = null, notes = null }) {
        if (!Array.isArray(items) || items.length === 0) throw fail('Le panier est vide');
        const vus = new Set();
        for (const it of items) {
            const cle = String(it.id_produit_entrepot);
            if (vus.has(cle)) throw fail('Un produit apparaît deux fois dans le panier');
            vus.add(cle);
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const resultats = [];
            const numero_lot = await this._prochainNumeroLot(conn, id_entrepot);

            for (const it of items) {
                const src = await this._produitEntrepot(conn, it.id_produit_entrepot, id_entrepot);
                if (!src) throw fail(`Produit d'entrepôt ${it.id_produit_entrepot} introuvable`, 404);

                try {
                    const dest = await this._destinationAuto(conn, src, id_utilisateur);
                    const idDoublon = dest.id_produit_destination;
                    const r = await this._creerUn(conn, {
                        id_entrepot,
                        id_utilisateur,
                        id_produit_entrepot: it.id_produit_entrepot,
                        id_unite_vente_entrepot: it.id_unite_vente_entrepot || null,
                        quantite_saisie: it.quantite_saisie,
                        mode: idDoublon ? 'existant' : 'creer',
                        id_produit_destination: idDoublon,
                        forcer: it.forcer === true || dest.unite_differente === true,
                        date_transfert,
                        motif,
                        notes,
                        numero_lot,
                    });
                    resultats.push({ ...r, produit: src.nom });
                } catch (e) {
                    e.message = `${src.nom} : ${e.message}`;
                    throw e;
                }
            }

            await conn.commit();
            return resultats;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /* ============================================================
       APPROUVER — le propriétaire de l'entrepôt
       ============================================================ */
    static async approuver({ id_transfert, id_entrepot, id_utilisateur }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const t = await this._lock(conn, id_transfert);
            if (!t || Number(t.id_entrepot_source) !== Number(id_entrepot)) throw fail('Demande introuvable', 404);
            if (Number(await this.getProprietaire(id_entrepot, conn)) !== Number(id_utilisateur)) {
                throw fail("Seul le propriétaire de l'entrepôt peut approuver une demande", 403);
            }
            if (t.statut !== 'en_attente') throw fail(`Cette demande est déjà ${t.statut}`, 409);

            const resultat = await this._executer(conn, t, id_utilisateur);

            await conn.commit();
            return resultat;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /* ============================================================
       REFUSER — le propriétaire (aucun stock à restituer)
       ============================================================ */
    static async refuser({ id_transfert, id_entrepot, id_utilisateur, motif = null }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const t = await this._lock(conn, id_transfert);
            if (!t || Number(t.id_entrepot_source) !== Number(id_entrepot)) throw fail('Demande introuvable', 404);
            if (Number(await this.getProprietaire(id_entrepot, conn)) !== Number(id_utilisateur)) {
                throw fail("Seul le propriétaire de l'entrepôt peut refuser une demande", 403);
            }
            if (t.statut !== 'en_attente') throw fail(`Cette demande est déjà ${t.statut}`, 409);

            await conn.execute(
                `UPDATE transferts_stock
                    SET statut = 'refuse', motif_refus = ?, id_utilisateur_validateur = ?, date_validation = NOW()
                  WHERE id_transfert = ?`,
                [motif ? String(motif).trim().slice(0, 255) : null, id_utilisateur, id_transfert]
            );

            await conn.commit();
            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /* ============================================================
       ANNULER — le demandeur, tant que la demande est en attente
       ============================================================ */
    static async annuler({ id_transfert, id_entrepot, id_utilisateur }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const t = await this._lock(conn, id_transfert);
            if (!t
                || Number(t.id_entrepot_source) !== Number(id_entrepot)
                || Number(t.id_utilisateur_destination) !== Number(id_utilisateur)) {
                throw fail('Demande introuvable', 404);
            }
            if (t.statut !== 'en_attente') throw fail(`Cette demande est déjà ${t.statut}`, 409);

            await conn.execute(
                `UPDATE transferts_stock SET statut = 'annule', date_validation = NOW() WHERE id_transfert = ?`,
                [id_transfert]
            );

            await conn.commit();
            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /* ============================================================
       ACTIONS SUR UN PANIER (numero_lot) : tout le lot d'un coup, tout ou rien
       ============================================================ */
    static async _verrouillerLot(conn, id_entrepot, numero_lot) {
        const [rows] = await conn.execute(
            `SELECT id_transfert FROM transferts_stock
              WHERE id_entrepot_source = ? AND numero_lot = ?
              ORDER BY id_transfert FOR UPDATE`,
            [id_entrepot, numero_lot]
        );
        if (rows.length === 0) throw fail('Transfert introuvable', 404);
        const lignes = [];
        for (const r of rows) lignes.push(await this._lock(conn, r.id_transfert));
        for (const t of lignes) {
            if (t.statut !== 'en_attente') throw fail(`Ce transfert est déjà ${t.statut}`, 409);
        }
        return lignes;
    }

    static async approuverLot({ numero_lot, id_entrepot, id_utilisateur }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (Number(await this.getProprietaire(id_entrepot, conn)) !== Number(id_utilisateur)) {
                throw fail("Seul le propriétaire de l'entrepôt peut approuver une demande", 403);
            }
            const lignes = await this._verrouillerLot(conn, id_entrepot, numero_lot);
            for (const t of lignes) {
                try {
                    await this._executer(conn, t, id_utilisateur);
                } catch (e) {
                    const [pr] = await conn.execute(`SELECT nom FROM produits_entrepot WHERE id_produit_entrepot = ?`, [t.id_produit_entrepot]);
                    e.message = `${pr[0]?.nom || 'Produit'} : ${e.message}`;
                    throw e;
                }
            }
            await conn.commit();
            return lignes.length;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async refuserLot({ numero_lot, id_entrepot, id_utilisateur, motif = null }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (Number(await this.getProprietaire(id_entrepot, conn)) !== Number(id_utilisateur)) {
                throw fail("Seul le propriétaire de l'entrepôt peut refuser une demande", 403);
            }
            const lignes = await this._verrouillerLot(conn, id_entrepot, numero_lot);
            await conn.execute(
                `UPDATE transferts_stock
                    SET statut = 'refuse', motif_refus = ?, id_utilisateur_validateur = ?, date_validation = NOW()
                  WHERE id_entrepot_source = ? AND numero_lot = ?`,
                [motif ? String(motif).trim().slice(0, 255) : null, id_utilisateur, id_entrepot, numero_lot]
            );
            await conn.commit();
            return lignes.length;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async annulerLot({ numero_lot, id_entrepot, id_utilisateur }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const lignes = await this._verrouillerLot(conn, id_entrepot, numero_lot);
            if (lignes.some((t) => Number(t.id_utilisateur_destination) !== Number(id_utilisateur))) {
                throw fail('Transfert introuvable', 404);
            }
            await conn.execute(
                `UPDATE transferts_stock SET statut = 'annule', date_validation = NOW()
                  WHERE id_entrepot_source = ? AND numero_lot = ?`,
                [id_entrepot, numero_lot]
            );
            await conn.commit();
            return lignes.length;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /* ============================================================
       LISTES
       Le propriétaire voit toutes les demandes de l'entrepôt ;
       un membre ne voit que les siennes.
       ============================================================ */
    static async getByEntrepot(id_entrepot, id_utilisateur, statut = null) {
        const est_proprietaire = await this.estProprietaire(id_entrepot, id_utilisateur);

        const params = [id_entrepot];
        let filtre = '';
        if (!est_proprietaire) {
            filtre += ' AND t.id_utilisateur_destination = ?';
            params.push(id_utilisateur);
        }
        if (statut) {
            filtre += ' AND t.statut = ?';
            params.push(statut);
        }

        const [rows] = await pool.execute(
            `SELECT t.*,
                    pe.nom AS produit_nom, pe.quantite_stock AS stock_entrepot,
                    ma.nom AS marque_nom, mo.nom AS modele_nom,
                    un.nom AS unite_nom, un.symbole AS unite_symbole,
                    dem.fullname AS demandeur_nom,
                    mg.nom_commercial AS magasin_nom, mg.ville AS magasin_ville,
                    p.nom AS produit_destination_nom,
                    e.nom AS entrepot_nom, e.ville AS entrepot_ville, e.adresse AS entrepot_adresse,
                    val.fullname AS approbateur_nom
               FROM transferts_stock t
               JOIN entrepots e ON e.id_entrepot = t.id_entrepot_source
               LEFT JOIN utilisateurs val ON val.id_utilisateur = t.id_utilisateur_validateur
               JOIN produits_entrepot pe ON pe.id_produit_entrepot = t.id_produit_entrepot
               LEFT JOIN marques ma ON ma.id_marque = pe.id_marque
               LEFT JOIN modeles mo ON mo.id_modele = pe.id_modele
               LEFT JOIN unites un  ON un.id_unite  = pe.id_unite
               JOIN utilisateurs dem ON dem.id_utilisateur = t.id_utilisateur_destination
               LEFT JOIN magasins mg ON mg.id_magasin = t.id_magasin_destination
               LEFT JOIN produits p ON p.id_produit = t.id_produit_destination
              WHERE t.id_entrepot_source = ?${filtre}
              ORDER BY (t.statut = 'en_attente') DESC, t.date_creation DESC, t.id_transfert DESC
              LIMIT 500`,
            params
        );
        return { est_proprietaire, transferts: rows.map((r) => this._cast(r)) };
    }

    /**
     * Vue centrale (page /transferts) : tous MES transferts, tous entrepôts confondus.
     *   - entrepôts dont je suis propriétaire : toutes les demandes (je les approuve)
     *   - autres entrepôts : seulement mes propres demandes
     * Chaque ligne porte `est_proprietaire` et `id_entrepot_source` pour savoir
     * quelles actions proposer et sur quelle route les envoyer.
     */
    static async getMesTransferts(id_utilisateur, statut = null) {
        const params = [id_utilisateur, id_utilisateur, id_utilisateur];
        let filtre = '';
        if (statut) {
            filtre = ' AND t.statut = ?';
            params.push(statut);
        }

        const [rows] = await pool.execute(
            `SELECT t.*,
                    (e.id_utilisateur_proprietaire = ?) AS est_proprietaire,
                    pe.nom AS produit_nom, pe.quantite_stock AS stock_entrepot,
                    ma.nom AS marque_nom, mo.nom AS modele_nom,
                    un.nom AS unite_nom, un.symbole AS unite_symbole,
                    dem.fullname AS demandeur_nom,
                    mg.nom_commercial AS magasin_nom, mg.ville AS magasin_ville,
                    p.nom AS produit_destination_nom,
                    e.nom AS entrepot_nom, e.ville AS entrepot_ville, e.adresse AS entrepot_adresse,
                    val.fullname AS approbateur_nom
               FROM transferts_stock t
               JOIN entrepots e ON e.id_entrepot = t.id_entrepot_source AND e.actif = 1
               LEFT JOIN utilisateurs val ON val.id_utilisateur = t.id_utilisateur_validateur
               JOIN produits_entrepot pe ON pe.id_produit_entrepot = t.id_produit_entrepot
               LEFT JOIN marques ma ON ma.id_marque = pe.id_marque
               LEFT JOIN modeles mo ON mo.id_modele = pe.id_modele
               LEFT JOIN unites un  ON un.id_unite  = pe.id_unite
               JOIN utilisateurs dem ON dem.id_utilisateur = t.id_utilisateur_destination
               LEFT JOIN magasins mg ON mg.id_magasin = t.id_magasin_destination
               LEFT JOIN produits p ON p.id_produit = t.id_produit_destination
              WHERE (e.id_utilisateur_proprietaire = ? OR t.id_utilisateur_destination = ?)${filtre}
              ORDER BY (t.statut = 'en_attente') DESC, t.date_creation DESC, t.id_transfert DESC
              LIMIT 1000`,
            params
        );
        return rows.map((r) => {
            const t = this._cast(r);
            t.est_proprietaire = Number(t.est_proprietaire) === 1;
            return t;
        });
    }

    /** Demandes en attente : pour le propriétaire toutes, pour un membre les siennes */
    static async countEnAttente(id_entrepot, id_utilisateur) {
        const est_proprietaire = await this.estProprietaire(id_entrepot, id_utilisateur);
        const params = [id_entrepot];
        let filtre = '';
        if (!est_proprietaire) {
            filtre = ' AND id_utilisateur_destination = ?';
            params.push(id_utilisateur);
        }
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS total FROM transferts_stock
              WHERE id_entrepot_source = ? AND statut = 'en_attente'${filtre}`,
            params
        );
        return { est_proprietaire, count: parseInt(rows[0]?.total, 10) || 0 };
    }

    /**
     * Produits du catalogue du DEMANDEUR susceptibles de recevoir le stock
     * (recherche par nom ; sans `q`, premier mot significatif du produit d'entrepôt).
     */
    static async getProduitsMagasin(id_entrepot, id_utilisateur, id_produit_entrepot, q = '') {
        const src = id_produit_entrepot
            ? await this._produitEntrepot(pool, id_produit_entrepot, id_entrepot)
            : null;

        let terme = String(q || '').trim();
        if (!terme && src) {
            const mots = String(src.nom).trim().split(/\s+/);
            terme = (mots.find((m) => m.length >= 3) || mots[0] || '').trim();
        }
        const like = `%${terme.replace(/[%_\\]/g, '\\$&')}%`;

        const [produits] = await pool.execute(
            `SELECT p.id_produit, p.nom, p.quantite_stock,
                    ma.nom AS marque_nom, mo.nom AS modele_nom,
                    un.nom AS unite_nom, un.symbole AS unite_symbole
               FROM produits p
               LEFT JOIN marques ma ON ma.id_marque = p.id_marque
               LEFT JOIN modeles mo ON mo.id_modele = p.id_modele
               LEFT JOIN unites un  ON un.id_unite  = p.id_unite
              WHERE p.id_utilisateur = ? AND p.nom LIKE ?
              ORDER BY p.nom ASC
              LIMIT 20`,
            [id_utilisateur, like]
        );

        return {
            terme,
            produit_source: src ? { nom: src.nom, unite_nom: src.unite_nom } : null,
            auto: src ? await this._destinationAuto(pool, src, id_utilisateur) : null,
            produits: produits.map((p) => ({ ...p, quantite_stock: parseFloat(p.quantite_stock) || 0 })),
        };
    }
}

export default TransfertStock;