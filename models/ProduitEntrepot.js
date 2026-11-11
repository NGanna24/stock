// models/ProduitEntrepot.js
//
// Catalogue de l'ENTREPÔT : totalement indépendant des produits du magasin.
// Tables : produits_entrepot + unites_vente_entrepot.
// Le seul pont avec le magasin est le transfert (transferts_stock).
import { pool } from '../config/db.js';
import MouvementEntrepot from './MouvementEntrepot.js';

class ProduitEntrepot {
    /* ============================================================
       HELPER — parse un tableau d'unités de vente
       (exposé au frontend sous le nom `id_unite_vente`)
       ============================================================ */
    static _buildUnites(unitesRows) {
        if (!Array.isArray(unitesRows)) return [];
        return unitesRows
            .filter((u) => u && u.id_unite_vente_entrepot)
            .map((u) => ({
                id_unite_vente: u.id_unite_vente_entrepot,
                nom: u.nom,
                quantite_base: parseFloat(u.quantite_base) || 1,
                prix_vente: parseFloat(u.prix_vente) || 0,
                prix_achat: parseFloat(u.prix_achat) || 0,
                est_principal: u.est_principal === 1 || u.est_principal === true,
            }));
    }

    /* ============================================================
       HELPER — casts numériques pour un JSON propre
       ============================================================ */
    static _castNumeriques(p) {
        p.prix_achat        = parseFloat(p.prix_achat)        || 0;
        p.prix_vente        = parseFloat(p.prix_vente)        || 0;
        p.quantite_stock    = parseFloat(p.quantite_stock)    || 0;
        p.quantite_minimale = parseFloat(p.quantite_minimale) || 0;
        p.quantite_maximale = parseFloat(p.quantite_maximale) || 0;
        return p;
    }

