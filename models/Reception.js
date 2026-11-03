// models/Reception.js
//
// Réceptions de marchandises. Une réception a une DESTINATION (celle de la commande) :
//   - 'magasin'  : le stock du magasin augmente (produits, entrees_stock, mouvements_stock)
//   - 'entrepot' : le stock de l'entrepôt augmente (produits_entrepot,
//                  entrees_stock_entrepot, mouvements_entrepot) — propriétaire seulement.
import { pool } from '../config/db.js';
import { prochainNumero, prefixeDuMois } from '../utils/numerotation.js';
import MouvementStock from './MouvementStock.js';
import CommandeAchat from './CommandeAchat.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

class Reception {
    /* ============================================================
       HELPER : filtre SQL sur la destination (alias de table : r)
       ============================================================ */
    static _scopeSql(scope, alias = 'r') {
        const s = CommandeAchat.scope(scope?.destination, scope?.id_entrepot);
        if (s.destination === 'entrepot') {
            return { sql: ` AND ${alias}.destination = 'entrepot' AND ${alias}.id_entrepot = ?`, params: [s.id_entrepot] };
        }
        return { sql: ` AND ${alias}.destination = 'magasin'`, params: [] };
    }

    /* ============================================================
       Numéro unique PAR COMPTE et PAR DESTINATION
       REC-202610-0001 (magasin)  /  REE-202610-0001 (entrepôt)
       ============================================================ */
    static async genererNumero(id_utilisateur, destination = 'magasin', db = pool) {
        const code = destination === 'entrepot' ? 'REE' : 'REC';
        return prochainNumero({ table: 'receptions', prefixe: prefixeDuMois(code), id_utilisateur, db });
    }

