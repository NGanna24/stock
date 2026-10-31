// models/RetourFournisseur.js
//
// Retours fournisseurs : l'origine de la marchandise (magasin / entrepôt) est portée par
// `destination` + `id_entrepot`. Pour un entrepôt, seul le PROPRIÉTAIRE peut créer / gérer
// les retours (contrôle fait ici et dans le contrôleur).
//
// Règles (identiques pour les deux origines) :
//   1. le produit doit avoir été RÉELLEMENT REÇU du fournisseur (réceptions non annulées)
//   2. quantité retournée <= reçu net (reçu - déjà retourné, retours annulés exclus)
//   3. quantité retournée <= stock actuel
// Les quantités de retour sont en UNITÉ DE BASE.
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';
import CommandeAchat from './CommandeAchat.js';

const fail = (message, statusCode = 400) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

class RetourFournisseur {
    /* ============================================================
       HELPERS
       ============================================================ */

    /** { destination, id_entrepot } normalisé (défaut : magasin) */
    static scope(destination, id_entrepot) {
        return CommandeAchat.scope(destination, id_entrepot);
    }

    /** Fragment SQL de filtrage par destination */
    static _scopeSql(scope, alias = 'r') {
        if (scope?.destination === 'entrepot') {
            return { sql: ` AND ${alias}.destination = 'entrepot' AND ${alias}.id_entrepot = ?`, params: [scope.id_entrepot] };
        }
        return { sql: ` AND ${alias}.destination = 'magasin'`, params: [] };
    }

    static async genererNumero(id_utilisateur, destination = 'magasin', db = pool) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour genererNumero');

        const date = new Date();
        const annee = date.getFullYear();
        const mois = String(date.getMonth() + 1).padStart(2, '0');
        const prefixe = destination === 'entrepot' ? 'RTE' : 'RET';

        // Plus grand numéro déjà utilisé ce mois-ci (et non COUNT : une suppression ne doit pas
        // faire réutiliser un numéro existant)
        const debut = `${prefixe}-${annee}${mois}-`;
        const [rows] = await db.execute(
            `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(numero_retour, '-', -1) AS UNSIGNED)), 0) AS dernier
             FROM retours_fournisseurs
             WHERE id_utilisateur = ? AND numero_retour LIKE ?`,
            [id_utilisateur, `${debut}%`]
        );

