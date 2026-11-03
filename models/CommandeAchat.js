// models/CommandeAchat.js
//
// Commandes d'achat. Une commande a une DESTINATION :
//   - 'magasin'  : lignes = produits du catalogue du magasin (produits)
//   - 'entrepot' : lignes = produits de l'entrepôt (produits_entrepot),
//                  réservé au PROPRIÉTAIRE de l'entrepôt.
// Les commandes restent rattachées au compte (id_utilisateur = workspace).
import { pool } from '../config/db.js';
import { prochainNumero, prefixeDuMois } from '../utils/numerotation.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

class CommandeAchat {
    /* ============================================================
       HELPERS : destination / propriétaire
       ============================================================ */

    /** Normalise le « scope » (magasin par défaut) */
    static scope(destination, id_entrepot) {
        if (destination === 'entrepot') {
            return { destination: 'entrepot', id_entrepot: parseInt(id_entrepot, 10) || null };
        }
        return { destination: 'magasin', id_entrepot: null };
    }

    /** Fragment SQL + paramètres pour filtrer sur la destination (alias de table : ca) */
    static _scopeSql(scope, alias = 'ca') {
        const s = this.scope(scope?.destination, scope?.id_entrepot);
        if (s.destination === 'entrepot') {
            return { sql: ` AND ${alias}.destination = 'entrepot' AND ${alias}.id_entrepot = ?`, params: [s.id_entrepot] };
        }
        return { sql: ` AND ${alias}.destination = 'magasin'`, params: [] };
    }

    /** Le compte est-il propriétaire (actif) de cet entrepôt ? */
    static async estProprietaireEntrepot(id_entrepot, id_utilisateur, db = pool) {
        if (!id_entrepot || !id_utilisateur) return false;
        const [rows] = await db.execute(
            `SELECT 1 FROM entrepots
              WHERE id_entrepot = ? AND id_utilisateur_proprietaire = ? AND actif = 1`,
            [id_entrepot, id_utilisateur]
        );
        return rows.length > 0;
    }

    /** Entrepôts dont le compte est propriétaire (= ceux pour lesquels il peut commander) */
    static async getEntrepotsProprietaire(id_utilisateur) {
        const [rows] = await pool.execute(
            `SELECT id_entrepot, nom, ville
               FROM entrepots
              WHERE id_utilisateur_proprietaire = ? AND actif = 1
              ORDER BY id_entrepot ASC`,
            [id_utilisateur]
        );
        // Deux entrepôts de même nom : on ajoute le numéro pour les distinguer dans les onglets
        const compte = new Map();
        rows.forEach((e) => compte.set(e.nom, (compte.get(e.nom) || 0) + 1));
        return rows.map((e) => (compte.get(e.nom) > 1 ? { ...e, nom: `${e.nom} n°${e.id_entrepot}` } : e));
    }

    /* ============================================================
       Numéro unique PAR COMPTE et PAR DESTINATION
       CA-202610-0001 (magasin)  /  CAE-202610-0001 (entrepôt)
       ============================================================ */
    static async genererNumero(id_utilisateur, destination = 'magasin', db = pool) {
        const code = destination === 'entrepot' ? 'CAE' : 'CA';
        return prochainNumero({ table: 'commandes_achat', prefixe: prefixeDuMois(code), id_utilisateur, db });
    }