    /* ============================================================
       CRÉER une réception
         - ACCEPTE les réceptions partielles (écart > 0) et les surplus (écart < 0)
         - Recalcule côté serveur les quantités déjà reçues
         - Met à jour le stock avec la quantité RÉELLEMENT reçue
         - Recalcule le statut de la commande
         - Destination = celle de la commande (ou celle du body si réception libre)
       ============================================================ */
    /**
     * Retrouve (ou crée) dans l'entrepôt le produit correspondant à un produit du magasin.
     * Correspondance : même nom + marque + modèle (produit actif de l'entrepôt).
     * Création : stock 0 (le stock est ajouté par la réception), unités de vente copiées.
     * La ligne de commande est ensuite rattachée au produit d'entrepôt (réceptions suivantes).
     */
    static async _resoudreProduitEntrepot(connection, { id_entrepot, id_utilisateur, id_produit, id_unite_vente, id_ligne_achat }) {
        const [pr] = await connection.execute(
            `SELECT * FROM produits WHERE id_produit = ? AND id_utilisateur = ?`,
            [id_produit, id_utilisateur]
        );
        if (pr.length === 0) throw fail(`Produit ID ${id_produit} non trouvé`, 404);
        const p = pr[0];

        const [ex] = await connection.execute(
            `SELECT id_produit_entrepot FROM produits_entrepot
              WHERE id_entrepot = ? AND actif = 1
                AND LOWER(TRIM(nom)) = LOWER(TRIM(?))
                AND id_marque <=> ? AND id_modele <=> ?
              LIMIT 1 FOR UPDATE`,
            [id_entrepot, p.nom, p.id_marque ?? null, p.id_modele ?? null]
        );

        let idPE;
        if (ex.length > 0) {
            idPE = ex[0].id_produit_entrepot;
        } else {
            const [ins] = await connection.execute(
                `INSERT INTO produits_entrepot
                    (id_entrepot, id_utilisateur, nom, description,
                     id_categorie, id_marque, id_modele, id_unite, id_fournisseur,
                     prix_achat, prix_vente, quantite_stock, quantite_minimale, quantite_maximale, actif)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, TRUE)`,
                [id_entrepot, id_utilisateur, p.nom, p.description ?? null,
                 p.id_categorie ?? null, p.id_marque ?? null, p.id_modele ?? null,
                 p.id_unite ?? null, p.id_fournisseur ?? null,
                 p.prix_achat || 0, p.prix_vente || 0,
                 p.quantite_minimale || 0, p.quantite_maximale || 0]
            );
            idPE = ins.insertId;

            const [unites] = await connection.execute(
                `SELECT nom, quantite_base, prix_vente, prix_achat, est_principal
                   FROM unites_vente WHERE id_produit = ? AND actif = 1`,
                [id_produit]
            );
            for (const u of unites) {
                await connection.execute(
                    `INSERT INTO unites_vente_entrepot
                        (id_produit_entrepot, nom, quantite_base, prix_vente, prix_achat, est_principal, actif)
                     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                    [idPE, u.nom, u.quantite_base, u.prix_vente || 0, u.prix_achat || 0, u.est_principal ? 1 : 0]
                );
            }
        }

        // Unité de vente correspondante dans l'entrepôt (créée si absente)
        let idUVE = null;
        if (id_unite_vente) {
            const [um] = await connection.execute(
                `SELECT nom, quantite_base, prix_vente, prix_achat FROM unites_vente
                  WHERE id_unite_vente = ? AND id_produit = ?`,
                [id_unite_vente, id_produit]
            );
            if (um.length > 0) {
                const u = um[0];
                const [found] = await connection.execute(
                    `SELECT id_unite_vente_entrepot FROM unites_vente_entrepot
                      WHERE id_produit_entrepot = ? AND LOWER(TRIM(nom)) = LOWER(TRIM(?)) AND quantite_base = ?
                      LIMIT 1`,
                    [idPE, u.nom, u.quantite_base]
                );
                if (found.length > 0) {
                    idUVE = found[0].id_unite_vente_entrepot;
                } else {
                    const [insU] = await connection.execute(
                        `INSERT INTO unites_vente_entrepot
                            (id_produit_entrepot, nom, quantite_base, prix_vente, prix_achat, est_principal, actif)
                         VALUES (?, ?, ?, ?, ?, 0, TRUE)`,
                        [idPE, u.nom, u.quantite_base, u.prix_vente || 0, u.prix_achat || 0]
                    );
                    idUVE = insU.insertId;
                }
            }
        }

        if (id_ligne_achat) {
            await connection.execute(
                `UPDATE ligne_commande_achat
                    SET id_produit_entrepot = ?, id_unite_vente_entrepot = ?, id_produit = NULL, id_unite_vente = NULL
                  WHERE id_ligne_achat = ?`,
                [idPE, idUVE, id_ligne_achat]
            );
        }

        return { id_produit_entrepot: idPE, id_unite_vente_entrepot: idUVE };
    }

    static async create(data) {
        const {
            id_commande_achat = null,
            date_reception,
            notes = null,
            id_utilisateur,
            lignes = []
        } = data;

        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis');
        }

        const connection = await pool.getConnection();
        let connexionRendue = false;
        try {
            await connection.beginTransaction();

            // ============================================================
            // 1. VALIDATIONS DE BASE
            // ============================================================
            if (!date_reception) throw fail('La date de réception est obligatoire');
            if (!Array.isArray(lignes) || lignes.length === 0) {
                throw fail('Au moins un produit est requis pour une réception');
            }

            // ============================================================
            // 2. COMMANDE + DESTINATION
            // ============================================================
            let scope = CommandeAchat.scope(data.destination, data.id_entrepot);

            if (id_commande_achat) {
                const [commandeCheck] = await connection.execute(
                    `SELECT ca.*, f.nom AS fournisseur_nom
                     FROM commandes_achat ca
                     LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                     WHERE ca.id_commande_achat = ?
                       AND ca.id_utilisateur = ?
                     FOR UPDATE`,
                    [id_commande_achat, id_utilisateur]
                );

                if (commandeCheck.length === 0) throw fail("Commande d'achat non trouvée", 404);

                const commande = commandeCheck[0];

                if (commande.statut === 'recue') {
                    throw fail(`La commande ${commande.numero_commande} a déjà été entièrement reçue`);
                }
                if (commande.statut === 'annulee') {
                    throw fail(`La commande ${commande.numero_commande} est annulée`);
                }

                // La destination vient de la commande, jamais du client
                scope = CommandeAchat.scope(commande.destination, commande.id_entrepot);
            }

            const isEntrepot = scope.destination === 'entrepot';

            if (isEntrepot) {
                if (!scope.id_entrepot) throw fail("L'entrepôt de réception est obligatoire");
                if (!(await CommandeAchat.estProprietaireEntrepot(scope.id_entrepot, id_utilisateur, connection))) {
                    throw fail("Seul le propriétaire de l'entrepôt peut réceptionner dans cet entrepôt", 403);
                }
            }

            // ============================================================
            // 3. VÉRIFICATION DES LIGNES + CALCUL SERVEUR
            //    On ne fait pas confiance à quantite_commandee envoyé par le front :
            //    le reste à recevoir est recalculé en interrogeant la base.
            // ============================================================
            const lignesCalculees = [];

            for (const ligne of lignes) {
                let {
                    id_produit,
                    id_produit_entrepot,
                    id_ligne_achat = null,
                    id_unite_vente = null,
                    nom_unite_vente = 'Unité',
                    quantite_base = 1,
                    quantite_recue,
                    quantite_totale_base = null,
                    prix_achat_unite_vente = null,
                    prix_achat_base = null,
                    etat_marchandise = 'bon',
                    num_lot = null,
                    date_peremption = null,
                    notes_ligne = null,
                    id_emplacement = null
                } = ligne;

                let produitNom;
                let qteBase = parseFloat(quantite_base) || 1;
                let nomUnite = nom_unite_vente || 'Unité';
                let emplacementFinal = null;

                if (isEntrepot) {
                    // ---------- Produit d'ENTREPÔT ----------
                    if (!id_produit_entrepot && id_produit) {
                        // Produit du magasin absent de l'entrepôt : on le retrouve (même nom / marque /
                        // modèle) ou on le CRÉE dans l'entrepôt, avec ses unités de vente.
                        const r = await this._resoudreProduitEntrepot(connection, {
                            id_entrepot: scope.id_entrepot, id_utilisateur, id_produit, id_unite_vente, id_ligne_achat
                        });
                        id_produit_entrepot = r.id_produit_entrepot;
                        id_unite_vente = r.id_unite_vente_entrepot;
                    }
                    if (!id_produit_entrepot) throw fail("Produit de l'entrepôt manquant sur une ligne");

                    const [peRows] = await connection.execute(
                        `SELECT id_produit_entrepot, nom
                           FROM produits_entrepot
                          WHERE id_produit_entrepot = ? AND id_entrepot = ? AND actif = 1`,
                        [id_produit_entrepot, scope.id_entrepot]
                    );
                    if (peRows.length === 0) {
                        throw fail(`Produit entrepôt ID ${id_produit_entrepot} non trouvé dans cet entrepôt`, 404);
                    }
                    produitNom = peRows[0].nom;

                    if (id_unite_vente) {
                        const [uveRows] = await connection.execute(
                            `SELECT nom, quantite_base FROM unites_vente_entrepot
                              WHERE id_unite_vente_entrepot = ? AND id_produit_entrepot = ?`,
                            [id_unite_vente, id_produit_entrepot]
                        );
                        if (uveRows.length === 0) {
                            throw fail(`Unité de vente ID ${id_unite_vente} non trouvée pour "${produitNom}"`, 404);
                        }
                        qteBase = parseFloat(uveRows[0].quantite_base) || 1;
                        nomUnite = uveRows[0].nom || nomUnite;
                    }

                    if (id_emplacement) {
                        const [empRows] = await connection.execute(
                            `SELECT id_emplacement FROM emplacements
                              WHERE id_emplacement = ? AND id_entrepot = ?`,
                            [id_emplacement, scope.id_entrepot]
                        );
                        if (empRows.length === 0) throw fail("Emplacement introuvable dans cet entrepôt", 404);
                        emplacementFinal = id_emplacement;
                    }
                } else {
                    // ---------- Produit du MAGASIN ----------
                    const [produitRows] = await connection.execute(
                        `SELECT id_produit, nom, prix_achat, prix_vente, quantite_stock
                         FROM produits
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [id_produit, id_utilisateur]
                    );
                    if (produitRows.length === 0) throw fail(`Produit ID ${id_produit} non trouvé`, 404);
                    produitNom = produitRows[0].nom;

                    if (id_unite_vente) {
                        const [uvRows] = await connection.execute(
                            `SELECT quantite_base FROM unites_vente
                             WHERE id_unite_vente = ? AND id_produit = ?`,
                            [id_unite_vente, id_produit]
                        );
                        if (uvRows.length > 0) {
                            qteBase = parseFloat(uvRows[0].quantite_base) || 1;
                        }
                    }
                }

                if (!quantite_recue || parseFloat(quantite_recue) <= 0) {
                    throw fail(`La quantité reçue pour ${produitNom} doit être positive`);
                }

                // --- Quantité totale reçue (unité de base) ---
                const qteTotaleBase = quantite_totale_base !== null
                    ? parseFloat(quantite_totale_base)
                    : parseFloat(quantite_recue) * qteBase;

                // ============================================================
                // RECALCUL CÔTÉ SERVEUR : reste à recevoir AVANT cette réception
                // ============================================================
                let quantiteCommandeeUV = 0;
                let quantiteCommandeeBase = 0;
                let dejaRecueBase = 0;
                let resteAvantBase = 0;
                let ecart = 0;

                if (id_ligne_achat) {
                    const [ligneCmd] = await connection.execute(
                        `SELECT quantite, quantite_base, quantite_totale_base
                         FROM ligne_commande_achat
                         WHERE id_ligne_achat = ?
                           AND id_commande_achat = ?`,
                        [id_ligne_achat, id_commande_achat]
                    );

                    if (ligneCmd.length === 0) {
                        throw fail(`Ligne de commande ID ${id_ligne_achat} non trouvée`, 404);
                    }

                    const qteBaseLigne = parseFloat(ligneCmd[0].quantite_base) || qteBase;
                    quantiteCommandeeUV = parseFloat(ligneCmd[0].quantite) || 0;
                    quantiteCommandeeBase = parseFloat(ligneCmd[0].quantite_totale_base)
                        || (quantiteCommandeeUV * qteBaseLigne);

                    // Total déjà reçu (hors annulées)
                    const [recuRows] = await connection.execute(
                        `SELECT COALESCE(SUM(rl.quantite_totale_base), 0) AS total
                         FROM reception_lignes rl
                         INNER JOIN receptions r ON rl.id_reception = r.id_reception
                         WHERE rl.id_ligne_achat = ?
                           AND r.statut != 'annulee'
                           AND r.id_utilisateur = ?`,
                        [id_ligne_achat, id_utilisateur]
                    );

                    dejaRecueBase = parseFloat(recuRows[0].total) || 0;
                    resteAvantBase = Math.max(0, quantiteCommandeeBase - dejaRecueBase);

                    // Écart = reste AVANT - reçu MAINTENANT (>0 manquant, <0 surplus, 0 conforme)
                    ecart = (resteAvantBase - qteTotaleBase) / (qteBase || 1);

                    // quantite_commandee transcrit en unité de vente (le RESTE)
                    quantiteCommandeeUV = qteBase > 0 ? resteAvantBase / qteBase : 0;
                } else {
                    // Réception libre (sans commande) : pas de comparaison
                    quantiteCommandeeUV = parseFloat(quantite_recue) || 0;
                    quantiteCommandeeBase = qteTotaleBase;
                    dejaRecueBase = 0;
                    resteAvantBase = qteTotaleBase;
                    ecart = 0;
                }

                if (ecart < 0) {
                    console.log(
                        `⚠️ Surplus détecté pour "${produitNom}" : ` +
                        `reste avant = ${resteAvantBase} base, reçu = ${qteTotaleBase} base`
                    );
                }

                // --- Prix d'achat unité de vente ---
                let prixAchatUV = null;
                if (
                    prix_achat_unite_vente !== null &&
                    prix_achat_unite_vente !== undefined &&
                    prix_achat_unite_vente !== ''
                ) {
                    const parsed = parseFloat(prix_achat_unite_vente);
                    if (!isNaN(parsed) && parsed > 0) prixAchatUV = parsed;
                }

                // --- Prix d'achat unité de base (auto-calcul si absent) ---
                let prixAchatBase = null;
                if (
                    prix_achat_base !== null &&
                    prix_achat_base !== undefined &&
                    prix_achat_base !== ''
                ) {
                    const parsed = parseFloat(prix_achat_base);
                    if (!isNaN(parsed) && parsed > 0) prixAchatBase = parsed;
                } else if (prixAchatUV !== null && qteBase > 0) {
                    prixAchatBase = prixAchatUV / qteBase;
                }

                lignesCalculees.push({
                    id_produit: isEntrepot ? null : id_produit,
                    id_produit_entrepot: isEntrepot ? id_produit_entrepot : null,
                    id_ligne_achat,
                    id_unite_vente: isEntrepot ? null : id_unite_vente,
                    id_unite_vente_entrepot: isEntrepot ? (id_unite_vente || null) : null,
                    id_emplacement: emplacementFinal,
                    nom_unite_vente: nomUnite,
                    produit_nom: produitNom,
                    quantite_base: qteBase,
                    quantite_commandee: quantiteCommandeeUV,
                    quantite_recue: parseFloat(quantite_recue),
                    quantite_totale_base: qteTotaleBase,
                    ecart,
                    prix_achat_unite_vente: prixAchatUV,
                    prix_achat_base: prixAchatBase,
                    etat_marchandise,
                    num_lot,
                    date_peremption,
                    notes_ligne
                });
            }

            // ============================================================
            // 4. NUMÉRO + EN-TÊTE
            // ============================================================
            const numero_reception = await this.genererNumero(id_utilisateur, scope.destination, connection);

            const [result] = await connection.execute(
                `INSERT INTO receptions (
                    id_utilisateur, numero_reception, date_reception,
                    id_commande_achat, destination, id_entrepot,
                    statut, montant_total, notes
                ) VALUES (?, ?, ?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur,
                    numero_reception,
                    date_reception,
                    id_commande_achat,
                    scope.destination,
                    scope.id_entrepot,
                    notes
                ]
            );

            const id_reception = result.insertId;

            // ============================================================
            // 5. TRAITEMENT DES LIGNES
            // ============================================================
            let montant_total = 0;
            let statut_reception = 'complete';

            for (const lc of lignesCalculees) {
                // Écart > 0 (manquant) => réception partielle ; surplus => reste 'complete'
                if (lc.ecart > 0 && statut_reception === 'complete') {
                    statut_reception = 'partielle';
                }

                const montantLigne = lc.prix_achat_unite_vente
                    ? lc.quantite_recue * lc.prix_achat_unite_vente
                    : null;
                if (montantLigne !== null) montant_total += montantLigne;

                // --- Ligne de réception ---
                await connection.execute(
                    `INSERT INTO reception_lignes (
                        id_reception, id_produit, id_produit_entrepot, id_ligne_achat,
                        id_unite_vente, id_unite_vente_entrepot, id_emplacement,
                        nom_unite_vente, quantite_base, quantite_totale_base,
                        quantite_commandee, quantite_recue, ecart,
                        prix_achat_unite_vente, prix_achat_base, montant_total,
                        etat_marchandise, num_lot, date_peremption, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id_reception,
                        lc.id_produit,
                        lc.id_produit_entrepot,
                        lc.id_ligne_achat,
                        lc.id_unite_vente,
                        lc.id_unite_vente_entrepot,
                        lc.id_emplacement,
                        lc.nom_unite_vente,
                        lc.quantite_base,
                        lc.quantite_totale_base,
                        lc.quantite_commandee,
                        lc.quantite_recue,
                        lc.ecart,
                        lc.prix_achat_unite_vente,
                        lc.prix_achat_base,
                        montantLigne,
                        lc.etat_marchandise,
                        lc.num_lot,
                        lc.date_peremption,
                        lc.notes_ligne
                    ]
                );

                // ============================================================
                // SEUL ENDROIT QUI MODIFIE LE STOCK
                // ============================================================
                if (isEntrepot) {
                    await this._stockEntrepot(connection, {
                        lc, scope, id_utilisateur, id_reception, numero_reception
                    });
                } else {
                    await this._stockMagasin(connection, {
                        lc, id_utilisateur, id_reception, numero_reception
                    });
                }

                // Prix d'achat réel connu : complète la ligne de commande si elle n'en avait pas
                if (lc.prix_achat_unite_vente && lc.prix_achat_unite_vente > 0 && lc.id_ligne_achat) {
                    await connection.execute(
                        `UPDATE ligne_commande_achat SET prix_achat = ?
                         WHERE id_ligne_achat = ?
                           AND (prix_achat IS NULL OR prix_achat = 0)`,
                        [lc.prix_achat_unite_vente, lc.id_ligne_achat]
                    );
                }
            }