        return `${debut}${String(parseInt(rows[0].dernier) + 1).padStart(4, '0')}`;
    }

    /* ============================================================
       Produits RETOURNABLES d'un fournisseur pour un entrepôt
       (même forme que /fournisseurs/:id/produits-recu, id_produit = id_produit_entrepot)
       ============================================================ */
    static async getProduitsRecusEntrepot(id_fournisseur, id_entrepot) {
        const [rows] = await pool.execute(
            `SELECT pe.id_produit_entrepot,
                    pe.nom, pe.prix_achat, pe.quantite_stock,
                    mo.nom AS modele_nom, u.symbole AS unite_symbole, u.nom AS unite_nom,
                    rec.total_recu_base,
                    COALESCE(ret.total_retourne, 0) AS total_retourne
             FROM produits_entrepot pe
             INNER JOIN (
                 SELECT rl.id_produit_entrepot, SUM(rl.quantite_totale_base) AS total_recu_base
                 FROM reception_lignes rl
                 INNER JOIN receptions r ON r.id_reception = rl.id_reception
                 INNER JOIN commandes_achat ca ON ca.id_commande_achat = r.id_commande_achat
                 WHERE r.destination = 'entrepot' AND r.id_entrepot = ?
                   AND ca.id_fournisseur = ?
                   AND r.statut != 'annulee' AND ca.statut != 'annulee'
                   AND rl.id_produit_entrepot IS NOT NULL
                 GROUP BY rl.id_produit_entrepot
             ) rec ON rec.id_produit_entrepot = pe.id_produit_entrepot
             LEFT JOIN (
                 SELECT rtl.id_produit_entrepot, SUM(rtl.quantite) AS total_retourne
                 FROM retour_lignes rtl
                 INNER JOIN retours_fournisseurs rf ON rf.id_retour = rtl.id_retour
                 WHERE rf.destination = 'entrepot' AND rf.id_entrepot = ?
                   AND rf.id_fournisseur = ? AND rf.statut != 'annule'
                   AND rtl.id_produit_entrepot IS NOT NULL
                 GROUP BY rtl.id_produit_entrepot
             ) ret ON ret.id_produit_entrepot = pe.id_produit_entrepot
             LEFT JOIN modeles mo ON mo.id_modele = pe.id_modele
             LEFT JOIN unites u ON u.id_unite = pe.id_unite
             WHERE pe.id_entrepot = ?
             ORDER BY pe.nom`,
            [id_entrepot, id_fournisseur, id_entrepot, id_fournisseur, id_entrepot]
        );

        return rows
            .map((p) => {
                const recu = parseFloat(p.total_recu_base) || 0;
                const retourne = parseFloat(p.total_retourne) || 0;
                const stock = parseFloat(p.quantite_stock) || 0;
                const net = Math.max(0, recu - retourne);
                return {
                    id_produit: p.id_produit_entrepot,
                    id_produit_entrepot: p.id_produit_entrepot,
                    nom: p.nom,
                    modele_nom: p.modele_nom,
                    unite_symbole: p.unite_symbole,
                    unite_nom: p.unite_nom,
                    prix_achat: parseFloat(p.prix_achat) || 0,
                    quantite_stock: stock,
                    quantite_recue: recu,
                    quantite_retournee: retourne,
                    quantite_max_retournable: Math.min(net, stock)
                };
            })
            .filter((p) => p.quantite_max_retournable > 0);
    }

    /* ============================================================
       Création
       ============================================================ */
    static async create(data) {
        const {
            id_fournisseur,
            id_commande_achat = null,
            id_reception = null,
            date_retour,
            motif_retour,
            notes = null,
            id_utilisateur,
            destination = 'magasin',
            id_entrepot = null,
            lignes = []
        } = data;

        if (!id_utilisateur) throw new Error('id_utilisateur requis');
        const entrepot = destination === 'entrepot';

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            if (!id_fournisseur) throw fail('Le fournisseur est obligatoire');
            if (!date_retour) throw fail('La date de retour est obligatoire');
            if (!motif_retour) throw fail('Le motif de retour est obligatoire');
            if (!Array.isArray(lignes) || lignes.length === 0) throw fail('Au moins un produit est requis');

            if (entrepot) {
                if (!id_entrepot) throw fail("L'entrepôt est obligatoire");
                if (!(await CommandeAchat.estProprietaireEntrepot(id_entrepot, id_utilisateur, connection))) {
                    throw fail("Seul le propriétaire de l'entrepôt peut gérer les retours de cet entrepôt", 403);
                }
            }

            const [fournisseurRows] = await connection.execute(
                `SELECT id_fournisseur, nom FROM fournisseurs
                 WHERE id_fournisseur = ? AND id_utilisateur = ? AND actif = 1`,
                [id_fournisseur, id_utilisateur]
            );
            if (fournisseurRows.length === 0) throw fail('Fournisseur non trouvé ou inactif', 404);

            /* ---------- Validation des lignes ---------- */
            const lignesValidees = [];
            const dejaDemande = new Map(); // même produit sur 2 lignes : on cumule

            for (const ligne of lignes) {
                const idProd = entrepot ? ligne.id_produit_entrepot : ligne.id_produit;
                if (!idProd) throw fail('Produit manquant sur une ligne');

                // Produit (verrouillé pour contrôler le stock)
                const [produitRows] = entrepot
                    ? await connection.execute(
                        `SELECT id_produit_entrepot AS id, nom, quantite_stock, prix_achat
                         FROM produits_entrepot
                         WHERE id_produit_entrepot = ? AND id_entrepot = ? FOR UPDATE`,
                        [idProd, id_entrepot]
                    )
                    : await connection.execute(
                        `SELECT id_produit AS id, nom, quantite_stock, prix_achat
                         FROM produits
                         WHERE id_produit = ? AND id_utilisateur = ? FOR UPDATE`,
                        [idProd, id_utilisateur]
                    );
                if (produitRows.length === 0) throw fail(`Produit ID ${idProd} non trouvé`, 404);
                const produit = produitRows[0];

                if (!ligne.quantite || parseFloat(ligne.quantite) <= 0) {
                    throw fail(`La quantité pour "${produit.nom}" doit être positive`);
                }
                const qteDemandee = parseFloat(ligne.quantite) + (dejaDemande.get(idProd) || 0);
                dejaDemande.set(idProd, qteDemandee);

                // RÈGLE 1 : reçu net du fournisseur
                const [recuRows] = entrepot
                    ? await connection.execute(
                        `SELECT COALESCE(SUM(rl.quantite_totale_base), 0) AS total
                         FROM reception_lignes rl
                         INNER JOIN receptions r ON rl.id_reception = r.id_reception
                         INNER JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                         WHERE rl.id_produit_entrepot = ? AND r.destination = 'entrepot' AND r.id_entrepot = ?
                           AND ca.id_fournisseur = ? AND r.statut != 'annulee' AND ca.statut != 'annulee'`,
                        [idProd, id_entrepot, id_fournisseur]
                    )
                    : await connection.execute(
                        `SELECT COALESCE(SUM(rl.quantite_totale_base), 0) AS total
                         FROM reception_lignes rl
                         INNER JOIN receptions r ON rl.id_reception = r.id_reception
                         INNER JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                         WHERE rl.id_produit = ? AND r.destination = 'magasin' AND r.id_utilisateur = ?
                           AND ca.id_fournisseur = ? AND r.statut != 'annulee' AND ca.statut != 'annulee'`,
                        [idProd, id_utilisateur, id_fournisseur]
                    );
                const totalRecu = parseFloat(recuRows[0].total) || 0;

                const [retourneRows] = entrepot
                    ? await connection.execute(
                        `SELECT COALESCE(SUM(rl.quantite), 0) AS total
                         FROM retour_lignes rl
                         INNER JOIN retours_fournisseurs rf ON rl.id_retour = rf.id_retour
                         WHERE rl.id_produit_entrepot = ? AND rf.destination = 'entrepot' AND rf.id_entrepot = ?
                           AND rf.id_fournisseur = ? AND rf.statut != 'annule'`,
                        [idProd, id_entrepot, id_fournisseur]
                    )
                    : await connection.execute(
                        `SELECT COALESCE(SUM(rl.quantite), 0) AS total
                         FROM retour_lignes rl
                         INNER JOIN retours_fournisseurs rf ON rl.id_retour = rf.id_retour
                         WHERE rl.id_produit = ? AND rf.destination = 'magasin' AND rf.id_utilisateur = ?
                           AND rf.id_fournisseur = ? AND rf.statut != 'annule'`,
                        [idProd, id_utilisateur, id_fournisseur]
                    );
                const totalRetourne = parseFloat(retourneRows[0].total) || 0;
                const net = Math.max(0, totalRecu - totalRetourne);

                if (net <= 0) {
                    throw fail(
                        `Aucune quantité reçue à retourner pour "${produit.nom}" auprès de ce fournisseur. ` +
                        `(Reçu: ${totalRecu}, Déjà retourné: ${totalRetourne})`
                    );
                }
                if (qteDemandee > net) {
                    throw fail(`Quantité trop élevée pour "${produit.nom}". Reçu net: ${net}, Demandé: ${qteDemandee}`);
                }

                // RÈGLE 2 : stock disponible
                const stock = parseFloat(produit.quantite_stock) || 0;
                if (qteDemandee > stock) {
                    throw fail(`Stock insuffisant pour "${produit.nom}". Disponible: ${stock}, Demandé: ${qteDemandee}`);
                }

                const prixUnitaire = ligne.prix_achat && parseFloat(ligne.prix_achat) > 0
                    ? parseFloat(ligne.prix_achat)
                    : parseFloat(produit.prix_achat) || 0;

                lignesValidees.push({
                    id_produit: idProd,
                    id_ligne_achat: ligne.id_ligne_achat || null,
                    quantite: parseFloat(ligne.quantite),
                    prix_achat: prixUnitaire,
                    remise: parseFloat(ligne.remise) || 0,
                    motif_retour: ligne.motif_retour || motif_retour,
                    etat_produit: ligne.etat_produit || 'neuf',
                    notes_ligne: ligne.notes_ligne || ligne.notes || null,
                    stock_avant: stock
                });
            }

            /* ---------- Auto-détection réception / commande ---------- */
            let commandeFinale = id_commande_achat;
            let receptionFinale = id_reception;

            if (!commandeFinale || !receptionFinale) {
                const ids = lignesValidees.map((l) => l.id_produit);
                const ph = ids.map(() => '?').join(',');
                const [recente] = entrepot
                    ? await connection.execute(
                        `SELECT r.id_reception, r.id_commande_achat
                         FROM receptions r
                         INNER JOIN reception_lignes rl ON rl.id_reception = r.id_reception
                         INNER JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                         WHERE r.destination = 'entrepot' AND r.id_entrepot = ? AND ca.id_fournisseur = ?
                           AND rl.id_produit_entrepot IN (${ph})
                           AND r.statut != 'annulee' AND ca.statut != 'annulee'
                         ORDER BY r.date_reception DESC, r.id_reception DESC LIMIT 1`,
                        [id_entrepot, id_fournisseur, ...ids]
                    )
                    : await connection.execute(
                        `SELECT r.id_reception, r.id_commande_achat
                         FROM receptions r
                         INNER JOIN reception_lignes rl ON rl.id_reception = r.id_reception
                         INNER JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
                         WHERE r.destination = 'magasin' AND r.id_utilisateur = ? AND ca.id_fournisseur = ?
                           AND rl.id_produit IN (${ph})
                           AND r.statut != 'annulee' AND ca.statut != 'annulee'
                         ORDER BY r.date_reception DESC, r.id_reception DESC LIMIT 1`,
                        [id_utilisateur, id_fournisseur, ...ids]
                    );
                if (recente.length > 0) {
                    if (!commandeFinale) commandeFinale = recente[0].id_commande_achat;
                    if (!receptionFinale) receptionFinale = recente[0].id_reception;
                }
            }

            /* ---------- En-tête ---------- */
            const numero_retour = await this.genererNumero(id_utilisateur, destination, connection);

            const [result] = await connection.execute(
                `INSERT INTO retours_fournisseurs (
                    id_utilisateur, numero_retour, date_retour, id_fournisseur,
                    destination, id_entrepot, id_commande_achat, id_reception,
                    motif_retour, statut, montant_total, notes
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', 0.00, ?)`,
                [
                    id_utilisateur, numero_retour, date_retour, id_fournisseur,
                    entrepot ? 'entrepot' : 'magasin', entrepot ? id_entrepot : null,
                    commandeFinale || null, receptionFinale || null, motif_retour, notes
                ]
            );
            const id_retour = result.insertId;

            /* ---------- Lignes + sortie de stock ---------- */
            let montant_total = 0;
            let n = 0;

            for (const lc of lignesValidees) {
                n += 1;

                if (entrepot) {
                    await connection.execute(
                        `INSERT INTO retour_lignes (
                            id_retour, id_produit_entrepot, id_ligne_achat, quantite, prix_achat, remise,
                            motif_retour, etat_produit, notes
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [id_retour, lc.id_produit, lc.id_ligne_achat, lc.quantite, lc.prix_achat, lc.remise,
                         lc.motif_retour, lc.etat_produit, lc.notes_ligne]
                    );

                    const nouveau = lc.stock_avant - lc.quantite;
                    await connection.execute(
                        `UPDATE produits_entrepot SET quantite_stock = ? WHERE id_produit_entrepot = ?`,
                        [nouveau, lc.id_produit]
                    );

                    await connection.execute(
                        `INSERT INTO sorties_stock_entrepot (
                            id_entrepot, id_utilisateur, reference, date_sortie, id_produit_entrepot,
                            quantite, quantite_totale_base, type_sortie, notes
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'retour_fournisseur', ?)`,
                        [id_entrepot, id_utilisateur, `SRT-${id_retour}-${n}`, date_retour, lc.id_produit,
                         lc.quantite, lc.quantite, lc.notes_ligne || `Retour fournisseur ${numero_retour}`]
                    );

                    await connection.execute(
                        `INSERT INTO mouvements_entrepot
                            (id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
                             quantite, ancienne_quantite, nouvelle_quantite, type_reference, id_reference, notes)
                         VALUES (?, ?, ?, 'sortie', ?, ?, ?, 'retour_fournisseur', ?, ?)`,
                        [id_entrepot, lc.id_produit, id_utilisateur, lc.quantite, lc.stock_avant, nouveau,
                         id_retour, `Retour fournisseur ${numero_retour} - ${lc.motif_retour}`]
                    );
                } else {
                    await connection.execute(
                        `INSERT INTO retour_lignes (
                            id_retour, id_produit, id_ligne_achat, quantite, prix_achat, remise,
                            motif_retour, etat_produit, notes
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [id_retour, lc.id_produit, lc.id_ligne_achat, lc.quantite, lc.prix_achat, lc.remise,
                         lc.motif_retour, lc.etat_produit, lc.notes_ligne]
                    );

                    await MouvementStock.enregistrer({
                        id_produit: lc.id_produit,
                        type_mouvement: 'sortie',
                        quantite: lc.quantite,
                        id_reference: id_retour,
                        type_reference: 'retour_fournisseur',
                        notes: `Retour fournisseur ${numero_retour} - ${lc.motif_retour}`
                    }, connection, id_utilisateur);

                    await connection.execute(
                        `INSERT INTO sorties_stock (
                            id_utilisateur, reference, date_sortie, id_produit, quantite, type_sortie, notes
                         ) VALUES (?, ?, ?, ?, ?, 'retour_fournisseur', ?)`,
                        [id_utilisateur, `SORTIE-RET-${Date.now()}-${lc.id_produit}`, date_retour, lc.id_produit,
                         lc.quantite, lc.notes_ligne || `Retour fournisseur ${numero_retour}`]
                    );
                }

                montant_total += lc.quantite * lc.prix_achat * (1 - lc.remise / 100);
            }

            await connection.execute(
                `UPDATE retours_fournisseurs SET montant_total = ? WHERE id_retour = ? AND id_utilisateur = ?`,
                [montant_total, id_retour, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(id_retour, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /* ============================================================
       Lecture
       ============================================================ */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findById');

        const [rows] = await pool.execute(
            `SELECT r.*,
                    f.nom AS fournisseur_nom, f.telephone AS fournisseur_telephone, f.email AS fournisseur_email,
                    ca.numero_commande, rec.numero_reception,
                    u.fullname AS utilisateur_nom,
                    e.nom AS entrepot_nom, e.ville AS entrepot_ville
             FROM retours_fournisseurs r
             LEFT JOIN fournisseurs f ON r.id_fournisseur = f.id_fournisseur
             LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
             LEFT JOIN receptions rec ON r.id_reception = rec.id_reception
             LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
             LEFT JOIN entrepots e ON r.id_entrepot = e.id_entrepot
             WHERE r.id_retour = ? AND r.id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        if (rows.length === 0) return null;
        const retour = rows[0];

        const [lignes] = await pool.execute(
            `SELECT rl.*,
                    COALESCE(p.nom, pe.nom) AS produit_nom,
                    COALESCE(p.id_marque, pe.id_marque) AS id_marque,
                    m.nom AS marque_nom,
                    u.symbole AS unite_symbole
             FROM retour_lignes rl
             LEFT JOIN produits p ON rl.id_produit = p.id_produit
             LEFT JOIN produits_entrepot pe ON rl.id_produit_entrepot = pe.id_produit_entrepot
             LEFT JOIN marques m ON m.id_marque = COALESCE(p.id_marque, pe.id_marque)
             LEFT JOIN unites u ON u.id_unite = COALESCE(p.id_unite, pe.id_unite)
             WHERE rl.id_retour = ?`,
            [id]
        );

        retour.lignes = lignes;
        return retour;
    }

    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findAll');

        const sc = this._scopeSql(filters);
        let query = `
            SELECT r.*, f.nom AS fournisseur_nom, ca.numero_commande, u.fullname AS utilisateur_nom,
                   e.nom AS entrepot_nom,
                   (SELECT COUNT(*) FROM retour_lignes x WHERE x.id_retour = r.id_retour) AS nb_lignes
            FROM retours_fournisseurs r
            LEFT JOIN fournisseurs f ON r.id_fournisseur = f.id_fournisseur
            LEFT JOIN commandes_achat ca ON r.id_commande_achat = ca.id_commande_achat
            LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
            LEFT JOIN entrepots e ON r.id_entrepot = e.id_entrepot
            WHERE r.id_utilisateur = ?${sc.sql}`;
        const params = [id_utilisateur, ...sc.params];

        if (filters.search) {
            query += ' AND (r.numero_retour LIKE ? OR f.nom LIKE ? OR r.notes LIKE ?)';
            const s = `%${filters.search}%`;
            params.push(s, s, s);
        }
        if (filters.id_fournisseur) { query += ' AND r.id_fournisseur = ?'; params.push(filters.id_fournisseur); }
        if (filters.statut) { query += ' AND r.statut = ?'; params.push(filters.statut); }
        if (filters.motif_retour) { query += ' AND r.motif_retour = ?'; params.push(filters.motif_retour); }
        if (filters.date_debut) { query += ' AND r.date_retour >= ?'; params.push(filters.date_debut); }
        if (filters.date_fin) { query += ' AND r.date_retour <= ?'; params.push(filters.date_fin); }

        query += ' ORDER BY r.date_retour DESC, r.id_retour DESC';
        if (filters.limit) query += ` LIMIT ${Math.min(parseInt(filters.limit) || 50, 500)}`;
        if (filters.offset) query += ` OFFSET ${Math.max(parseInt(filters.offset) || 0, 0)}`;

        const [rows] = await pool.query(query, params);
        return rows;
    }

    static async findByStatut(statut, id_utilisateur, scope = { destination: 'magasin' }) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findByStatut');
        const sc = this._scopeSql(scope);
        const [rows] = await pool.execute(
            `SELECT r.*, f.nom AS fournisseur_nom
             FROM retours_fournisseurs r
             LEFT JOIN fournisseurs f ON r.id_fournisseur = f.id_fournisseur
             WHERE r.statut = ? AND r.id_utilisateur = ?${sc.sql}
             ORDER BY r.date_retour DESC`,
            [statut, id_utilisateur, ...sc.params]
        );
        return rows;
    }

    static async findByFournisseur(id_fournisseur, id_utilisateur, scope = { destination: 'magasin' }) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findByFournisseur');
        const sc = this._scopeSql(scope);
        const [rows] = await pool.execute(
            `SELECT r.*, u.fullname AS utilisateur_nom
             FROM retours_fournisseurs r
             LEFT JOIN utilisateurs u ON r.id_utilisateur = u.id_utilisateur
             WHERE r.id_fournisseur = ? AND r.id_utilisateur = ?${sc.sql}
             ORDER BY r.date_retour DESC`,
            [id_fournisseur, id_utilisateur, ...sc.params]
        );
        return rows;
    }

    static async updateStatut(id, statut, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour updateStatut');

        const statutsValides = ['en_attente', 'envoye', 'recu_par_fournisseur', 'traite', 'annule'];
        if (!statutsValides.includes(statut)) throw fail('Statut invalide');
        if (statut === 'annule') throw fail("Utilisez l'annulation pour réintégrer le stock");

        const dateTraitement = statut === 'traite' ? new Date() : null;
        const [result] = await pool.execute(
            `UPDATE retours_fournisseurs SET statut = ?, date_traitement = ?
             WHERE id_retour = ? AND id_utilisateur = ? AND statut != 'annule'`,
            [statut, dateTraitement, id, id_utilisateur]
        );
        return result.affectedRows > 0;
    }

    static async getStats(id_utilisateur, scope = { destination: 'magasin' }) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getStats');
        const sc = this._scopeSql(scope, 'retours_fournisseurs');
        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN statut = 'en_attente'           THEN 1 ELSE 0 END) AS en_attente,
                SUM(CASE WHEN statut = 'envoye'               THEN 1 ELSE 0 END) AS envoye,
                SUM(CASE WHEN statut = 'recu_par_fournisseur' THEN 1 ELSE 0 END) AS recu_par_fournisseur,
                SUM(CASE WHEN statut = 'traite'               THEN 1 ELSE 0 END) AS traite,
                SUM(CASE WHEN statut = 'annule'               THEN 1 ELSE 0 END) AS annule,
                COALESCE(SUM(montant_total), 0) AS total_montant,
                COALESCE(AVG(montant_total), 0) AS moyenne_montant
             FROM retours_fournisseurs
             WHERE id_utilisateur = ?${sc.sql}`,
            [id_utilisateur, ...sc.params]
        );
        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            en_attente: parseInt(s.en_attente) || 0,
            envoye: parseInt(s.envoye) || 0,
            recu_par_fournisseur: parseInt(s.recu_par_fournisseur) || 0,
            traite: parseInt(s.traite) || 0,
            annule: parseInt(s.annule) || 0,
            total_montant: parseFloat(s.total_montant) || 0,
            moyenne_montant: parseFloat(s.moyenne_montant) || 0
        };
    }

    /* ============================================================
       Remise en stock (annulation / suppression d'un retour non traité)
       ============================================================ */
    static async _remettreEnStock(connection, retour, id_utilisateur, typeReference, libelle) {
        const [lignes] = await connection.execute(
            `SELECT id_produit, id_produit_entrepot, quantite FROM retour_lignes WHERE id_retour = ?`,
            [retour.id_retour]
        );

        for (const l of lignes) {
            if (retour.destination === 'entrepot') {
                if (!l.id_produit_entrepot) continue;
                const [pe] = await connection.execute(
                    `SELECT quantite_stock FROM produits_entrepot WHERE id_produit_entrepot = ? FOR UPDATE`,
                    [l.id_produit_entrepot]
                );
                if (pe.length === 0) continue;
                const avant = parseFloat(pe[0].quantite_stock) || 0;
                const apres = avant + parseFloat(l.quantite);
                await connection.execute(
                    `UPDATE produits_entrepot SET quantite_stock = ? WHERE id_produit_entrepot = ?`,
                    [apres, l.id_produit_entrepot]
                );
                await connection.execute(
                    `INSERT INTO mouvements_entrepot
                        (id_entrepot, id_produit_entrepot, id_utilisateur, type_mouvement,
                         quantite, ancienne_quantite, nouvelle_quantite, type_reference, id_reference, notes)
                     VALUES (?, ?, ?, 'entree', ?, ?, ?, ?, ?, ?)`,
                    [retour.id_entrepot, l.id_produit_entrepot, id_utilisateur, l.quantite, avant, apres,
                     typeReference, retour.id_retour, `${libelle} ${retour.numero_retour}`]
                );
            } else if (l.id_produit) {
                await MouvementStock.enregistrer({
                    id_produit: l.id_produit,
                    type_mouvement: 'entree',
                    quantite: l.quantite,
                    id_reference: retour.id_retour,
                    type_reference: typeReference,
                    notes: `${libelle} ${retour.numero_retour}`
                }, connection, id_utilisateur);
            }
        }
    }

    static async _chargerPourModification(connection, id, id_utilisateur) {
        const [rows] = await connection.execute(
            `SELECT id_retour, numero_retour, statut, destination, id_entrepot
             FROM retours_fournisseurs WHERE id_retour = ? AND id_utilisateur = ? FOR UPDATE`,
            [id, id_utilisateur]
        );
        if (rows.length === 0) throw fail('Retour non trouvé', 404);
        const retour = rows[0];
        if (retour.destination === 'entrepot'
            && !(await CommandeAchat.estProprietaireEntrepot(retour.id_entrepot, id_utilisateur, connection))) {
            throw fail("Seul le propriétaire de l'entrepôt peut gérer les retours de cet entrepôt", 403);
        }
        return retour;
    }

    /** Annuler un retour : réintègre le stock */
    static async annuler(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour annuler');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const retour = await this._chargerPourModification(connection, id, id_utilisateur);

            if (retour.statut === 'traite') throw fail('Un retour traité ne peut pas être annulé');
            if (retour.statut === 'annule') throw fail('Ce retour est déjà annulé');

            await this._remettreEnStock(connection, retour, id_utilisateur,
                'annulation_retour_fournisseur', 'Annulation retour fournisseur');

            await connection.execute(
                `UPDATE retours_fournisseurs SET statut = 'annule' WHERE id_retour = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
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

    /** Supprimer un retour « en attente » : le stock sorti est réintégré */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour delete');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const retour = await this._chargerPourModification(connection, id, id_utilisateur);

            if (retour.statut !== 'en_attente') throw fail(`Impossible de supprimer un retour ${retour.statut}`);

            await this._remettreEnStock(connection, retour, id_utilisateur,
                'suppression_retour_fournisseur', 'Suppression retour fournisseur');

            const [result] = await connection.execute(
                `DELETE FROM retours_fournisseurs WHERE id_retour = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            await connection.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default RetourFournisseur;