    /* ============================================================
       FIND BY ID — produit + unités de vente (avec IDs)
       ============================================================ */
    static async findById(id_produit_entrepot) {
        const connection = await pool.getConnection();
        try {
            // 1) Produit principal (avec libellés joints)
            const [produitRows] = await connection.execute(
                `SELECT
                    pe.id_produit_entrepot,
                    pe.id_entrepot,
                    pe.id_utilisateur,
                    pe.nom,
                    pe.description,
                    pe.id_categorie,
                    pe.id_marque,
                    pe.id_modele,
                    pe.id_unite,
                    pe.id_fournisseur,
                    pe.prix_achat,
                    pe.prix_vente,
                    pe.quantite_stock,
                    pe.quantite_minimale,
                    pe.quantite_maximale,
                    pe.emplacement,
                    pe.rayon,
                    pe.etagere,
                    pe.id_emplacement,
                    pe.actif,
                    pe.date_creation,
                    pe.date_modification,
                    c.nom  AS categorie_nom,
                    m.nom  AS marque_nom,
                    mo.nom AS modele_nom,
                    f.nom  AS fournisseur_nom,
                    u.nom  AS unite_nom,
                    u.symbole AS unite_symbole
                 FROM produits_entrepot pe
                 LEFT JOIN categories c   ON c.id_categorie   = pe.id_categorie
                 LEFT JOIN marques m      ON m.id_marque      = pe.id_marque
                 LEFT JOIN modeles mo     ON mo.id_modele     = pe.id_modele
                 LEFT JOIN fournisseurs f ON f.id_fournisseur = pe.id_fournisseur
                 LEFT JOIN unites u       ON u.id_unite       = pe.id_unite
                 WHERE pe.id_produit_entrepot = ?
                 LIMIT 1`,
                [id_produit_entrepot]
            );

            if (produitRows.length === 0) return null;
            const produit = produitRows[0];

            // 2) Unités de vente actives
            const [unitesRows] = await connection.execute(
                `SELECT id_unite_vente_entrepot, nom, quantite_base,
                        prix_vente, prix_achat, est_principal
                   FROM unites_vente_entrepot
                  WHERE id_produit_entrepot = ?
                    AND actif = 1
                  ORDER BY est_principal DESC, id_unite_vente_entrepot ASC`,
                [id_produit_entrepot]
            );
            produit.unites_vente = this._buildUnites(unitesRows);

            return this._castNumeriques(produit);
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       FIND DUPLICATE — détecte un doublon scopé entrepôt
       (nom + marque + modèle, produit actif uniquement)
       ============================================================ */
    static async findDuplicate({ id_entrepot, nom, id_marque = null, id_modele = null, excludeId = null }) {
        const connection = await pool.getConnection();
        try {
            const params = [id_entrepot, nom, id_marque, id_modele];
            let sql = `
                SELECT id_produit_entrepot, nom
                  FROM produits_entrepot
                 WHERE id_entrepot = ?
                   AND LOWER(TRIM(nom)) = LOWER(TRIM(?))
                   AND id_marque <=> ?
                   AND id_modele <=> ?
                   AND actif = 1`;
            if (excludeId) {
                sql += ` AND id_produit_entrepot <> ?`;
                params.push(excludeId);
            }
            sql += ` LIMIT 1`;

            const [rows] = await connection.execute(sql, params);
            return rows.length > 0 ? rows[0] : null;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       GET ALL — liste les produits actifs d'un entrepôt (avec unités)
       ============================================================ */
    static async getAll(id_entrepot) {
        const connection = await pool.getConnection();
        try {
            // 1) Produits
            const [produitRows] = await connection.execute(
                `SELECT
                    pe.id_produit_entrepot,
                    pe.id_entrepot,
                    pe.id_utilisateur,
                    pe.nom,
                    pe.description,
                    pe.id_categorie,
                    pe.id_marque,
                    pe.id_modele,
                    pe.id_unite,
                    pe.id_fournisseur,
                    pe.prix_achat,
                    pe.prix_vente,
                    pe.quantite_stock,
                    pe.quantite_minimale,
                    pe.quantite_maximale,
                    pe.emplacement,
                    pe.rayon,
                    pe.etagere,
                    pe.id_emplacement,
                    pe.actif,
                    pe.date_creation,
                    c.nom  AS categorie_nom,
                    m.nom  AS marque_nom,
                    mo.nom AS modele_nom,
                    f.nom  AS fournisseur_nom,
                    u.nom  AS unite_nom,
                    u.symbole AS unite_symbole
                 FROM produits_entrepot pe
                 LEFT JOIN categories c   ON c.id_categorie   = pe.id_categorie
                 LEFT JOIN marques m      ON m.id_marque      = pe.id_marque
                 LEFT JOIN modeles mo     ON mo.id_modele     = pe.id_modele
                 LEFT JOIN fournisseurs f ON f.id_fournisseur = pe.id_fournisseur
                 LEFT JOIN unites u       ON u.id_unite       = pe.id_unite
                 WHERE pe.id_entrepot = ?
                   AND pe.actif = 1
                 ORDER BY pe.date_creation DESC, pe.id_produit_entrepot DESC`,
                [id_entrepot]
            );

            if (produitRows.length === 0) return [];

            // 2) Toutes les unités de vente en une seule requête
            const ids = produitRows.map((p) => p.id_produit_entrepot);
            const placeholders = ids.map(() => '?').join(',');
            const [unitesRows] = await connection.execute(
                `SELECT id_produit_entrepot, id_unite_vente_entrepot, nom,
                        quantite_base, prix_vente, prix_achat, est_principal
                   FROM unites_vente_entrepot
                  WHERE id_produit_entrepot IN (${placeholders})
                    AND actif = 1
                  ORDER BY est_principal DESC, id_unite_vente_entrepot ASC`,
                ids
            );

            // 3) Regroupement
            const unitesParProduit = new Map();
            for (const u of unitesRows) {
                if (!unitesParProduit.has(u.id_produit_entrepot)) {
                    unitesParProduit.set(u.id_produit_entrepot, []);
                }
                unitesParProduit.get(u.id_produit_entrepot).push(u);
            }

            return produitRows.map((p) => {
                p.unites_vente = this._buildUnites(unitesParProduit.get(p.id_produit_entrepot) || []);
                return this._castNumeriques(p);
            });
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       CREATE — produit entrepôt + unités de vente
       (transaction unique, vérif doublon incluse)
       ============================================================ */
    static async create({
        id_entrepot,
        id_utilisateur,
        nom,
        description = null,
        id_categorie = null,
        id_marque = null,
        id_modele = null,
        id_unite = null,
        id_fournisseur = null,
        prix_achat = 0,
        prix_vente = 0,
        quantite_stock = 0,
        quantite_minimale = 0,
        quantite_maximale = 0,
        emplacement = null,
        rayon = null,
        etagere = null,
        id_emplacement = null,
        unites_vente = [],
    }) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1) Anti-doublon scopé entrepôt (produits actifs uniquement)
            const [dup] = await connection.execute(
                `SELECT id_produit_entrepot
                   FROM produits_entrepot
                  WHERE id_entrepot = ?
                    AND LOWER(TRIM(nom)) = LOWER(TRIM(?))
                    AND id_marque <=> ?
                    AND id_modele <=> ?
                    AND actif = 1
                  LIMIT 1`,
                [id_entrepot, nom, id_marque || null, id_modele || null]
            );
            if (dup.length > 0) {
                const err = new Error(
                    `Un produit nommé "${nom}" existe déjà dans cet entrepôt.`
                );
                err.isDuplicate = true;
                err.existingId = dup[0].id_produit_entrepot;
                throw err;
            }

            // 2) INSERT catalogue
            const [result] = await connection.execute(
                `INSERT INTO produits_entrepot
                    (id_entrepot, id_utilisateur, nom, description,
                     id_categorie, id_marque, id_modele, id_unite, id_fournisseur,
                     prix_achat, prix_vente,
                     quantite_stock, quantite_minimale, quantite_maximale,
                     emplacement, rayon, etagere, id_emplacement, actif)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
                [
                    id_entrepot, id_utilisateur, nom.trim(), description,
                    id_categorie || null, id_marque || null, id_modele || null,
                    id_unite || null, id_fournisseur || null,
                    parseFloat(prix_achat) || 0, parseFloat(prix_vente) || 0,
                    parseFloat(quantite_stock) || 0,
                    parseFloat(quantite_minimale) || 0,
                    parseFloat(quantite_maximale) || 0,
                    emplacement || null, rayon || null, etagere || null,
                    id_emplacement || null,
                ]
            );
            const id_produit_entrepot = result.insertId;

            // Journal : stock de départ = une entrée
            if ((parseFloat(quantite_stock) || 0) > 0) {
                await MouvementEntrepot.log(connection, {
                    id_entrepot, id_produit_entrepot, id_utilisateur,
                    type_mouvement: 'entree',
                    quantite: parseFloat(quantite_stock),
                    ancienne_quantite: 0,
                    nouvelle_quantite: parseFloat(quantite_stock),
                    type_reference: 'stock_initial',
                    notes: 'Stock initial à la création du produit',
                });
            }

            // 3) Unités de vente
            const unitesActives = (unites_vente || []).filter(
                (u) => u && u.nom && u.nom.trim()
            );
            for (const u of unitesActives) {
                await connection.execute(
                    `INSERT INTO unites_vente_entrepot
                        (id_produit_entrepot, nom, quantite_base,
                         prix_vente, prix_achat, est_principal, actif)
                     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                    [
                        id_produit_entrepot,
                        u.nom.trim(),
                        parseFloat(u.quantite_base) || 1,
                        parseFloat(u.prix_vente) || 0,
                        parseFloat(u.prix_achat) || 0,
                        !!u.est_principal,
                    ]
                );
            }

            await connection.commit();
            return id_produit_entrepot;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       UPDATE — produit + unités (UPSERT intelligent)
       - Update partiel : ne touche que les champs fournis
       - UPSERT des unités si `unites_vente` fourni
       - Soft delete des unités listées dans `unites_vente_deleted`
       - Le nom d'une unité n'est unique que parmi les unités ACTIVES
         (colonne générée nom_actif) : on peut donc supprimer puis recréer
         une unité du même nom sans erreur.
       ============================================================ */
    static async update(id_produit_entrepot, id_entrepot, data, id_utilisateur = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1) Vérifier l'existence (produit actif de cet entrepôt)
            const [existantRows] = await connection.execute(
                `SELECT id_produit_entrepot, nom, id_marque, id_modele, quantite_stock
                   FROM produits_entrepot
                  WHERE id_produit_entrepot = ?
                    AND id_entrepot = ?
                    AND actif = 1
                  LIMIT 1`,
                [id_produit_entrepot, id_entrepot]
            );
            if (existantRows.length === 0) {
                const err = new Error("Produit entrepôt introuvable dans cet entrepôt");
                err.statusCode = 404;
                throw err;
            }
            const actuel = existantRows[0];

            // 2) Anti-doublon (exclut le produit courant)
            //    Les champs non fournis gardent leur valeur actuelle.
            const nomNormalise = data.nom !== undefined ? String(data.nom).trim() : actuel.nom;
            const idMarque = data.id_marque !== undefined
                ? (data.id_marque ? parseInt(data.id_marque, 10) : null)
                : actuel.id_marque;
            const idModele = data.id_modele !== undefined
                ? (data.id_modele ? parseInt(data.id_modele, 10) : null)
                : actuel.id_modele;

            if (nomNormalise) {
                const [dupRows] = await connection.execute(
                    `SELECT id_produit_entrepot
                       FROM produits_entrepot
                      WHERE id_entrepot = ?
                        AND LOWER(TRIM(nom)) = LOWER(TRIM(?))
                        AND id_marque <=> ?
                        AND id_modele <=> ?
                        AND actif = 1
                        AND id_produit_entrepot <> ?
                      LIMIT 1`,
                    [id_entrepot, nomNormalise, idMarque, idModele, id_produit_entrepot]
                );
                if (dupRows.length > 0) {
                    const err = new Error(
                        `Un produit nommé "${nomNormalise}" existe déjà dans cet entrepôt.`
                    );
                    err.isDuplicate = true;
                    err.existingId = dupRows[0].id_produit_entrepot;
                    throw err;
                }
            }

            // 3) UPDATE partiel — colonnes présentes dans `data` uniquement
            const champs = [];
            const valeurs = [];
            const setIfDefined = (col, val, cast = (x) => x) => {
                if (val !== undefined) {
                    champs.push(`${col} = ?`);
                    valeurs.push(cast(val));
                }
            };

            setIfDefined("nom",               data.nom,               (v) => String(v).trim());
            setIfDefined("description",       data.description,       (v) => v || null);
            setIfDefined("id_categorie",      data.id_categorie,      (v) => v || null);
            setIfDefined("id_marque",         data.id_marque,         (v) => v || null);
            setIfDefined("id_modele",         data.id_modele,         (v) => v || null);
            setIfDefined("id_unite",          data.id_unite,          (v) => v || null);
            setIfDefined("id_fournisseur",    data.id_fournisseur,    (v) => v || null);
            setIfDefined("prix_achat",        data.prix_achat,        (v) => parseFloat(v) || 0);
            setIfDefined("prix_vente",        data.prix_vente,        (v) => parseFloat(v) || 0);
            setIfDefined("quantite_stock",    data.quantite_stock,    (v) => parseFloat(v) || 0);
            setIfDefined("quantite_minimale", data.quantite_minimale, (v) => parseFloat(v) || 0);
            setIfDefined("quantite_maximale", data.quantite_maximale, (v) => parseFloat(v) || 0);
            setIfDefined("emplacement",       data.emplacement,       (v) => v || null);
            setIfDefined("rayon",             data.rayon,             (v) => v || null);
            setIfDefined("etagere",           data.etagere,           (v) => v || null);
            setIfDefined("id_emplacement",    data.id_emplacement,    (v) => v || null);

            // Journal : correction manuelle du stock = un ajustement
            if (data.quantite_stock !== undefined && id_utilisateur) {
                const avant = parseFloat(actuel.quantite_stock) || 0;
                const apres = parseFloat(data.quantite_stock) || 0;
                if (Math.abs(apres - avant) > 0.0001) {
                    await MouvementEntrepot.log(connection, {
                        id_entrepot, id_produit_entrepot, id_utilisateur,
                        type_mouvement: 'ajustement',
                        quantite: apres - avant, ancienne_quantite: avant, nouvelle_quantite: apres,
                        type_reference: 'manuel', notes: 'Correction manuelle du stock',
                    });
                }
            }

            if (champs.length > 0) {
                valeurs.push(id_produit_entrepot, id_entrepot);
                await connection.execute(
                    `UPDATE produits_entrepot
                        SET ${champs.join(", ")}
                      WHERE id_produit_entrepot = ?
                        AND id_entrepot = ?`,
                    valeurs
                );
            }

            // 4) Unités de vente
            if (Array.isArray(data.unites_vente)) {
                // 4.a) Unités ACTIVES existantes
                const [existantesRows] = await connection.execute(
                    `SELECT id_unite_vente_entrepot, nom
                       FROM unites_vente_entrepot
                      WHERE id_produit_entrepot = ?
                        AND actif = 1`,
                    [id_produit_entrepot]
                );
                const existantesParId = new Map(
                    existantesRows.map((r) => [r.id_unite_vente_entrepot, r])
                );
                const existantesParNom = new Map(
                    existantesRows.map((r) => [String(r.nom).trim().toLowerCase(), r])
                );

                const idsTraites = new Set();

                for (const u of data.unites_vente) {
                    const nomClean = (u.nom || "").trim();
                    if (!nomClean) continue;
                    const idUV = u.id_unite_vente ? parseInt(u.id_unite_vente, 10) : null;

                    if (idUV && existantesParId.has(idUV)) {
                        // UPDATE par id
                        await connection.execute(
                            `UPDATE unites_vente_entrepot
                                SET nom = ?, quantite_base = ?, prix_vente = ?,
                                    prix_achat = ?, est_principal = ?
                              WHERE id_unite_vente_entrepot = ?
                                AND id_produit_entrepot = ?`,
                            [
                                nomClean,
                                parseFloat(u.quantite_base) || 1,
                                parseFloat(u.prix_vente)   || 0,
                                parseFloat(u.prix_achat)   || 0,
                                !!u.est_principal,
                                idUV,
                                id_produit_entrepot,
                            ]
                        );
                        idsTraites.add(idUV);
                    } else {
                        const cle = nomClean.toLowerCase();
                        if (existantesParNom.has(cle)) {
                            // UPDATE par nom (anti-doublon défensif)
                            const exist = existantesParNom.get(cle);
                            await connection.execute(
                                `UPDATE unites_vente_entrepot
                                    SET quantite_base = ?, prix_vente = ?,
                                        prix_achat = ?, est_principal = ?
                                  WHERE id_unite_vente_entrepot = ?`,
                                [
                                    parseFloat(u.quantite_base) || 1,
                                    parseFloat(u.prix_vente)   || 0,
                                    parseFloat(u.prix_achat)   || 0,
                                    !!u.est_principal,
                                    exist.id_unite_vente_entrepot,
                                ]
                            );
                            idsTraites.add(exist.id_unite_vente_entrepot);
                        } else {
                            // INSERT
                            const [ins] = await connection.execute(
                                `INSERT INTO unites_vente_entrepot
                                    (id_produit_entrepot, nom, quantite_base,
                                     prix_vente, prix_achat, est_principal, actif)
                                 VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                                [
                                    id_produit_entrepot,
                                    nomClean,
                                    parseFloat(u.quantite_base) || 1,
                                    parseFloat(u.prix_vente)   || 0,
                                    parseFloat(u.prix_achat)   || 0,
                                    !!u.est_principal,
                                ]
                            );
                            idsTraites.add(ins.insertId);
                        }
                    }
                }

                // 4.b) Soft delete des unités retirées
                //      (exécuté APRÈS l'upsert : une unité retirée puis recréée
                //       sous le même nom est déjà gérée plus haut)
                const idsDeleted = Array.isArray(data.unites_vente_deleted)
                    ? data.unites_vente_deleted.map((v) => parseInt(v, 10)).filter(Boolean)
                    : [];
                for (const idDel of idsDeleted) {
                    if (idsTraites.has(idDel)) continue;
                    await connection.execute(
                        `UPDATE unites_vente_entrepot
                            SET actif = 0
                          WHERE id_unite_vente_entrepot = ?
                            AND id_produit_entrepot = ?`,
                        [idDel, id_produit_entrepot]
                    );
                }
            }

            await connection.commit();
            return id_produit_entrepot;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       UPDATE STOCK — mise à jour rapide du stock (PATCH)
       ============================================================ */
    static async updateStock(id_produit_entrepot, id_entrepot, quantite, id_utilisateur = null) {
        const connection = await pool.getConnection();
        try {
            const [avantRows] = await connection.execute(
                `SELECT quantite_stock FROM produits_entrepot
                  WHERE id_produit_entrepot = ? AND id_entrepot = ? AND actif = 1`,
                [id_produit_entrepot, id_entrepot]
            );
            const [result] = await connection.execute(
                `UPDATE produits_entrepot
                    SET quantite_stock = ?
                  WHERE id_produit_entrepot = ?
                    AND id_entrepot = ?
                    AND actif = 1`,
                [parseFloat(quantite) || 0, id_produit_entrepot, id_entrepot]
            );
            if (result.affectedRows === 0) {
                const err = new Error("Produit entrepôt introuvable");
                err.statusCode = 404;
                throw err;
            }
            const avant = parseFloat(avantRows[0]?.quantite_stock) || 0;
            const apres = parseFloat(quantite) || 0;
            if (id_utilisateur && Math.abs(apres - avant) > 0.0001) {
                await MouvementEntrepot.log(connection, {
                    id_entrepot, id_produit_entrepot, id_utilisateur,
                    type_mouvement: 'ajustement',
                    quantite: apres - avant, ancienne_quantite: avant, nouvelle_quantite: apres,
                    type_reference: 'manuel', notes: 'Correction manuelle du stock',
                });
            }
            return true;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       DELETE — soft delete produit + unités
       ============================================================ */
    static async delete(id_produit_entrepot, id_entrepot) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1) Soft delete du produit
            const [result] = await connection.execute(
                `UPDATE produits_entrepot
                    SET actif = 0
                  WHERE id_produit_entrepot = ?
                    AND id_entrepot = ?
                    AND actif = 1`,
                [id_produit_entrepot, id_entrepot]
            );
            if (result.affectedRows === 0) {
                const err = new Error("Produit entrepôt introuvable ou déjà supprimé");
                err.statusCode = 404;
                throw err;
            }

            // 2) Soft delete des unités
            await connection.execute(
                `UPDATE unites_vente_entrepot
                    SET actif = 0
                  WHERE id_produit_entrepot = ?`,
                [id_produit_entrepot]
            );

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       STATS — statistiques d'un entrepôt
       ============================================================ */
    static async getStats(id_entrepot) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN quantite_stock <= 0 THEN 1 ELSE 0 END) AS rupture,
                    SUM(CASE WHEN quantite_stock > 0
                              AND quantite_stock <= quantite_minimale
                              AND quantite_minimale > 0 THEN 1 ELSE 0 END) AS stock_bas,
                    SUM(quantite_stock * prix_achat) AS valeur_totale
                  FROM produits_entrepot
                  WHERE id_entrepot = ?
                    AND actif = 1`,
                [id_entrepot]
            );
            const r = rows[0] || {};
            return {
                total: parseInt(r.total) || 0,
                rupture: parseInt(r.rupture) || 0,
                stock_bas: parseInt(r.stock_bas) || 0,
                valeur_totale: parseFloat(r.valeur_totale) || 0,
            };
        } finally {
            connection.release();
        }
    }
}

export default ProduitEntrepot;