            // ============================================================
            // 6. MISE À JOUR EN-TÊTE RÉCEPTION
            // ============================================================
            await connection.execute(
                `UPDATE receptions
                 SET statut = ?, montant_total = ?
                 WHERE id_reception = ? AND id_utilisateur = ?`,
                [statut_reception, montant_total, id_reception, id_utilisateur]
            );

            // ============================================================
            // 7. MISE À JOUR COMMANDE D'ACHAT (comparaison ligne par ligne)
            // ============================================================
            if (id_commande_achat) {
                const [commandeLignes] = await connection.execute(
                    `SELECT id_ligne_achat, quantite_totale_base
                     FROM ligne_commande_achat
                     WHERE id_commande_achat = ?`,
                    [id_commande_achat]
                );

                let toutesRecues = true;
                for (const cl of commandeLignes) {
                    const qteCommandeeBase = parseFloat(cl.quantite_totale_base) || 0;

                    if (qteCommandeeBase <= 0) {
                        toutesRecues = false;
                        break;
                    }

                    const [recu] = await connection.execute(
                        `SELECT COALESCE(SUM(rl.quantite_totale_base), 0) AS total_recu
                         FROM reception_lignes rl
                         INNER JOIN receptions r ON rl.id_reception = r.id_reception
                         WHERE rl.id_ligne_achat = ?
                           AND r.statut != 'annulee'`,
                        [cl.id_ligne_achat]
                    );

                    const totalRecu = parseFloat(recu[0].total_recu) || 0;
                    if (totalRecu < qteCommandeeBase) {
                        toutesRecues = false;
                        break;
                    }
                }

                const nouveauStatut = toutesRecues ? 'recue' : 'partiellement_recue';

                // montant_total = somme des montants réellement reçus
                const [tot] = await connection.execute(
                    `SELECT COALESCE(SUM(rl.montant_total), 0) AS total
                     FROM reception_lignes rl
                     INNER JOIN receptions r ON rl.id_reception = r.id_reception
                     WHERE r.id_commande_achat = ?
                       AND r.statut != 'annulee'`,
                    [id_commande_achat]
                );
                const nouveauMontant = parseFloat(tot[0].total) || 0;

                await connection.execute(
                    `UPDATE commandes_achat SET statut = ?, montant_total = ?
                     WHERE id_commande_achat = ? AND id_utilisateur = ?`,
                    [nouveauStatut, nouveauMontant, id_commande_achat, id_utilisateur]
                );
            }