    /* ============================================================
       INSERTION D'UNE LIGNE (magasin OU entrepôt)
       Retourne le montant de la ligne (0 si prix inconnu).
       ctx = { id_commande_achat, id_utilisateur, destination, id_entrepot }
       ============================================================ */
    static async _insertLigne(connection, ctx, ligne) {
        const {
            id_produit,
            id_produit_entrepot,
            id_unite_vente = null,
            nom_unite_vente = 'Unité',
            quantite_base = 1,
            quantite,
            prix_achat = null,
            remise = 0
        } = ligne;

        const estEntrepot = ctx.destination === 'entrepot';

        if (!quantite || parseFloat(quantite) <= 0) {
            throw fail(`La quantité doit être positive`);
        }

        // --- Prix d'achat : null si non fourni ou <= 0 ---
        let prixAchatFinal = null;
        if (prix_achat !== null && prix_achat !== undefined && prix_achat !== '') {
            const parsed = parseFloat(prix_achat);
            if (!isNaN(parsed) && parsed > 0) prixAchatFinal = parsed;
        }

        let qteBase = parseFloat(quantite_base) || 1;
        let nomUnite = nom_unite_vente || 'Unité';

        if (estEntrepot) {
            // ---------- ENTREPÔT ----------
            if (!id_produit_entrepot && id_produit) {
                // Produit du catalogue du MAGASIN pas encore présent à l'entrepôt :
                // il sera créé (ou retrouvé) à l'entrepôt au moment de la réception.
                const [pm] = await connection.execute(
                    `SELECT id_produit FROM produits WHERE id_produit = ? AND id_utilisateur = ?`,
                    [id_produit, ctx.id_utilisateur]
                );
                if (pm.length === 0) throw fail(`Produit ID ${id_produit} non trouvé`, 404);

                if (id_unite_vente) {
                    const [um] = await connection.execute(
                        `SELECT nom, quantite_base FROM unites_vente WHERE id_unite_vente = ? AND id_produit = ?`,
                        [id_unite_vente, id_produit]
                    );
                    if (um.length > 0) {
                        qteBase = parseFloat(um[0].quantite_base) || 1;
                        nomUnite = um[0].nom || nomUnite;
                    }
                }

                await connection.execute(
                    `INSERT INTO ligne_commande_achat (
                        id_commande_achat, id_produit, id_produit_entrepot,
                        id_unite_vente, id_unite_vente_entrepot, nom_unite_vente, quantite_base,
                        quantite, prix_achat, remise
                    ) VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
                    [ctx.id_commande_achat, id_produit, id_unite_vente || null, nomUnite, qteBase,
                     quantite, prixAchatFinal, remise]
                );
                return quantite * (prixAchatFinal || 0) * (1 - (parseFloat(remise) || 0) / 100);
            }
            if (!id_produit_entrepot) throw fail('Produit de l\'entrepôt manquant sur une ligne');

            const [pe] = await connection.execute(
                `SELECT id_produit_entrepot FROM produits_entrepot
                  WHERE id_produit_entrepot = ? AND id_entrepot = ? AND actif = 1`,
                [id_produit_entrepot, ctx.id_entrepot]
            );
            if (pe.length === 0) {
                throw fail(`Produit entrepôt ID ${id_produit_entrepot} non trouvé dans cet entrepôt`, 404);
            }

            if (id_unite_vente) {
                const [uve] = await connection.execute(
                    `SELECT nom, quantite_base FROM unites_vente_entrepot
                      WHERE id_unite_vente_entrepot = ? AND id_produit_entrepot = ?`,
                    [id_unite_vente, id_produit_entrepot]
                );
                if (uve.length === 0) {
                    throw fail(`Unité de vente ID ${id_unite_vente} non trouvée pour ce produit`, 404);
                }
                qteBase = parseFloat(uve[0].quantite_base) || 1;
                nomUnite = uve[0].nom || nomUnite;
            }

            await connection.execute(
                `INSERT INTO ligne_commande_achat (
                    id_commande_achat, id_produit, id_produit_entrepot,
                    id_unite_vente, id_unite_vente_entrepot, nom_unite_vente, quantite_base,
                    quantite, prix_achat, remise
                ) VALUES (?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)`,
                [
                    ctx.id_commande_achat,
                    id_produit_entrepot,
                    id_unite_vente || null,
                    nomUnite,
                    qteBase,
                    quantite,
                    prixAchatFinal,
                    remise
                ]
            );
        } else {
            // ---------- MAGASIN (comportement d'origine) ----------
            if (!id_produit) throw fail('Produit manquant sur une ligne');

            const [produitRows] = await connection.execute(
                `SELECT id_produit FROM produits
                 WHERE id_produit = ? AND id_utilisateur = ?`,
                [id_produit, ctx.id_utilisateur]
            );
            if (produitRows.length === 0) {
                throw fail(`Produit ID ${id_produit} non trouvé`, 404);
            }

            if (id_unite_vente) {
                const [uniteRows] = await connection.execute(
                    `SELECT quantite_base FROM unites_vente
                     WHERE id_unite_vente = ? AND id_produit = ?`,
                    [id_unite_vente, id_produit]
                );
                if (uniteRows.length > 0) {
                    qteBase = parseFloat(uniteRows[0].quantite_base) || 1;
                }
            }

            await connection.execute(
                `INSERT INTO ligne_commande_achat (
                    id_commande_achat, id_produit,
                    id_unite_vente, nom_unite_vente, quantite_base,
                    quantite, prix_achat, remise
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    ctx.id_commande_achat,
                    id_produit,
                    id_unite_vente || null,
                    nomUnite,
                    qteBase,
                    quantite,
                    prixAchatFinal,
                    remise
                ]
            );
        }

        return prixAchatFinal !== null
            ? parseFloat(quantite) * prixAchatFinal * (1 - remise / 100)
            : 0;
    }

    /* ============================================================
       CRÉER une commande d'achat
       ------------------------------------------------------------
       - Le prix d'achat est OPTIONNEL (renseigné plus tard, à la réception)
       - destination 'entrepot' => id_entrepot obligatoire + propriétaire
       ============================================================ */
    static async create(data) {
        const connection = await pool.getConnection();
        let connexionRendue = false;
        try {
            await connection.beginTransaction();

            const {
                id_fournisseur,
                date_commande,
                notes,
                id_utilisateur,
                lignes = []
            } = data;
            const { destination, id_entrepot } = this.scope(data.destination, data.id_entrepot);

            if (!id_utilisateur) throw new Error('id_utilisateur requis');
            if (!date_commande) throw fail('La date de commande est obligatoire');
            if (lignes.length === 0) throw fail('Au moins un produit est requis');

            if (destination === 'entrepot') {
                if (!id_entrepot) throw fail("L'entrepôt de livraison est obligatoire");
                if (!(await this.estProprietaireEntrepot(id_entrepot, id_utilisateur, connection))) {
                    throw fail("Seul le propriétaire de l'entrepôt peut commander pour cet entrepôt", 403);
                }
            }

            const numero_commande = await this.genererNumero(id_utilisateur, destination, connection);

            // 1. En-tête (montant_total = 0 tant qu'aucun prix n'est connu)
            const [result] = await connection.execute(
                `INSERT INTO commandes_achat (
                    id_utilisateur, numero_commande, date_commande,
                    id_fournisseur, destination, id_entrepot,
                    statut, montant_total, notes
                ) VALUES (?, ?, ?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur,
                    numero_commande,
                    date_commande,
                    id_fournisseur,
                    destination,
                    id_entrepot,
                    notes || null
                ]
            );

            const id_commande_achat = result.insertId;
            const ctx = { id_commande_achat, id_utilisateur, destination, id_entrepot };

            // 2. Lignes
            let montant_total = 0;
            for (const ligne of lignes) {
                montant_total += await this._insertLigne(connection, ctx, ligne);
            }

            // 3. Montant total
            await connection.execute(
                `UPDATE commandes_achat SET montant_total = ? WHERE id_commande_achat = ?`,
                [montant_total, id_commande_achat]
            );

            await connection.commit();
            connection.release(); // rendue au pool AVANT la relecture (sinon blocage quand le pool est plein)
            connexionRendue = true;
            return await this.findById(id_commande_achat, id_utilisateur);

        } catch (error) {
            if (!connexionRendue) await connection.rollback();
            throw error;
        } finally {
            if (!connexionRendue) connection.release();
        }
    }

    /* ============================================================
       Récupérer une commande par ID avec ses lignes
       + quantités déjà reçues et reste à recevoir par ligne
       ============================================================ */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            // 1. En-tête
            const [rows] = await pool.execute(
                `SELECT ca.*,
                        f.nom as fournisseur_nom,
                        f.telephone as fournisseur_telephone,
                        f.email as fournisseur_email,
                        f.ville as fournisseur_ville,
                        f.pays as fournisseur_pays,
                        u.fullname as utilisateur_nom,
                        e.nom as entrepot_nom,
                        e.ville as entrepot_ville
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur
                 LEFT JOIN entrepots e ON ca.id_entrepot = e.id_entrepot
                 WHERE ca.id_commande_achat = ?
                   AND ca.id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const commande = rows[0];

            // 2. Lignes (produit magasin OU produit entrepôt) + quantités déjà reçues
            const [lignes] = await pool.execute(
                `SELECT lca.*,
                        COALESCE(p.nom, pe.nom) AS produit_nom,
                        COALESCE(p.id_marque, pe.id_marque) AS id_marque,
                        m.nom as marque_nom,
                        COALESCE(p.id_modele, pe.id_modele) AS id_modele,
                        md.nom as modele_nom,
                        COALESCE(p.id_unite, pe.id_unite) AS id_unite,
                        u.symbole as unite_symbole,
                        u.nom as unite_nom,
                        COALESCE(uv.nom, uve.nom) as unite_vente_nom,
                        COALESCE(uv.quantite_base, uve.quantite_base) as unite_vente_quantite_base,

                        -- Quantité déjà reçue (en unité de base)
                        COALESCE((
                            SELECT SUM(rl.quantite_totale_base)
                            FROM reception_lignes rl
                            INNER JOIN receptions r
                                ON rl.id_reception = r.id_reception
                            WHERE rl.id_ligne_achat = lca.id_ligne_achat
                              AND r.statut != 'annulee'
                              AND r.id_utilisateur = ?
                        ), 0) AS quantite_deja_recue_base

                 FROM ligne_commande_achat lca
                 LEFT JOIN produits p ON lca.id_produit = p.id_produit
                 LEFT JOIN produits_entrepot pe ON lca.id_produit_entrepot = pe.id_produit_entrepot
                 LEFT JOIN marques m ON m.id_marque = COALESCE(p.id_marque, pe.id_marque)
                 LEFT JOIN modeles md ON md.id_modele = COALESCE(p.id_modele, pe.id_modele)
                 LEFT JOIN unites u ON u.id_unite = COALESCE(p.id_unite, pe.id_unite)
                 LEFT JOIN unites_vente uv ON lca.id_unite_vente = uv.id_unite_vente
                 LEFT JOIN unites_vente_entrepot uve ON lca.id_unite_vente_entrepot = uve.id_unite_vente_entrepot
                 WHERE lca.id_commande_achat = ?`,
                [id_utilisateur, id]
            );

            // 3. Enrichissement : reste à recevoir + types
            commande.lignes = lignes.map(l => {
                const qteBase = parseFloat(l.quantite_base) || 1;
                const qteTotaleBase = parseFloat(l.quantite_totale_base)
                    || (parseFloat(l.quantite) * qteBase);
                const dejaRecueBase = parseFloat(l.quantite_deja_recue_base) || 0;

                const resteBase = Math.max(0, qteTotaleBase - dejaRecueBase);

                const dejaRecueUV = qteBase > 0 ? dejaRecueBase / qteBase : 0;
                const resteUV = qteBase > 0 ? resteBase / qteBase : 0;

                const estLigneEntrepot = !!l.id_produit_entrepot;

                return {
                    ...l,
                    // Pour une ligne d'entrepôt, id_unite_vente = unité d'entrepôt
                    // (le front n'a ainsi qu'un seul champ à gérer)
                    id_unite_vente: estLigneEntrepot
                        ? (l.id_unite_vente_entrepot || null)
                        : (l.id_unite_vente || null),
                    nom_unite_vente: l.nom_unite_vente || l.unite_vente_nom || 'Unité',
                    quantite_base: qteBase,
                    quantite_totale_base: qteTotaleBase,
                    prix_achat: l.prix_achat !== null ? parseFloat(l.prix_achat) : null,
                    montant_total: l.montant_total !== null ? parseFloat(l.montant_total) : null,

                    quantite_deja_recue_base: dejaRecueBase,
                    reste_a_recevoir_base: resteBase,
                    quantite_deja_recue: Math.round(dejaRecueUV * 100) / 100,
                    reste_a_recevoir: Math.round(resteUV * 100) / 100,
                    est_totalement_recue: resteBase <= 0
                };
            });

            // 4. Résumé global
            const totalCommandeeBase = commande.lignes.reduce(
                (sum, l) => sum + (parseFloat(l.quantite_totale_base) || 0), 0
            );
            const totalRecueBase = commande.lignes.reduce(
                (sum, l) => sum + (parseFloat(l.quantite_deja_recue_base) || 0), 0
            );
            const resteTotalBase = Math.max(0, totalCommandeeBase - totalRecueBase);

            commande.resume_reception = {
                total_commandee_base: totalCommandeeBase,
                total_recue_base: totalRecueBase,
                reste_total_base: resteTotalBase,
                pourcentage_recu: totalCommandeeBase > 0
                    ? Math.round((totalRecueBase / totalCommandeeBase) * 100)
                    : 0,
                est_complete: resteTotalBase <= 0 && totalCommandeeBase > 0
            };

            return commande;

        } catch (error) {
            console.error('❌ Error finding commande by ID:', error);
            throw error;
        }
    }

    /* ============================================================
       Toutes les commandes (filtres + destination)
       filters.destination = 'magasin' (défaut) | 'entrepot' (+ filters.id_entrepot)
       ============================================================ */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            const sc = this._scopeSql(filters);
            let query = `
                SELECT ca.*,
                       f.nom as fournisseur_nom,
                       u.fullname as utilisateur_nom,
                       e.nom as entrepot_nom,
                       (SELECT COUNT(*)
                        FROM ligne_commande_achat lca
                        WHERE lca.id_commande_achat = ca.id_commande_achat) AS nb_lignes
                FROM commandes_achat ca
                LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur
                LEFT JOIN entrepots e ON ca.id_entrepot = e.id_entrepot
                WHERE ca.id_utilisateur = ?${sc.sql}
            `;
            const params = [id_utilisateur, ...sc.params];

            if (filters.numero_commande) {
                query += ' AND ca.numero_commande LIKE ?';
                params.push(`%${filters.numero_commande}%`);
            }
            if (filters.id_fournisseur) {
                query += ' AND ca.id_fournisseur = ?';
                params.push(filters.id_fournisseur);
            }
            if (filters.statut) {
                query += ' AND ca.statut = ?';
                params.push(filters.statut);
            }
            if (filters.date_debut) {
                query += ' AND ca.date_commande >= ?';
                params.push(filters.date_debut);
            }
            if (filters.date_fin) {
                query += ' AND ca.date_commande <= ?';
                params.push(filters.date_fin);
            }
            if (filters.montant_min) {
                query += ' AND ca.montant_total >= ?';
                params.push(filters.montant_min);
            }
            if (filters.montant_max) {
                query += ' AND ca.montant_total <= ?';
                params.push(filters.montant_max);
            }
            if (filters.search) {
                query += ` AND (ca.numero_commande LIKE ?
                            OR f.nom LIKE ?
                            OR ca.notes LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s);
            }

            query += ' ORDER BY ca.date_commande DESC, ca.id_commande_achat DESC';

            if (filters.limit !== undefined && filters.limit !== null) {
                const limit = parseInt(filters.limit);
                if (!isNaN(limit) && limit > 0) {
                    query += ` LIMIT ${Math.min(limit, 500)}`;
                }
            }
            if (filters.offset !== undefined && filters.offset !== null) {
                const offset = parseInt(filters.offset);
                if (!isNaN(offset) && offset >= 0) {
                    query += ` OFFSET ${offset}`;
                }
            }

            const [rows] = await pool.query(query, params);
            return rows;

        } catch (error) {
            console.error('❌ Error finding commandes:', error);
            throw error;
        }
    }

    /* ============================================================
       Par statut (utilisé par la page Réceptions)
       ============================================================ */
    static async findByStatut(statut, id_utilisateur, scope = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        try {
            const sc = this._scopeSql(scope);
            const [rows] = await pool.execute(
                `SELECT ca.*, f.nom as fournisseur_nom, e.nom as entrepot_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 LEFT JOIN entrepots e ON ca.id_entrepot = e.id_entrepot
                 WHERE ca.statut = ?
                   AND ca.id_utilisateur = ?${sc.sql}
                 ORDER BY ca.date_commande DESC`,
                [statut, id_utilisateur, ...sc.params]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by statut:', error);
            throw error;
        }
    }

    /* ============================================================
       Commandes d'un fournisseur
       ============================================================ */
    static async findByFournisseur(id_fournisseur, id_utilisateur, scope = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByFournisseur');
        }

        try {
            const sc = this._scopeSql(scope);
            const [rows] = await pool.execute(
                `SELECT ca.*, u.fullname as utilisateur_nom
                 FROM commandes_achat ca
                 LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur
                 WHERE ca.id_fournisseur = ?
                   AND ca.id_utilisateur = ?${sc.sql}
                 ORDER BY ca.date_commande DESC`,
                [id_fournisseur, id_utilisateur, ...sc.params]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by fournisseur:', error);
            throw error;
        }
    }

    /* ============================================================
       Commandes du mois en cours
       ============================================================ */
    static async getCurrentMonth(id_utilisateur, scope = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getCurrentMonth');
        }

        try {
            const sc = this._scopeSql(scope);
            const [rows] = await pool.execute(
                `SELECT ca.*, f.nom as fournisseur_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE ca.id_utilisateur = ?${sc.sql}
                   AND MONTH(ca.date_commande) = MONTH(CURRENT_DATE())
                   AND YEAR(ca.date_commande) = YEAR(CURRENT_DATE())
                 ORDER BY ca.date_commande DESC`,
                [id_utilisateur, ...sc.params]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error getting current month:', error);
            throw error;
        }
    }

    /* ============================================================
       Statut
       ============================================================ */
    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour updateStatut');
        }

        try {
            const [result] = await pool.execute(
                `UPDATE commandes_achat
                 SET statut = ?
                 WHERE id_commande_achat = ?
                   AND id_utilisateur = ?`,
                [statut, id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating statut:', error);
            throw error;
        }
    }

    /* ============================================================
       Mettre à jour une commande complète
       (la destination d'une commande ne change jamais)
       ============================================================ */
    static async update(id, data, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const connection = await pool.getConnection();
        let connexionRendue = false;
        try {
            await connection.beginTransaction();

            const { date_commande, id_fournisseur, notes, lignes } = data;

            const [commandeRows] = await connection.execute(
                `SELECT statut, destination, id_entrepot FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (commandeRows.length === 0) throw fail('Commande non trouvée', 404);

            const { statut: statutActuel, destination, id_entrepot } = commandeRows[0];
            if (['recue', 'annulee'].includes(statutActuel)) {
                throw fail(`Impossible de modifier une commande ${statutActuel}`);
            }

            if (destination === 'entrepot'
                && !(await this.estProprietaireEntrepot(id_entrepot, id_utilisateur, connection))) {
                throw fail("Seul le propriétaire de l'entrepôt peut modifier cette commande", 403);
            }

            // En-tête
            if (date_commande || id_fournisseur || notes !== undefined) {
                const updates = [];
                const values = [];

                if (date_commande) {
                    updates.push('date_commande = ?');
                    values.push(date_commande);
                }
                if (id_fournisseur) {
                    updates.push('id_fournisseur = ?');
                    values.push(id_fournisseur);
                }
                if (notes !== undefined) {
                    updates.push('notes = ?');
                    values.push(notes || null);
                }

                if (updates.length > 0) {
                    values.push(id);
                    values.push(id_utilisateur);
                    await connection.execute(
                        `UPDATE commandes_achat
                         SET ${updates.join(', ')}
                         WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                        values
                    );
                }
            }

            // Remplacer les lignes
            if (lignes && lignes.length > 0) {
                await connection.execute(
                    'DELETE FROM ligne_commande_achat WHERE id_commande_achat = ?',
                    [id]
                );

                const ctx = { id_commande_achat: id, id_utilisateur, destination, id_entrepot };
                let montant_total = 0;
                for (const ligne of lignes) {
                    montant_total += await this._insertLigne(connection, ctx, ligne);
                }

                await connection.execute(
                    `UPDATE commandes_achat
                     SET montant_total = ?
                     WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                    [montant_total, id, id_utilisateur]
                );
            }

            await connection.commit();
            connection.release(); // rendue au pool AVANT la relecture (sinon blocage quand le pool est plein)
            connexionRendue = true;
            return await this.findById(id, id_utilisateur);

        } catch (error) {
            if (!connexionRendue) await connection.rollback();
            throw error;
        } finally {
            if (!connexionRendue) connection.release();
        }
    }

    /* ============================================================
       Ajouter des lignes à une commande existante
       ============================================================ */
    static async addLignes(id_commande_achat, lignes, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour addLignes');
        }

        const connection = await pool.getConnection();
        let connexionRendue = false;
        try {
            await connection.beginTransaction();

            const [commandeRows] = await connection.execute(
                `SELECT statut, montant_total, destination, id_entrepot FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id_commande_achat, id_utilisateur]
            );

            if (commandeRows.length === 0) throw fail('Commande non trouvée', 404);

            if (commandeRows[0].statut !== 'en_attente') {
                throw fail('Impossible d\'ajouter des produits à une commande qui n\'est pas en attente');
            }

            const { destination, id_entrepot } = commandeRows[0];
            if (destination === 'entrepot'
                && !(await this.estProprietaireEntrepot(id_entrepot, id_utilisateur, connection))) {
                throw fail("Seul le propriétaire de l'entrepôt peut modifier cette commande", 403);
            }

            let montant_total = parseFloat(commandeRows[0].montant_total) || 0;
            const ctx = { id_commande_achat, id_utilisateur, destination, id_entrepot };

            for (const ligne of lignes) {
                montant_total += await this._insertLigne(connection, ctx, ligne);
            }

            await connection.execute(
                `UPDATE commandes_achat
                 SET montant_total = ?
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [montant_total, id_commande_achat, id_utilisateur]
            );

            await connection.commit();
            connection.release(); // rendue au pool AVANT la relecture (sinon blocage quand le pool est plein)
            connexionRendue = true;
            return await this.findById(id_commande_achat, id_utilisateur);

        } catch (error) {
            if (!connexionRendue) await connection.rollback();
            throw error;
        } finally {
            if (!connexionRendue) connection.release();
        }
    }

    /* ============================================================
       Supprimer une commande (seulement si en attente)
       ============================================================ */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT statut FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) {
                throw new Error('Commande non trouvée');
            }

            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer une commande ${rows[0].statut}`);
            }

            const [result] = await pool.execute(
                `DELETE FROM commandes_achat
                 WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            return result.affectedRows > 0;

        } catch (error) {
            console.error('❌ Error deleting commande:', error);
            throw error;
        }
    }

    /* ============================================================
       Peut-on annuler ?
       ============================================================ */
    static async canAnnuler(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour canAnnuler');
        }

        const [rows] = await pool.execute(
            `SELECT statut FROM commandes_achat
             WHERE id_commande_achat = ? AND id_utilisateur = ?`,
            [id, id_utilisateur]
        );

        if (rows.length === 0) return false;
        return !['recue', 'annulee'].includes(rows[0].statut);
    }

    /* ============================================================
       Statistiques (par destination)
       ============================================================ */
    static async getStats(id_utilisateur, scope = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const sc = this._scopeSql(scope, 'commandes_achat');
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN statut = 'en_attente'         THEN 1 ELSE 0 END) as en_attente,
                    SUM(CASE WHEN statut = 'envoyee'            THEN 1 ELSE 0 END) as envoyee,
                    SUM(CASE WHEN statut = 'partiellement_recue' THEN 1 ELSE 0 END) as partiellement_recue,
                    SUM(CASE WHEN statut = 'recue'              THEN 1 ELSE 0 END) as recue,
                    SUM(CASE WHEN statut = 'annulee'            THEN 1 ELSE 0 END) as annulee,
                    COALESCE(SUM(montant_total), 0) as total_montant,
                    COALESCE(AVG(montant_total), 0) as moyenne_montant
                 FROM commandes_achat
                 WHERE id_utilisateur = ?${sc.sql}`,
                [id_utilisateur, ...sc.params]
            );

            const stats = rows[0];
            return {
                total: parseInt(stats.total) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                envoyee: parseInt(stats.envoyee) || 0,
                partiellement_recue: parseInt(stats.partiellement_recue) || 0,
                recue: parseInt(stats.recue) || 0,
                annulee: parseInt(stats.annulee) || 0,
                total_montant: parseFloat(stats.total_montant) || 0,
                moyenne_montant: parseFloat(stats.moyenne_montant) || 0
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error);
            throw error;
        }
    }
}

export default CommandeAchat;