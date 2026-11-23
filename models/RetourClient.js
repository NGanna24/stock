// models/RetourClient.js
import { pool } from '../config/db.js';
import { prochainNumero, prefixeDuMois } from '../utils/numerotation.js';
import MouvementStock from './MouvementStock.js';
import { nomUniteLigne } from '../utils/nomUnite.js';

class RetourClient {
    /**
     * ============================================================
     * GÉNÉRER UN NUMÉRO DE RETOUR UNIQUE PAR WORKSPACE
     * Format : RT-YYYYMM-XXXX (ex: RT-202409-0001)
     * ============================================================
     */
    static async genererNumero(id_utilisateur, db = pool) {
        return prochainNumero({ table: 'retours_clients', prefixe: prefixeDuMois('RT'), id_utilisateur, db });
    }

    /**
     * ============================================================
     * RECHERCHER DES COMMANDES POUR RETOUR
     * Recherche par n° commande, n° facture ou téléphone
     * Exclut les commandes annulées et totalement retournées
     * ============================================================
     */
    static async searchCommandes(query, id_utilisateur, joursMax = 90) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour searchCommandes');
        }

        const q = String(query || '').trim();
        if (q.length === 1) {
            return [];
        }
        // Sans texte : les 10 dernières ventes encore retournables
        const recentes = q.length === 0;
        const pattern = `%${q}%`;
        const joursInt = Math.max(1, Math.min(365, parseInt(joursMax, 10) || 90));

        const [rows] = await pool.query(
            `SELECT
                cv.id_commande,
                cv.numero_commande,
                cv.date_commande,
                cv.nomclient,
                cv.telephone,
                cv.montant_total,
                cv.statut,
                fv.id_facture,
                fv.numero_facture,
                fv.montant_total AS montant_facture,
                (SELECT COALESCE(SUM(p.montant), 0) FROM paiements p
                  WHERE p.id_facture = fv.id_facture AND p.id_utilisateur = cv.id_utilisateur) AS total_regle,
                COUNT(DISTINCT lcv.id_ligne_vente) AS nb_lignes,
                COALESCE(SUM(lcv.quantite_totale_base), 0) AS total_unites_base,
                COALESCE(SUM(lcv.quantite_retournee_base), 0) AS total_retourne_base
             FROM commandes_vente cv
             LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
             LEFT JOIN ligne_commande_vente lcv ON cv.id_commande = lcv.id_commande
             WHERE cv.id_utilisateur = ?
               AND cv.statut != 'annulee'
               AND cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL ${joursInt} DAY)
               ${recentes ? '' : `AND (
                   cv.numero_commande LIKE ?
                   OR fv.numero_facture LIKE ?
                   OR cv.telephone LIKE ?
                   OR cv.nomclient LIKE ?
               )`}
             GROUP BY cv.id_commande, fv.id_facture
             HAVING total_retourne_base < total_unites_base
             ORDER BY cv.date_commande DESC, cv.id_commande DESC
             LIMIT ${recentes ? 10 : 20}`,
            recentes ? [id_utilisateur] : [id_utilisateur, pattern, pattern, pattern, pattern]
        );

        return rows.map(r => ({
            ...r,
            nb_lignes: parseInt(r.nb_lignes) || 0,
            total_unites_base: parseFloat(r.total_unites_base) || 0,
            total_retourne_base: parseFloat(r.total_retourne_base) || 0,
            reste_a_retourner: (parseFloat(r.total_unites_base) || 0) - (parseFloat(r.total_retourne_base) || 0),
            montant_total: parseFloat(r.montant_total) || 0,
            // Ce que le client doit encore sur la facture (un retour l'annule d'abord)
            reste_du: r.id_facture ? Math.max(0, Math.round(((parseFloat(r.montant_facture) || 0) - (parseFloat(r.total_regle) || 0)) * 100) / 100) : 0,
        }));
    }

    /**
     * ============================================================
     * CRÉER UN RETOUR CLIENT (avec validation complète)
     *
     * @param {Object} data
     * @param {number} data.id_commande_vente
     * @param {string} data.motif_retour
     * @param {string} data.type_resolution
     * @param {string} data.notes
     * @param {Array}  data.lignes - [{ id_produit, id_unite_vente, nom_unite_vente, quantite_base, quantite, etat_produit }]
     * @param {number} data.id_utilisateur
     * ============================================================
     */
    static async create(data) {
        const {
            id_commande_vente,
            motif_retour,
            type_resolution = 'remboursement_especes',
            notes,
            lignes = [],
            id_utilisateur,
            // Qui enregistre le retour, et s'il a le droit de le valider tout de suite
            auteur = {},
            valider = true
        } = data;

        if (!id_utilisateur) throw new Error('id_utilisateur requis');
        if (!id_commande_vente) throw new Error('La commande est obligatoire');
        if (!motif_retour) throw new Error('Le motif est obligatoire');
        if (!lignes.length) throw new Error('Au moins un produit est requis');

        const connection = await pool.getConnection();
        let connexionRendue = false;
        try {
            await connection.beginTransaction();

            // ============================================================
            // 1. RÉCUPÉRER LA COMMANDE
            // ============================================================
            const [commandeRows] = await connection.execute(
                `SELECT cv.*, fv.id_facture, fv.numero_facture
                 FROM commandes_vente cv
                 LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                 WHERE cv.id_commande = ? AND cv.id_utilisateur = ?`,
                [id_commande_vente, id_utilisateur]
            );

            if (commandeRows.length === 0) {
                throw new Error('Commande non trouvée');
            }
            const commande = commandeRows[0];

            if (commande.statut === 'annulee') {
                throw new Error('Impossible de retourner une commande annulée');
            }

            // ============================================================
            // 2. RÉCUPÉRER LES LIGNES DE LA COMMANDE
            // ============================================================
            const [lignesCommande] = await connection.execute(
                `SELECT
                    lcv.id_ligne_vente,
                    lcv.id_produit,
                    lcv.id_unite_vente,
                    lcv.nom_unite_vente,
                    lcv.quantite_base,
                    lcv.quantite,
                    lcv.quantite_totale_base,
                    lcv.prix_vente,
                    lcv.quantite_retournee_base,
                    p.nom AS produit_nom,
                    p.quantite_stock
                 FROM ligne_commande_vente lcv
                 JOIN produits p ON lcv.id_produit = p.id_produit
                 WHERE lcv.id_commande = ?`,
                [id_commande_vente]
            );

            if (lignesCommande.length === 0) {
                throw new Error('Aucune ligne dans la commande');
            }

            // Quantités déjà demandées dans des retours qui attendent la validation du patron
            const [attente] = await connection.execute(
                `SELECT rcl.id_ligne_commande_vente AS id_ligne, COALESCE(SUM(rcl.quantite_totale_base), 0) AS q
                   FROM retour_client_lignes rcl
                   JOIN retours_clients rc ON rc.id_retour_client = rcl.id_retour_client
                  WHERE rc.id_commande_vente = ? AND rc.id_utilisateur = ?
                    AND rc.statut = 'en_attente' AND rc.effets_appliques = 0
                  GROUP BY rcl.id_ligne_commande_vente`,
                [id_commande_vente, id_utilisateur]
            );
            const enAttenteParLigne = Object.fromEntries(attente.map(a => [a.id_ligne, parseFloat(a.q) || 0]));

            // ============================================================
            // 3. VALIDER CHAQUE LIGNE DE RETOUR
            // ============================================================
            const lignesValidees = [];
            // Déjà demandé dans CE retour, par ligne vendue (plusieurs lignes du même produit)
            const demandeParLigne = {};

            for (const ligneRetour of lignes) {
                // Une vente peut contenir le même produit sur plusieurs lignes
                // (2 cartons + 5 pièces) : on vise la ligne exacte quand elle est donnée,
                // sinon (ancien écran) la première ligne de ce produit.
                const idLigne = parseInt(ligneRetour.id_ligne_vente, 10) || null;
                const ligneOrigine = (idLigne && lignesCommande.find(l => l.id_ligne_vente === idLigne))
                    || lignesCommande.find(l => l.id_produit === ligneRetour.id_produit);

                if (!ligneOrigine) {
                    throw new Error(
                        `Produit ID ${ligneRetour.id_produit} non trouvé dans la commande`
                    );
                }

                // Quantité retournée en unité de base
                const qteRetourBase =
                    parseFloat(ligneRetour.quantite) *
                    parseFloat(ligneRetour.quantite_base || 1);

                if (qteRetourBase <= 0) {
                    throw new Error(
                        `Quantité invalide pour "${ligneOrigine.produit_nom}"`
                    );
                }

                const enAttente = enAttenteParLigne[ligneOrigine.id_ligne_vente] || 0;
                const dejaRetourne = (parseFloat(ligneOrigine.quantite_retournee_base) || 0)
                    + enAttente
                    + (demandeParLigne[ligneOrigine.id_ligne_vente] || 0);
                const retournable = Math.max(0, parseFloat(ligneOrigine.quantite_totale_base) - dejaRetourne);

                if (qteRetourBase > retournable + 1e-9) {
                    throw new Error(
                        `Retour impossible pour "${ligneOrigine.produit_nom}". ` +
                        `Retournable : ${retournable} unités, demandé : ${qteRetourBase} unités` +
                        (enAttente > 0 ? ` (${enAttente} déjà dans un retour qui attend la validation du patron)` : '')
                    );
                }

                // Prix unitaire réel (prorata basé sur le prix d'achat d'origine)
                const prixUnitaireReel =
                    parseFloat(ligneOrigine.prix_vente) /
                    parseFloat(ligneOrigine.quantite_base || 1);

                const montantRembourse = qteRetourBase * prixUnitaireReel;

                demandeParLigne[ligneOrigine.id_ligne_vente] =
                    (demandeParLigne[ligneOrigine.id_ligne_vente] || 0) + qteRetourBase;

                lignesValidees.push({
                    id_produit: ligneOrigine.id_produit,
                    id_ligne_vente: ligneOrigine.id_ligne_vente,
                    id_unite_vente: ligneRetour.id_unite_vente || null,
                    nom_unite_vente: await nomUniteLigne(connection, ligneRetour.nom_unite_vente, ligneRetour.quantite_base, { id_produit: ligneOrigine.id_produit }),
                    quantite_base: parseFloat(ligneRetour.quantite_base) || 1,
                    quantite: parseFloat(ligneRetour.quantite),
                    quantite_totale_base: qteRetourBase,
                    prix_vente: parseFloat(ligneOrigine.prix_vente),
                    prix_unitaire_reel: prixUnitaireReel,
                    montant_rembourse: montantRembourse,
                    etat_produit: ligneRetour.etat_produit || 'neuf',
                    produit_nom: ligneOrigine.produit_nom
                });
            }

            // ============================================================
            // 4. CALCUL DU MONTANT TOTAL
            // ============================================================
            const montantTotal = lignesValidees.reduce(
                (sum, l) => sum + l.montant_rembourse,
                0
            );

            // ============================================================
            // 5. GÉNÉRER LE NUMÉRO DE RETOUR
            // ============================================================
            const numero_retour = await this.genererNumero(id_utilisateur, connection);

            // ============================================================
            // 6. CRÉER LE RETOUR
            // ============================================================
            const [retourResult] = await connection.execute(
                `INSERT INTO retours_clients (
                    id_utilisateur, numero_retour, date_retour,
                    id_commande_vente, id_facture,
                    nomclient, telephone,
                    statut, motif_retour, type_resolution,
                    montant_total, notes,
                    effets_appliques, cree_par_nom, id_employe_auteur
                ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'en_attente', ?, ?, ?, ?, 0, ?, ?)`,
                [
                    id_utilisateur,
                    numero_retour,
                    id_commande_vente,
                    commande.id_facture || null,
                    commande.nomclient,
                    commande.telephone,
                    motif_retour,
                    type_resolution,
                    montantTotal,
                    notes || null,
                    auteur.nom ? String(auteur.nom).slice(0, 120) : null,
                    auteur.id_employe || null
                ]
            );

            const id_retour = retourResult.insertId;

            // ============================================================
            // 7. CRÉER LES LIGNES + RÉINTÉGRER LE STOCK
            // ============================================================
            for (const ligne of lignesValidees) {
                // 7a. Insérer la ligne de retour
                await connection.execute(
                    `INSERT INTO retour_client_lignes (
                        id_retour_client, id_produit, id_ligne_commande_vente,
                        id_unite_vente, nom_unite_vente,
                        quantite_base, quantite, quantite_totale_base,
                        prix_vente, prix_remboursement, remise,
                        motif_retour, etat_produit
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                    [
                        id_retour,
                        ligne.id_produit,
                        ligne.id_ligne_vente,
                        ligne.id_unite_vente,
                        ligne.nom_unite_vente,
                        ligne.quantite_base,
                        ligne.quantite,
                        ligne.quantite_totale_base,
                        ligne.prix_vente,
                        ligne.prix_unitaire_reel,
                        motif_retour,
                        ligne.etat_produit
                    ]
                );
            }

            // Avec le droit de valider : le retour s'applique tout de suite (stock, facture, espèces).
            // Sinon il attend le patron ; rien ne bouge avant sa validation.
            if (valider) {
                await this.appliquerEffets(connection, {
                    id_retour, numero_retour, commande, lignesValidees, type_resolution,
                    montantTotal, id_utilisateur, valide_par_nom: auteur.nom || null,
                });
            }

            await connection.commit();

            connection.release(); // rendue au pool AVANT la relecture (sinon blocage quand le pool est plein)

            connexionRendue = true;

            return await this.findById(id_retour, id_utilisateur);

        } catch (error) {
            if (!connexionRendue) await connection.rollback();
            throw error;
        } finally {
            if (!connexionRendue) connection.release();
        }
    }

    /**
     * ============================================================
     * APPLIQUER UN RETOUR : stock, compteur de la vente, facture, espèces rendues
     * (à la création si l'auteur peut valider, sinon à la validation du patron)
     * ============================================================
     */
    static async appliquerEffets(connection, { id_retour, numero_retour, commande, lignesValidees, type_resolution, montantTotal, id_utilisateur, valide_par_nom }) {
        // ============================================================
        // 4b. RÉPARTITION : d'abord ce que le client doit encore, puis les espèces
        //     Ex : facture 147 500, payé 100 000, retour 70 000
        //       -> la facture ne vaut plus que 77 500 : 22 500 lui sont rendus.
        //     Ex : facture 147 500, rien payé, retour 76 500
        //       -> il ne doit plus que 71 000, aucune espèce rendue.
        // ============================================================
        let deduit = 0;
        let especes = 0;
        if (commande.id_facture && ['remboursement_especes', 'avoir'].includes(type_resolution)) {
            const [[fac]] = await connection.execute(
                'SELECT montant_total FROM factures_vente WHERE id_facture = ? AND id_utilisateur = ? FOR UPDATE',
                [commande.id_facture, id_utilisateur]
            );
            const [[reg]] = await connection.execute(
                'SELECT COALESCE(SUM(montant), 0) AS regle FROM paiements WHERE id_facture = ? AND id_utilisateur = ?',
                [commande.id_facture, id_utilisateur]
            );
            const r2 = (n) => Math.round(n * 100) / 100;
            const resteDu = Math.max(0, r2((parseFloat(fac?.montant_total) || 0) - (parseFloat(reg.regle) || 0)));
            if (type_resolution === 'remboursement_especes') {
                // Toute la valeur rapportée est retirée de la facture ; ce qui avait été payé en trop est rendu
                deduit = r2(montantTotal);
                especes = r2(Math.max(0, montantTotal - resteDu));
            } else {
                // Type « avoir » : on n'annule que la dette, le surplus reste un avoir chez le commerçant
                deduit = r2(Math.min(montantTotal, resteDu));
                especes = 0;
            }
        }
        const statutRetour = especes > 0.009 ? 'rembourse' : 'accepte';

        for (const ligne of lignesValidees) {
            // 7b. Mettre à jour le compteur sur la ligne d'origine
            await connection.execute(
                `UPDATE ligne_commande_vente
                 SET quantite_retournee_base = quantite_retournee_base + ?
                 WHERE id_ligne_vente = ?`,
                [ligne.quantite_totale_base, ligne.id_ligne_vente]
            );

            // 7c. Réintégrer le stock SI le produit est neuf
            if (ligne.etat_produit === 'neuf') {
                await connection.execute(
                    `UPDATE produits
                     SET quantite_stock = quantite_stock + ?
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [ligne.quantite_totale_base, ligne.id_produit, id_utilisateur]
                );

                // 7d. Enregistrer l'entrée de stock
                // Une référence par ligne vendue : le même produit peut revenir sur 2 lignes
                // (cartons + pièces) dans un seul retour
                const refEntree = lignesValidees.filter(x => x.id_produit === ligne.id_produit).length > 1
                    ? `ENTREE-RETOUR-${numero_retour}-${ligne.id_produit}-${ligne.id_ligne_vente}`
                    : `ENTREE-RETOUR-${numero_retour}-${ligne.id_produit}`;
                await connection.execute(
                    `INSERT INTO entrees_stock (
                        id_utilisateur, reference, date_entree, id_produit,
                        id_unite_vente, nom_unite_vente, quantite_base,
                        quantite, quantite_totale_base, notes
                    ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id_utilisateur,
                        refEntree,
                        ligne.id_produit,
                        ligne.id_unite_vente,
                        ligne.nom_unite_vente,
                        ligne.quantite_base,
                        ligne.quantite,
                        ligne.quantite_totale_base,
                        `Retour client ${numero_retour}`
                    ]
                );

                // 7e. Mouvement de stock centralisé
                await MouvementStock.enregistrer({
                    id_produit: ligne.id_produit,
                    type_mouvement: 'entree',
                    quantite: ligne.quantite_totale_base,
                    id_reference: id_retour,
                    type_reference: 'retour_client',
                    id_utilisateur,
                    notes: `Retour ${numero_retour}`
                }, connection, id_utilisateur);
            }
        }

        // ============================================================
        // 8. RÈGLEMENT DU RETOUR
        //    - la part qui annule la dette : ligne « avoir » (pas d'argent qui bouge)
        //    - la part payée en trop : remboursement en espèces (paiement négatif)
        // ============================================================
        if (commande.id_facture && deduit > 0.009) {
            await connection.execute(
                `INSERT INTO paiements (
                    id_utilisateur, id_facture, date_paiement,
                    montant, mode_paiement, note, reference
                ) VALUES (?, ?, CURDATE(), ?, 'avoir', ?, ?)`,
                [id_utilisateur, commande.id_facture, deduit, `Retour ${numero_retour} déduit de la facture`, numero_retour]
            );
        }
        if (commande.id_facture && especes > 0.009) {
            await connection.execute(
                `INSERT INTO paiements (
                    id_utilisateur, id_facture, date_paiement,
                    montant, mode_paiement, note, reference
                ) VALUES (?, ?, CURDATE(), ?, 'especes', ?, ?)`,
                [id_utilisateur, commande.id_facture, -especes, `Remboursement retour ${numero_retour}`, numero_retour]
            );
        }
        if (commande.id_facture && (deduit > 0.009 || especes > 0.009)) {
            // Statut de la facture recalculé
            const [[f2]] = await connection.execute(
                `SELECT f.montant_total, COALESCE(SUM(p.montant), 0) AS regle
                   FROM factures_vente f LEFT JOIN paiements p ON p.id_facture = f.id_facture AND p.id_utilisateur = f.id_utilisateur
                  WHERE f.id_facture = ? AND f.id_utilisateur = ? GROUP BY f.id_facture`,
                [commande.id_facture, id_utilisateur]
            );
            if (f2) {
                const reste = (parseFloat(f2.montant_total) || 0) - (parseFloat(f2.regle) || 0);
                const regle = parseFloat(f2.regle) || 0;
                const statutFacture = reste <= 0.009 ? 'payee' : regle > 0.009 ? 'partiellement_payee' : 'en_attente';
                await connection.execute(
                    `UPDATE factures_vente SET statut = ? WHERE id_facture = ? AND id_utilisateur = ? AND statut <> 'annulee'`,
                    [statutFacture, commande.id_facture, id_utilisateur]
                );
            }
        }

        await connection.execute(
            `UPDATE retours_clients
                SET statut = ?, effets_appliques = 1, date_traitement = NOW(), date_validation = NOW(), valide_par_nom = ?
              WHERE id_retour_client = ? AND id_utilisateur = ?`,
            [statutRetour, valide_par_nom ? String(valide_par_nom).slice(0, 120) : null, id_retour, id_utilisateur]
        );
        return { statut: statutRetour, deduit, especes };
    }

    /**
     * ============================================================
     * VALIDER UN RETOUR EN ATTENTE (patron ou rôle autorisé)
     * ============================================================
     */
    static async approuver(id, id_utilisateur, valide_par_nom = null) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');
        const connection = await pool.getConnection();
        let connexionRendue = false;
        try {
            await connection.beginTransaction();
            const [[retour]] = await connection.execute(
                `SELECT * FROM retours_clients WHERE id_retour_client = ? AND id_utilisateur = ? FOR UPDATE`,
                [id, id_utilisateur]
            );
            if (!retour) throw new Error('Retour non trouvé');
            if (retour.statut !== 'en_attente' || Number(retour.effets_appliques) === 1) {
                throw new Error("Ce retour n'attend plus de validation");
            }
            const [[commande]] = await connection.execute(
                `SELECT cv.*, fv.id_facture, fv.numero_facture
                   FROM commandes_vente cv
                   LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
                  WHERE cv.id_commande = ? AND cv.id_utilisateur = ?`,
                [retour.id_commande_vente, id_utilisateur]
            );
            if (!commande) throw new Error('La vente de ce retour est introuvable');
            if (commande.statut === 'annulee') throw new Error('La vente a été annulée entre-temps : refusez ce retour');

            const [lignes] = await connection.execute(
                `SELECT rcl.*, p.nom AS produit_nom,
                        lcv.quantite_totale_base AS vendu_base, lcv.quantite_retournee_base AS retourne_base
                   FROM retour_client_lignes rcl
                   JOIN produits p ON p.id_produit = rcl.id_produit
                   LEFT JOIN ligne_commande_vente lcv ON lcv.id_ligne_vente = rcl.id_ligne_commande_vente
                  WHERE rcl.id_retour_client = ?
                  FOR UPDATE`,
                [id]
            );
            if (!lignes.length) throw new Error('Ce retour ne contient aucun article');

            const demande = {};
            const lignesValidees = lignes.map((l) => {
                const q = parseFloat(l.quantite_totale_base) || 0;
                demande[l.id_ligne_commande_vente] = (demande[l.id_ligne_commande_vente] || 0) + q;
                const reste = (parseFloat(l.vendu_base) || 0) - (parseFloat(l.retourne_base) || 0);
                if (demande[l.id_ligne_commande_vente] > reste + 1e-9) {
                    throw new Error(`"${l.produit_nom}" : il ne reste que ${Math.max(0, reste)} unités qui peuvent revenir sur cette vente`);
                }
                const prixBase = parseFloat(l.prix_remboursement) || 0;
                return {
                    id_produit: l.id_produit,
                    id_ligne_vente: l.id_ligne_commande_vente,
                    id_unite_vente: l.id_unite_vente,
                    nom_unite_vente: l.nom_unite_vente,
                    quantite_base: parseFloat(l.quantite_base) || 1,
                    quantite: parseFloat(l.quantite) || 0,
                    quantite_totale_base: q,
                    prix_unitaire_reel: prixBase,
                    montant_rembourse: q * prixBase,
                    etat_produit: l.etat_produit || 'neuf',
                    produit_nom: l.produit_nom,
                };
            });
            // Montant calculé à la demande (même arrondi que ce que la caissière a vu)
            const montantTotal = parseFloat(retour.montant_total) || lignesValidees.reduce((s2, l) => s2 + l.montant_rembourse, 0);

            const resultat = await this.appliquerEffets(connection, {
                id_retour: retour.id_retour_client,
                numero_retour: retour.numero_retour,
                commande,
                lignesValidees,
                type_resolution: retour.type_resolution,
                montantTotal,
                id_utilisateur,
                valide_par_nom,
            });
            await connection.commit();
            connection.release();
            connexionRendue = true;
            return { ...(await this.findById(id, id_utilisateur)), ...resultat };
        } catch (error) {
            if (!connexionRendue) await connection.rollback();
            throw error;
        } finally {
            if (!connexionRendue) connection.release();
        }
    }

    /**
     * ============================================================
     * REFUSER UN RETOUR EN ATTENTE : rien n'a bougé, rien à défaire
     * ============================================================
     */
    static async refuser(id, id_utilisateur, { par = null, motif = null } = {}) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');
        const [r] = await pool.execute(
            `UPDATE retours_clients
                SET statut = 'refuse', date_traitement = NOW(), date_validation = NOW(),
                    valide_par_nom = ?, motif_refus = ?
              WHERE id_retour_client = ? AND id_utilisateur = ?
                AND statut = 'en_attente' AND effets_appliques = 0`,
            [par ? String(par).slice(0, 120) : null, motif ? String(motif).trim().slice(0, 255) || null : null, id, id_utilisateur]
        );
        if (!r.affectedRows) throw new Error("Ce retour n'attend plus de validation");
        return this.findById(id, id_utilisateur);
    }

    /**
     * ============================================================
     * RÉCUPÉRER UN RETOUR COMPLET PAR ID
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        const [rows] = await pool.execute(
            `SELECT
                rc.*,
                cv.numero_commande,
                cv.date_commande,
                fv.numero_facture,
                fv.date_facture,
                fv.statut AS statut_facture,
                COALESCE(rc.cree_par_nom, u.fullname) AS utilisateur_nom
             FROM retours_clients rc
             LEFT JOIN commandes_vente cv ON rc.id_commande_vente = cv.id_commande
             LEFT JOIN factures_vente fv ON rc.id_facture = fv.id_facture
             LEFT JOIN utilisateurs u ON rc.id_utilisateur = u.id_utilisateur
             WHERE rc.id_retour_client = ? AND rc.id_utilisateur = ?`,
            [id, id_utilisateur]
        );

        if (rows.length === 0) return null;
        const retour = rows[0];

        // Lignes du retour
        const [lignes] = await pool.execute(
            `SELECT
                rcl.*,
                p.nom AS produit_nom,
                p.description AS produit_description,
                m.nom AS marque_nom,
                uv.nom AS unite_vente_nom
             FROM retour_client_lignes rcl
             LEFT JOIN produits p ON rcl.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites_vente uv ON rcl.id_unite_vente = uv.id_unite_vente
             WHERE rcl.id_retour_client = ?`,
            [id]
        );

        retour.lignes = lignes.map(l => ({
            ...l,
            quantite: parseFloat(l.quantite) || 0,
            quantite_base: parseFloat(l.quantite_base) || 1,
            quantite_totale_base: parseFloat(l.quantite_totale_base) || 0,
            prix_vente: parseFloat(l.prix_vente) || 0,
            prix_remboursement: parseFloat(l.prix_remboursement) || 0,
            montant_total: parseFloat(l.montant_total) || 0
        }));

        retour.montant_total = parseFloat(retour.montant_total) || 0;

        // Comment le retour a été réglé
        const [reglement] = await pool.execute(
            `SELECT COALESCE(SUM(CASE WHEN mode_paiement = 'avoir' AND montant > 0 THEN montant ELSE 0 END), 0) AS deduit,
                    COALESCE(SUM(CASE WHEN montant < 0 THEN -montant ELSE 0 END), 0) AS especes
               FROM paiements WHERE id_utilisateur = ? AND id_facture = ? AND reference = ?`,
            [id_utilisateur, retour.id_facture || 0, retour.numero_retour]
        );
        // Part qui a annulé ce que le client devait, et part rendue en espèces
        retour.montant_rendu = parseFloat(reglement[0]?.especes) || 0;
        retour.montant_deduit = Math.max(0, (parseFloat(reglement[0]?.deduit) || 0) - retour.montant_rendu);

        return retour;
    }

    /**
     * ============================================================
     * RÉCUPÉRER TOUS LES RETOURS (avec filtres)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        let query = `
            SELECT
                rc.*,
                cv.numero_commande,
                cv.date_commande,
                fv.numero_facture,
                COALESCE(rc.cree_par_nom, u.fullname) AS utilisateur_nom,
                (SELECT COUNT(*) FROM retour_client_lignes rcl
                 WHERE rcl.id_retour_client = rc.id_retour_client) AS nb_lignes
            FROM retours_clients rc
            LEFT JOIN commandes_vente cv ON rc.id_commande_vente = cv.id_commande
            LEFT JOIN factures_vente fv ON rc.id_facture = fv.id_facture
            LEFT JOIN utilisateurs u ON rc.id_utilisateur = u.id_utilisateur
            WHERE rc.id_utilisateur = ?
        `;
        const params = [id_utilisateur];

        if (filters.search) {
            query += ` AND (
                rc.numero_retour LIKE ?
                OR cv.numero_commande LIKE ?
                OR rc.nomclient LIKE ?
                OR rc.telephone LIKE ?
            )`;
            const s = `%${filters.search}%`;
            params.push(s, s, s, s);
        }

        if (filters.statut) {
            query += ' AND rc.statut = ?';
            params.push(filters.statut);
        }

        if (filters.type_resolution) {
            query += ' AND rc.type_resolution = ?';
            params.push(filters.type_resolution);
        }

        if (filters.date_debut) {
            query += ' AND rc.date_retour >= ?';
            params.push(filters.date_debut);
        }

        if (filters.date_fin) {
            query += ' AND rc.date_retour <= ?';
            params.push(filters.date_fin);
        }

        query += ' ORDER BY rc.date_retour DESC, rc.id_retour_client DESC';

        if (filters.limit) {
            const limit = Math.min(parseInt(filters.limit) || 50, 500);
            query += ` LIMIT ${limit}`;

            if (filters.offset) {
                const offset = Math.max(parseInt(filters.offset) || 0, 0);
                query += ` OFFSET ${offset}`;
            }
        }

        const [rows] = await pool.query(query, params);

        return rows.map(r => ({
            ...r,
            montant_total: parseFloat(r.montant_total) || 0,
            nb_lignes: parseInt(r.nb_lignes) || 0
        }));
    }

    /**
     * ============================================================
     * ANNULER UN RETOUR (réintégration inversée)
     * ============================================================
     */
    static async annuler(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [rows] = await connection.execute(
                `SELECT rc.statut, rc.numero_retour, rc.id_facture, rc.effets_appliques, cv.statut AS statut_vente
                 FROM retours_clients rc
                 LEFT JOIN commandes_vente cv ON cv.id_commande = rc.id_commande_vente
                 WHERE rc.id_retour_client = ? AND rc.id_utilisateur = ?
                 FOR UPDATE`,
                [id, id_utilisateur]
            );

            if (rows.length === 0) throw new Error('Retour non trouvé');
            const retour = rows[0];
            if (retour.statut === 'annule') throw new Error('Retour déjà annulé');
            if (retour.statut === 'refuse') throw new Error('Ce retour a été refusé : il n\'y a rien à annuler');

            // Retour qui attendait le patron : rien n'avait bougé, on le classe simplement
            if (Number(retour.effets_appliques) === 0) {
                await connection.execute(
                    `UPDATE retours_clients SET statut = 'annule', date_traitement = NOW()
                      WHERE id_retour_client = ? AND id_utilisateur = ?`,
                    [id, id_utilisateur]
                );
                await connection.commit();
                return true;
            }
            // La vente annulée a déjà remboursé le client en tenant compte de ce retour
            if (retour.statut_vente === 'annulee') {
                throw new Error('La vente de ce retour a été annulée : le retour ne peut plus être annulé');
            }

            const [lignes] = await connection.execute(
                `SELECT * FROM retour_client_lignes WHERE id_retour_client = ?`,
                [id]
            );

            for (const ligne of lignes) {
                const qteBase = parseFloat(ligne.quantite_totale_base) || 0;

                // Décrémenter le compteur sur la ligne d'origine
                if (ligne.id_ligne_commande_vente) {
                    await connection.execute(
                        `UPDATE ligne_commande_vente
                         SET quantite_retournee_base = quantite_retournee_base - ?
                         WHERE id_ligne_vente = ?`,
                        [qteBase, ligne.id_ligne_commande_vente]
                    );
                }

                // Retirer du stock (si réintégré)
                if (ligne.etat_produit === 'neuf') {
                    await connection.execute(
                        `UPDATE produits
                         SET quantite_stock = quantite_stock - ?
                         WHERE id_produit = ? AND id_utilisateur = ?`,
                        [qteBase, ligne.id_produit, id_utilisateur]
                    );

                    await MouvementStock.enregistrer({
                        id_produit: ligne.id_produit,
                        type_mouvement: 'sortie',
                        quantite: qteBase,
                        id_reference: id,
                        type_reference: 'retour_client_annule',
                        id_utilisateur,
                        notes: `Annulation retour #${id}`
                    }, connection, id_utilisateur);
                }
            }

            // Le retour n'a finalement pas eu lieu : son remboursement ne compte plus
            // dans les recettes ni dans la caisse
            if (retour.id_facture) {
                await connection.execute(
                    `DELETE FROM paiements
                     WHERE id_facture = ? AND id_utilisateur = ? AND reference = ?
                       AND (montant < 0 OR mode_paiement = 'avoir')`,
                    [retour.id_facture, id_utilisateur, retour.numero_retour]
                );
                const [[f2]] = await connection.execute(
                    `SELECT f.montant_total, f.statut, COALESCE(SUM(p.montant), 0) AS regle
                       FROM factures_vente f LEFT JOIN paiements p ON p.id_facture = f.id_facture AND p.id_utilisateur = f.id_utilisateur
                      WHERE f.id_facture = ? AND f.id_utilisateur = ? GROUP BY f.id_facture`,
                    [retour.id_facture, id_utilisateur]
                );
                if (f2 && f2.statut !== 'annulee') {
                    const reste = (parseFloat(f2.montant_total) || 0) - (parseFloat(f2.regle) || 0);
                    const regle = parseFloat(f2.regle) || 0;
                    await connection.execute(
                        'UPDATE factures_vente SET statut = ? WHERE id_facture = ? AND id_utilisateur = ?',
                        [reste <= 0.009 ? 'payee' : regle > 0.009 ? 'partiellement_payee' : 'en_attente', retour.id_facture, id_utilisateur]
                    );
                }
            }

            await connection.execute(
                `UPDATE retours_clients
                 SET statut = 'annule', date_traitement = NOW()
                 WHERE id_retour_client = ? AND id_utilisateur = ?`,
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

    /**
     * ============================================================
     * STATISTIQUES DES RETOURS
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) AS en_attente,
                SUM(CASE WHEN statut = 'accepte' THEN 1 ELSE 0 END) AS accepte,
                SUM(CASE WHEN statut = 'refuse' THEN 1 ELSE 0 END) AS refuse,
                SUM(CASE WHEN statut = 'rembourse' THEN 1 ELSE 0 END) AS rembourse,
                SUM(CASE WHEN statut = 'annule' THEN 1 ELSE 0 END) AS annule,
                -- seuls les retours validés comptent (annulés, refusés et en attente : rien n'a été rendu)
                COALESCE(SUM(CASE WHEN statut NOT IN ('annule', 'refuse', 'en_attente') THEN montant_total ELSE 0 END), 0) AS montant_total,
                COALESCE(SUM(CASE WHEN statut = 'en_attente' THEN montant_total ELSE 0 END), 0) AS montant_en_attente
             FROM retours_clients
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            en_attente: parseInt(s.en_attente) || 0,
            accepte: parseInt(s.accepte) || 0,
            refuse: parseInt(s.refuse) || 0,
            rembourse: parseInt(s.rembourse) || 0,
            annule: parseInt(s.annule) || 0,
            montant_total: parseFloat(s.montant_total) || 0,
            montant_en_attente: parseFloat(s.montant_en_attente) || 0
        };
    }
}

export default RetourClient;