            await connection.commit();
            connection.release(); // rendue au pool AVANT la relecture (sinon blocage quand le pool est plein)
            connexionRendue = true;
            return await this.findById(id_reception, id_utilisateur);

        } catch (error) {
            if (!connexionRendue) await connection.rollback();
            throw error;
        } finally {
            if (!connexionRendue) connection.release();
        }
    }

    /* ============================================================
       STOCK MAGASIN (comportement d'origine)
       ============================================================ */
    static async _stockMagasin(connection, { lc, id_utilisateur, id_reception, numero_reception }) {
        const [stockRows] = await connection.execute(
            `SELECT quantite_stock FROM produits
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [lc.id_produit, id_utilisateur]
        );
        const ancienne_qte = parseFloat(stockRows[0]?.quantite_stock) || 0;
        const nouvelle_qte = ancienne_qte + lc.quantite_totale_base;

        await connection.execute(
            `UPDATE produits SET quantite_stock = ?
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [nouvelle_qte, lc.id_produit, id_utilisateur]
        );

        const nouveauStatut = nouvelle_qte <= 0 ? 'rupture' : 'disponible';
        await connection.execute(
            `UPDATE produits SET statut = ?
             WHERE id_produit = ? AND id_utilisateur = ?`,
            [nouveauStatut, lc.id_produit, id_utilisateur]
        );

        // Prix d'achat
        if (lc.prix_achat_unite_vente && lc.prix_achat_unite_vente > 0) {
            if (lc.id_unite_vente) {
                await connection.execute(
                    `UPDATE unites_vente SET prix_achat = ?
                     WHERE id_unite_vente = ?`,
                    [lc.prix_achat_unite_vente, lc.id_unite_vente]
                );
            }
            if (lc.prix_achat_base && lc.prix_achat_base > 0) {
                await connection.execute(
                    `UPDATE produits SET prix_achat = ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [lc.prix_achat_base, lc.id_produit, id_utilisateur]
                );
            }
        }

        // Entrée stock (traçabilité)
        const ref_entree = `ENT-${Date.now()}-${lc.id_produit}-${Math.random().toString(36).slice(2, 7)}`;
        await connection.execute(
            `INSERT INTO entrees_stock (
                id_utilisateur, reference, id_produit, id_reception,
                id_unite_vente, nom_unite_vente, quantite_base,
                quantite, quantite_totale_base,
                num_lot, date_peremption, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id_utilisateur,
                ref_entree,
                lc.id_produit,
                id_reception,
                lc.id_unite_vente,
                lc.nom_unite_vente,
                lc.quantite_base,
                lc.quantite_recue,
                lc.quantite_totale_base,
                lc.num_lot,
                lc.date_peremption,
                lc.notes_ligne || 'Entrée par réception'
            ]
        );

        // Mouvement de stock (traçabilité)
        await MouvementStock.enregistrer({
            id_produit: lc.id_produit,
            type_mouvement: 'entree',
            quantite: lc.quantite_totale_base,
            id_reference: id_reception,
            type_reference: 'reception',
            notes: `Réception ${numero_reception} - ${lc.quantite_recue} ${lc.nom_unite_vente}`
        }, connection, id_utilisateur);
    }

    /* ============================================================
       STOCK ENTREPÔT
       produits_entrepot ↑  +  entrees_stock_entrepot  +  mouvements_entrepot
       ============================================================ */
    static async _stockEntrepot(connection, { lc, scope, id_utilisateur, id_reception, numero_reception }) {
        // Verrou : deux réceptions simultanées ne doivent pas écraser le stock
        const [stockRows] = await connection.execute(
            `SELECT quantite_stock FROM produits_entrepot
              WHERE id_produit_entrepot = ? AND id_entrepot = ?
              FOR UPDATE`,
            [lc.id_produit_entrepot, scope.id_entrepot]
        );
        if (stockRows.length === 0) {
            throw fail(`Produit entrepôt ID ${lc.id_produit_entrepot} introuvable`, 404);
        }

        const ancienne_qte = parseFloat(stockRows[0].quantite_stock) || 0;
        const nouvelle_qte = ancienne_qte + lc.quantite_totale_base;

        await connection.execute(
            `UPDATE produits_entrepot SET quantite_stock = ?
              WHERE id_produit_entrepot = ? AND id_entrepot = ?`,
            [nouvelle_qte, lc.id_produit_entrepot, scope.id_entrepot]
        );

        // Prix d'achat (même règle que le magasin)
        if (lc.prix_achat_unite_vente && lc.prix_achat_unite_vente > 0) {
            if (lc.id_unite_vente_entrepot) {
                await connection.execute(
                    `UPDATE unites_vente_entrepot SET prix_achat = ?
                      WHERE id_unite_vente_entrepot = ? AND id_produit_entrepot = ?`,
                    [lc.prix_achat_unite_vente, lc.id_unite_vente_entrepot, lc.id_produit_entrepot]
                );
            }
            if (lc.prix_achat_base && lc.prix_achat_base > 0) {
                await connection.execute(
                    `UPDATE produits_entrepot SET prix_achat = ?
                      WHERE id_produit_entrepot = ? AND id_entrepot = ?`,
                    [lc.prix_achat_base, lc.id_produit_entrepot, scope.id_entrepot]
                );
            }
        }

        // Entrée d'entrepôt (référence unique par entrepôt)
        const ref_entree = `ENT-${Date.now()}-${lc.id_produit_entrepot}-${Math.random().toString(36).slice(2, 7)}`;
        await connection.execute(
            `INSERT INTO entrees_stock_entrepot (
                id_entrepot, id_utilisateur, reference, id_produit_entrepot,
                id_unite_vente_entrepot, nom_unite_vente, quantite_base,
                quantite, quantite_totale_base,
                id_emplacement, num_lot, date_peremption, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                scope.id_entrepot,
                id_utilisateur,
                ref_entree,
                lc.id_produit_entrepot,
                lc.id_unite_vente_entrepot,
                lc.nom_unite_vente,
                lc.quantite_base,
                lc.quantite_recue,
                lc.quantite_totale_base,
                lc.id_emplacement,
                lc.num_lot,
                lc.date_peremption,
                lc.notes_ligne || `Réception ${numero_reception}`
            ]
        );

        // Historique des mouvements de l'entrepôt
        await connection.execute(
            `INSERT INTO mouvements_entrepot
                (id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
                 quantite, ancienne_quantite, nouvelle_quantite,
                 id_unite_vente_entrepot, nom_unite_vente, quantite_base, quantite_saisie,
                 num_lot, date_peremption, type_reference, id_reference, notes)
             VALUES (?, ?, ?, 'entree', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reception', ?, ?)`,
            [
                scope.id_entrepot,
                lc.id_produit_entrepot,
                id_utilisateur,
                lc.quantite_totale_base,
                ancienne_qte,
                nouvelle_qte,
                lc.id_unite_vente_entrepot,
                lc.nom_unite_vente,
                lc.quantite_base,
                lc.quantite_recue,
                lc.num_lot,
                lc.date_peremption,
                id_reception,
                `Réception ${numero_reception} - ${lc.quantite_recue} ${lc.nom_unite_vente}`
            ]
        );
    }

    /* ============================================================
       Récupérer une réception par ID (lignes magasin OU entrepôt)
       ============================================================ */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*,
                        ca.numero_commande,
                        f.nom AS fournisseur_nom,
                        f.telephone AS fournisseur_telephone,
                        u.fullname AS utilisateur_nom,
                        e.nom AS entrepot_nom
                 FROM receptions r
                 LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                 LEFT JOIN entrepots e ON r.id_entrepot = e.id_entrepot
                 WHERE r.id_reception = ?
                   AND r.id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) return null;
            const reception = rows[0];

            const [lignes] = await pool.execute(
                `SELECT rl.*,
                        COALESCE(p.nom, pe.nom) AS produit_nom,
                        COALESCE(p.id_marque, pe.id_marque) AS id_marque,
                        m.nom AS marque_nom,
                        COALESCE(p.id_unite, pe.id_unite) AS id_unite,
                        u.symbole AS unite_symbole,
                        COALESCE(uv.nom, uve.nom) AS unite_vente_nom,
                        COALESCE(uv.quantite_base, uve.quantite_base) AS unite_vente_quantite_base
                 FROM reception_lignes rl
                 LEFT JOIN produits p ON rl.id_produit = p.id_produit
                 LEFT JOIN produits_entrepot pe ON rl.id_produit_entrepot = pe.id_produit_entrepot
                 LEFT JOIN marques m ON m.id_marque = COALESCE(p.id_marque, pe.id_marque)
                 LEFT JOIN unites u ON u.id_unite = COALESCE(p.id_unite, pe.id_unite)
                 LEFT JOIN unites_vente uv ON rl.id_unite_vente = uv.id_unite_vente
                 LEFT JOIN unites_vente_entrepot uve ON rl.id_unite_vente_entrepot = uve.id_unite_vente_entrepot
                 WHERE rl.id_reception = ?`,
                [id]
            );

            reception.lignes = lignes.map(l => ({
                ...l,
                nom_unite_vente: l.nom_unite_vente || l.unite_vente_nom || 'Unité',
                quantite_base: parseFloat(l.quantite_base) || 1,
                quantite_totale_base: parseFloat(l.quantite_totale_base)
                    || (parseFloat(l.quantite_recue) * (parseFloat(l.quantite_base) || 1)),
                prix_achat_unite_vente: l.prix_achat_unite_vente !== null
                    ? parseFloat(l.prix_achat_unite_vente)
                    : null,
                prix_achat_base: l.prix_achat_base !== null
                    ? parseFloat(l.prix_achat_base)
                    : null,
                montant_total: l.montant_total !== null
                    ? parseFloat(l.montant_total)
                    : null
            }));

            return reception;

        } catch (error) {
            console.error('❌ Error finding reception by ID:', error);
            throw error;
        }
    }

    /* ============================================================
       Toutes les réceptions (filters.destination / filters.id_entrepot)
       ============================================================ */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findAll');
        }

        try {
            const sc = this._scopeSql(filters);
            let query = `
                SELECT r.*,
                       ca.numero_commande,
                       f.nom AS fournisseur_nom,
                       u.fullname AS utilisateur_nom,
                       e.nom AS entrepot_nom,
                       (SELECT COUNT(*) FROM reception_lignes rl
                         WHERE rl.id_reception = r.id_reception) AS nb_lignes
                FROM receptions r
                LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                LEFT JOIN entrepots e ON r.id_entrepot = e.id_entrepot
                WHERE r.id_utilisateur = ?${sc.sql}
            `;
            const params = [id_utilisateur, ...sc.params];

            if (filters.numero_reception) {
                query += ' AND r.numero_reception LIKE ?';
                params.push(`%${filters.numero_reception}%`);
            }
            if (filters.id_commande_achat) {
                query += ' AND r.id_commande_achat = ?';
                params.push(filters.id_commande_achat);
            }
            if (filters.statut) {
                query += ' AND r.statut = ?';
                params.push(filters.statut);
            }
            if (filters.date_debut) {
                query += ' AND r.date_reception >= ?';
                params.push(filters.date_debut);
            }
            if (filters.date_fin) {
                query += ' AND r.date_reception <= ?';
                params.push(filters.date_fin);
            }
            if (filters.search) {
                query += ` AND (r.numero_reception LIKE ?
                            OR f.nom LIKE ?
                            OR ca.numero_commande LIKE ?)`;
                const s = `%${filters.search}%`;
                params.push(s, s, s);
            }

            query += ' ORDER BY r.date_reception DESC, r.id_reception DESC';

            if (filters.limit) {
                const limit = Math.min(parseInt(filters.limit) || 50, 500);
                query += ` LIMIT ${limit}`;
            }
            if (filters.offset) {
                const offset = Math.max(parseInt(filters.offset) || 0, 0);
                query += ` OFFSET ${offset}`;
            }

            const [rows] = await pool.query(query, params);
            return rows;

        } catch (error) {
            console.error('❌ Error finding receptions:', error);
            throw error;
        }
    }

    /* ============================================================
       Réceptions d'une commande
       ============================================================ */
    static async findByCommande(id_commande_achat, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByCommande');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT r.*, u.fullname AS utilisateur_nom
                 FROM receptions r
                 LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
                 WHERE r.id_commande_achat = ?
                   AND r.id_utilisateur = ?
                 ORDER BY r.date_reception DESC`,
                [id_commande_achat, id_utilisateur]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by commande:', error);
            throw error;
        }
    }

    /* ============================================================
       Réceptions par statut
       ============================================================ */
    static async findByStatut(statut, id_utilisateur, scope = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByStatut');
        }

        try {
            const sc = this._scopeSql(scope);
            const [rows] = await pool.execute(
                `SELECT r.*, f.nom AS fournisseur_nom
                 FROM receptions r
                 LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE r.statut = ?
                   AND r.id_utilisateur = ?${sc.sql}
                 ORDER BY r.date_reception DESC`,
                [statut, id_utilisateur, ...sc.params]
            );
            return rows;
        } catch (error) {
            console.error('❌ Error finding by statut:', error);
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
                `UPDATE receptions SET statut = ?
                 WHERE id_reception = ? AND id_utilisateur = ?`,
                [statut, id, id_utilisateur]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error updating statut:', error);
            throw error;
        }
    }

    /* ============================================================
       Supprimer (seulement si 'en_attente')
       ============================================================ */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour delete');
        }

        try {
            const [rows] = await pool.execute(
                `SELECT statut FROM receptions
                 WHERE id_reception = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) throw new Error('Réception non trouvée');
            if (rows[0].statut !== 'en_attente') {
                throw new Error(`Impossible de supprimer une réception ${rows[0].statut}`);
            }

            const [result] = await pool.execute(
                `DELETE FROM receptions
                 WHERE id_reception = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            return result.affectedRows > 0;

        } catch (error) {
            console.error('❌ Error deleting reception:', error);
            throw error;
        }
    }

    /* ============================================================
       Statistiques (par destination)
       ============================================================ */
    static async getStats(id_utilisateur, scope = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getStats');
        }

        try {
            const sc = this._scopeSql(scope, 'receptions');
            const [rows] = await pool.execute(
                `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) AS en_attente,
                    SUM(CASE WHEN statut = 'partielle'  THEN 1 ELSE 0 END) AS partielle,
                    SUM(CASE WHEN statut = 'complete'   THEN 1 ELSE 0 END) AS complete,
                    SUM(CASE WHEN statut = 'annulee'    THEN 1 ELSE 0 END) AS annulee,
                    COALESCE(SUM(montant_total), 0) AS total_montant,
                    COALESCE(AVG(montant_total), 0) AS moyenne_montant
                 FROM receptions
                 WHERE id_utilisateur = ?${sc.sql}`,
                [id_utilisateur, ...sc.params]
            );

            const stats = rows[0];
            return {
                total: parseInt(stats.total) || 0,
                en_attente: parseInt(stats.en_attente) || 0,
                partielle: parseInt(stats.partielle) || 0,
                complete: parseInt(stats.complete) || 0,
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

export default Reception;