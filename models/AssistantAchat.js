// models/AssistantAchat.js
import { pool } from '../config/db.js';
import CommandeAchat from './CommandeAchat.js';

class AssistantAchat {
    /**
     * ============================================================
     * NIVEAUX DE COUVERTURE (en jours)
     * ============================================================
     */
    static NIVEAUX = {
        urgent: { jours: 7,  label: 'Urgent',  description: 'Couvrir 7 jours' },
        normal: { jours: 15, label: 'Normal',  description: 'Couvrir 15 jours' },
        large:  { jours: 30, label: 'Large',   description: 'Couvrir 30 jours' },
    };

    /**
     * ============================================================
     * ✅ GÉNÉRER LA PROPOSITION DE RÉAPPROVISIONNEMENT (v4)
     * ============================================================
     * ⚠️ NOUVEAU : renvoie TOUTES les unités de vente de chaque produit
     *              (pour permettre le choix via StockSelector)
     */
    static async getProposition(id_utilisateur, options = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getProposition');
        }

        const { destination, id_entrepot } = CommandeAchat.scope(options.destination, options.id_entrepot);
        if (destination === 'entrepot') {
            const ok = await CommandeAchat.estProprietaireEntrepot(id_entrepot, id_utilisateur);
            if (!ok) {
                const err = new Error('Seul le propriétaire de l\'entrepôt peut utiliser l\'assistant pour cet entrepôt');
                err.statusCode = 403;
                throw err;
            }
            return this._getPropositionEntrepot(id_utilisateur, id_entrepot, options);
        }

        // ============================================================
        // 🔑 ÉTAPE 1 : Récupérer les QUANTITÉS EN COMMANDE
        // ============================================================
        const [enCommandeRaw] = await pool.execute(
            `SELECT
                lca.id_produit,
                COALESCE(SUM(
                    CASE 
                        WHEN lca.quantite_totale_base > 0 
                            THEN lca.quantite_totale_base
                        WHEN lca.quantite_base > 0
                            THEN lca.quantite * lca.quantite_base
                        ELSE lca.quantite
                    END
                ), 0) AS total_en_commande_base
             FROM ligne_commande_achat lca
             JOIN commandes_achat ca ON lca.id_commande_achat = ca.id_commande_achat
             WHERE ca.id_utilisateur = ?
               AND lca.id_produit IS NOT NULL
               AND ca.statut IN ('en_attente', 'envoyee', 'partiellement_recue')
             GROUP BY lca.id_produit`,
            [id_utilisateur]
        );

        const enCommandeMap = new Map();
        enCommandeRaw.forEach(r => {
            enCommandeMap.set(
                r.id_produit,
                parseFloat(r.total_en_commande_base) || 0
            );
        });

        // ============================================================
        // 🔑 ÉTAPE 2 : Récupérer TOUS les produits
        // ============================================================
        const [produits] = await pool.execute(
            `SELECT
                p.id_produit,
                p.nom AS produit_nom,
                p.id_fournisseur,
                p.quantite_stock,
                p.quantite_minimale,
                p.quantite_maximale,
                p.prix_achat AS produit_prix_achat,
                p.prix_vente AS produit_prix_vente,
                p.statut,
                p.id_marque, p.id_modele,
                mo.nom AS modele_nom,
                m.nom AS marque_nom,
                u.symbole AS unite_symbole,
                u.nom AS unite_nom,
                f.id_fournisseur,
                f.nom AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                f.email AS fournisseur_email,
                f.ville AS fournisseur_ville
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN modeles mo ON p.id_modele = mo.id_modele
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             WHERE p.id_utilisateur = ?
             ORDER BY f.nom ASC, p.nom ASC`,
            [id_utilisateur]
        );

        // ============================================================
        // 🔑 ÉTAPE 3 : Filtrer avec le STOCK PRÉVISIONNEL
        // ============================================================
        const produitsAFiltre = produits.filter(p => {
            const stock = parseFloat(p.quantite_stock) || 0;
            const min = parseFloat(p.quantite_minimale) || 0;
            const enCommande = enCommandeMap.get(p.id_produit) || 0;

            const stockPrevisionnel = stock + enCommande;

            return stockPrevisionnel <= 0 || stockPrevisionnel <= min;
        });

        if (produitsAFiltre.length === 0) {
            return {
                niveaux: this.NIVEAUX,
                niveau_actif: options.niveau || 'normal',
                fournisseurs: [],
                total_produits: 0,
                total_fournisseurs: 0,
                total_estime: 0,
                destination: 'magasin',
                transferts: [],
                produits: [],
            };
        }

        // ============================================================
        // 🔑 ÉTAPE 3.5 : Charger TOUTES les unités de vente
        // ============================================================
        const idsProduitsPourUnites = produitsAFiltre.map(p => p.id_produit);
        const placeholdersUnites = idsProduitsPourUnites.map(() => '?').join(',');

        let unitesParProduit = {};
        if (idsProduitsPourUnites.length > 0) {
            const [allUnites] = await pool.execute(
                `SELECT id_unite_vente, id_produit, nom, quantite_base,
                        prix_vente, prix_achat, est_principal
                 FROM unites_vente
                 WHERE id_produit IN (${placeholdersUnites})
                   AND actif = TRUE
                 ORDER BY est_principal DESC, quantite_base ASC`,
                idsProduitsPourUnites
            );

            allUnites.forEach(u => {
                if (!unitesParProduit[u.id_produit]) {
                    unitesParProduit[u.id_produit] = [];
                }
                unitesParProduit[u.id_produit].push({
                    id_unite_vente: u.id_unite_vente,
                    nom: u.nom,
                    quantite_base: parseFloat(u.quantite_base) || 1,
                    prix_vente: parseFloat(u.prix_vente) || 0,
                    prix_achat: parseFloat(u.prix_achat) || 0,
                    est_principal: u.est_principal === 1 || u.est_principal === true,
                });
            });
        }

        // ============================================================
        // 🔑 ÉTAPE 4 : Ventes 30j
        // ============================================================
        const idsProduits = produitsAFiltre.map(p => p.id_produit);
        const placeholders = idsProduits.map(() => '?').join(',');

        let ventesMap = new Map();
        if (idsProduits.length > 0) {
            const [ventes30j] = await pool.execute(
                `SELECT
                    lcv.id_produit,
                    COALESCE(SUM(lcv.quantite_totale_base), 0) AS total_vendu_base,
                    COUNT(DISTINCT cv.id_commande) AS nb_commandes
                 FROM ligne_commande_vente lcv
                 JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
                 WHERE lcv.id_produit IN (${placeholders})
                   AND cv.id_utilisateur = ?
                   AND cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                   AND cv.statut != 'annulee'
                 GROUP BY lcv.id_produit`,
                [...idsProduits, id_utilisateur]
            );

            ventes30j.forEach(v => {
                ventesMap.set(v.id_produit, {
                    total_vendu_base: parseFloat(v.total_vendu_base) || 0,
                    nb_commandes: parseInt(v.nb_commandes) || 0,
                });
            });
        }

        // ============================================================
        // 🔑 ÉTAPE 5 : Calcul de la proposition par produit
        // ============================================================
        const niveau = options.niveau || 'normal';
        const joursCouverture = this.NIVEAUX[niveau]?.jours || 15;

        const produitsAvecProposition = produitsAFiltre.map(p => {
            const stock = parseFloat(p.quantite_stock) || 0;
            const min = parseFloat(p.quantite_minimale) || 0;
            const max = parseFloat(p.quantite_maximale) || 0;
            const enCommande = enCommandeMap.get(p.id_produit) || 0;

            const stockPrevisionnel = stock + enCommande;

            const vente = ventesMap.get(p.id_produit) || { total_vendu_base: 0, nb_commandes: 0 };
            const vitesse = vente.total_vendu_base / 30;

            // --- 3 besoins ---
            const besoinCouverture = Math.max(0, (vitesse * joursCouverture) - stockPrevisionnel);
            const besoinMax = max > 0 ? Math.max(0, max - stockPrevisionnel) : 0;
            const besoinMin = min > 0 ? Math.max(0, (min * 2) - stockPrevisionnel) : 0;

            let besoinBase = Math.max(besoinCouverture, besoinMax, besoinMin);
            if (besoinBase <= 0) {
                besoinBase = Math.max(0, min - stockPrevisionnel);
            }

            const besoinArrondi = Math.max(1, Math.ceil(besoinBase));

            // --- Unités de vente du produit ---
            const unitesProduit = unitesParProduit[p.id_produit] || [];

            // L'unité proposée = l'unité principale, sinon la 1ère non-base
            const uvPrincipale =
                unitesProduit.find(u => u.est_principal) ||
                unitesProduit[0] ||
                null;

            const uv = uvPrincipale
                ? {
                    id_unite_vente: uvPrincipale.id_unite_vente,
                    nom: uvPrincipale.nom,
                    quantite_base: uvPrincipale.quantite_base,
                    prix_achat: uvPrincipale.prix_achat !== null
                        ? uvPrincipale.prix_achat
                        : null,
                }
                : null;

            const qteBaseParUV = uv?.quantite_base || 1;

            const qteUV = Math.max(1, Math.ceil(besoinArrondi / qteBaseParUV));
            const qteTotaleBase = qteUV * qteBaseParUV;

            const prixUnitaire = uv?.prix_achat || p.produit_prix_achat || null;
            const prixTotal = prixUnitaire ? qteUV * prixUnitaire : null;

            const typeAlerte = stockPrevisionnel <= 0 ? 'rupture' : 'stock_bas';

            return {
                id_produit: p.id_produit,
                produit_nom: p.produit_nom,
                marque_nom: p.marque_nom,

                quantite_stock: stock,
                quantite_minimale: min,
                quantite_maximale: max,
                quantite_en_commande: enCommande,
                stock_previsionnel: stockPrevisionnel,

                ventes_30j_base: vente.total_vendu_base,
                nb_commandes_30j: vente.nb_commandes,
                vitesse_jour: parseFloat(vitesse.toFixed(2)),

                besoin_base: besoinArrondi,

                // ✅ Toutes les unités de vente du produit
                unites_vente: unitesProduit,

                // ✅ Unité principale (pour pré-remplir)
                unite_proposee: uv
                    ? {
                        id_unite_vente: uv.id_unite_vente,
                        nom: uv.nom,
                        quantite_base: uv.quantite_base,
                    }
                    : null,
                quantite_proposee_uv: qteUV,
                quantite_proposee_base: qteTotaleBase,

                prix_unitaire: prixUnitaire,
                prix_total: prixTotal,
                prix_connu: prixUnitaire !== null,

                unite_base_nom: p.unite_nom || 'Unité',
                unite_base_symbole: p.unite_symbole || '',

                type_alerte: typeAlerte,
            };
        });

        // ============================================================
        // 🔑 ÉTAPE 5.5 : Vérifier d'abord l'ENTREPÔT
        // ============================================================
        // Un produit en rupture / stock bas à la boutique mais disponible dans un entrepôt
        // auquel le compte a accès doit être TRANSFÉRÉ, pas commandé.
        const transferts = await this._chercherDansEntrepots(id_utilisateur, produitsAFiltre, produitsAvecProposition);

        const produitsACommander = [];
        for (const p of produitsAvecProposition) {
            const t = transferts.get(p.id_produit);
            if (!t) { produitsACommander.push(p); continue; }
            const restant = p.besoin_base - t.quantite_proposee_base;
            if (restant > 0) {
                const qb = p.unite_proposee?.quantite_base || 1;
                const qteUV = Math.max(1, Math.ceil(restant / qb));
                p.besoin_base = restant;
                p.quantite_proposee_uv = qteUV;
                p.quantite_proposee_base = qteUV * qb;
                p.prix_total = p.prix_unitaire ? qteUV * p.prix_unitaire : null;
                produitsACommander.push(p);
            }
        }
        const listeTransferts = Array.from(transferts.values());

        // ============================================================
        // 🔑 ÉTAPE 6 : Grouper par fournisseur
        // ============================================================
        const groupesMap = new Map();
        produitsACommander.forEach(p => {
            const produit = produitsAFiltre.find(x => x.id_produit === p.id_produit);
            const idFournisseur = produit?.id_fournisseur || null;
            const key = idFournisseur || 'sans_fournisseur';

            if (!groupesMap.has(key)) {
                groupesMap.set(key, {
                    id_fournisseur: idFournisseur,
                    fournisseur_nom: produit?.fournisseur_nom || 'Sans fournisseur',
                    fournisseur_telephone: produit?.fournisseur_telephone || null,
                    fournisseur_email: produit?.fournisseur_email || null,
                    fournisseur_ville: produit?.fournisseur_ville || null,
                    produits: [],
                    total_estime: 0,
                    nb_prix_connus: 0,
                    nb_prix_inconnus: 0,
                });
            }

            const groupe = groupesMap.get(key);
            groupe.produits.push(p);
            if (p.prix_total) {
                groupe.total_estime += p.prix_total;
                groupe.nb_prix_connus += 1;
            } else {
                groupe.nb_prix_inconnus += 1;
            }
        });

        const fournisseurs = Array.from(groupesMap.values()).sort((a, b) =>
            (a.fournisseur_nom || '').localeCompare(b.fournisseur_nom || '')
        );

        const totalEstime = fournisseurs.reduce((s, f) => s + f.total_estime, 0);

        return {
            niveaux: this.NIVEAUX,
            niveau_actif: niveau,
            jours_couverture: joursCouverture,
            fournisseurs,
            destination: 'magasin',
            transferts: listeTransferts,
            total_produits: produitsAvecProposition.length,
            total_fournisseurs: fournisseurs.length,
            total_estime: totalEstime,
            produits: produitsACommander,
        };
    }

    /**
     * Normalisation pour comparer nom / marque / modèle / unité entre catalogues
     */
    static _norm(v) {
        return String(v ?? '').trim().toLowerCase();
    }

    /**
     * ============================================================
     * Cherche, dans les entrepôts accessibles au compte (propriétaire ou membre),
     * le stock des produits à réapprovisionner.
     * Correspondance : même nom + même marque + même modèle + même unité de base
     * (même règle que la création automatique à la réception).
     * Retourne Map(id_produit -> proposition de transfert).
     * ============================================================
     */
    static async _chercherDansEntrepots(id_utilisateur, produitsSrc, propositions) {
        const resultat = new Map();
        if (propositions.length === 0) return resultat;

        const noms = [...new Set(produitsSrc.map(p => this._norm(p.produit_nom)))];
        const phNoms = noms.map(() => '?').join(',');

        const [rows] = await pool.execute(
            `SELECT pe.id_produit_entrepot, pe.id_entrepot, pe.nom, pe.quantite_stock,
                    e.nom AS entrepot_nom, e.ville AS entrepot_ville,
                    mq.nom AS marque_nom, md.nom AS modele_nom, u.nom AS unite_nom,
                    (e.id_utilisateur_proprietaire = ?) AS est_proprietaire
               FROM produits_entrepot pe
               JOIN entrepots e ON e.id_entrepot = pe.id_entrepot AND e.actif = 1
               LEFT JOIN marques mq ON mq.id_marque = pe.id_marque
               LEFT JOIN modeles md ON md.id_modele = pe.id_modele
               LEFT JOIN unites u ON u.id_unite = pe.id_unite
              WHERE pe.actif = 1
                AND pe.quantite_stock > 0
                AND LOWER(TRIM(pe.nom)) IN (${phNoms})
                AND (
                    e.id_utilisateur_proprietaire = ?
                    OR EXISTS (SELECT 1 FROM membres_entrepot me
                                WHERE me.id_entrepot = pe.id_entrepot
                                  AND me.id_utilisateur = ? AND me.actif = 1)
                )`,
            [id_utilisateur, ...noms, id_utilisateur, id_utilisateur]
        );
        if (rows.length === 0) return resultat;

        const ids = rows.map(r => r.id_produit_entrepot);
        const ph = ids.map(() => '?').join(',');
        const [unites] = await pool.execute(
            `SELECT id_unite_vente_entrepot, id_produit_entrepot, nom, quantite_base, est_principal
               FROM unites_vente_entrepot
              WHERE id_produit_entrepot IN (${ph}) AND actif = TRUE
              ORDER BY est_principal DESC, quantite_base ASC`,
            ids
        );
        const unitesParPE = {};
        unites.forEach(u => {
            (unitesParPE[u.id_produit_entrepot] ||= []).push({
                id_unite_vente: u.id_unite_vente_entrepot,
                nom: u.nom,
                quantite_base: parseFloat(u.quantite_base) || 1,
                est_principal: u.est_principal === 1 || u.est_principal === true,
            });
        });

        const parId = new Map(produitsSrc.map(p => [p.id_produit, p]));

        for (const prop of propositions) {
            const src = parId.get(prop.id_produit);
            if (!src) continue;

            const candidats = rows
                .filter(r =>
                    this._norm(r.nom) === this._norm(src.produit_nom) &&
                    this._norm(r.marque_nom) === this._norm(src.marque_nom) &&
                    this._norm(r.modele_nom) === this._norm(src.modele_nom) &&
                    (!this._norm(r.unite_nom) || !this._norm(src.unite_nom) || this._norm(r.unite_nom) === this._norm(src.unite_nom)))
                .sort((a, b) => parseFloat(b.quantite_stock) - parseFloat(a.quantite_stock));
            if (candidats.length === 0) continue;

            const best = candidats[0];
            const stockEntrepot = parseFloat(best.quantite_stock) || 0;
            const aTransferer = Math.min(prop.besoin_base, stockEntrepot);
            if (!(aTransferer > 0)) continue;

            // Unité : l'unité principale de l'entrepôt si on peut en transférer au moins une, sinon l'unité de base
            const unitesEntrepot = unitesParPE[best.id_produit_entrepot] || [];
            const principale = unitesEntrepot.find(u => u.est_principal && u.quantite_base > 1)
                || unitesEntrepot.filter(u => u.quantite_base > 1).sort((a, b) => b.quantite_base - a.quantite_base)[0]
                || null;

            let unite = null;
            let qteUV = Math.floor(aTransferer * 100) / 100;
            let qteBase = qteUV;
            if (principale && principale.quantite_base <= aTransferer) {
                qteUV = Math.floor(aTransferer / principale.quantite_base);
                qteBase = qteUV * principale.quantite_base;
                unite = { id_unite_vente: principale.id_unite_vente, nom: principale.nom, quantite_base: principale.quantite_base };
            } else {
                qteUV = Math.max(1, Math.floor(aTransferer));
                qteBase = qteUV;
            }
            if (qteBase > stockEntrepot) continue;

            resultat.set(prop.id_produit, {
                id_produit: prop.id_produit,
                produit_nom: prop.produit_nom,
                marque_nom: prop.marque_nom,
                type_alerte: prop.type_alerte,
                quantite_stock: prop.quantite_stock,
                quantite_minimale: prop.quantite_minimale,
                quantite_en_commande: prop.quantite_en_commande,
                besoin_base: prop.besoin_base,
                unites_vente: prop.unites_vente,
                unite_base_nom: prop.unite_base_nom,
                unite_base_symbole: prop.unite_base_symbole,
                source: {
                    id_entrepot: best.id_entrepot,
                    entrepot_nom: best.entrepot_nom,
                    entrepot_ville: best.entrepot_ville,
                    id_produit_entrepot: best.id_produit_entrepot,
                    stock_base: stockEntrepot,
                    est_proprietaire: !!Number(best.est_proprietaire),
                    unites_vente: unitesEntrepot,
                },
                autres_entrepots: candidats.length - 1,
                unite_proposee: unite,
                quantite_proposee_uv: qteUV,
                quantite_proposee_base: qteBase,
            });
        }
        return resultat;
    }

    /**
     * ============================================================
     * ✅ PROPOSITION POUR UN ENTREPÔT (propriétaire uniquement)
     * ============================================================
     * Même logique que le magasin, avec les données de l'entrepôt :
     *  - produits_entrepot / unites_vente_entrepot
     *  - consommation = sorties de stock de l'entrepôt sur 30 jours
     *    (transferts vers les magasins, pertes, casses… hors retours fournisseurs)
     *  - en commande = commandes d'achat destinées à CET entrepôt
     * Pour que l'écran fonctionne comme celui du magasin, `id_produit` contient
     * l'id du produit d'entrepôt ; `id_produit_entrepot` est renvoyé aussi.
     */
    static async _getPropositionEntrepot(id_utilisateur, id_entrepot, options = {}) {
        const niveau = options.niveau || 'normal';
        const joursCouverture = this.NIVEAUX[niveau]?.jours || 15;

        // Quantités déjà en commande pour cet entrepôt (lignes rattachées au produit d'entrepôt)
        const [enCommandeRaw] = await pool.execute(
            `SELECT lca.id_produit_entrepot AS id,
                    COALESCE(SUM(
                        CASE
                            WHEN lca.quantite_totale_base > 0 THEN lca.quantite_totale_base
                            WHEN lca.quantite_base > 0 THEN lca.quantite * lca.quantite_base
                            ELSE lca.quantite
                        END
                    ), 0) AS total
               FROM ligne_commande_achat lca
               JOIN commandes_achat ca ON lca.id_commande_achat = ca.id_commande_achat
              WHERE ca.destination = 'entrepot'
                AND ca.id_entrepot = ?
                AND lca.id_produit_entrepot IS NOT NULL
                AND ca.statut IN ('en_attente', 'envoyee', 'partiellement_recue')
              GROUP BY lca.id_produit_entrepot`,
            [id_entrepot]
        );
        const enCommandeMap = new Map(enCommandeRaw.map(r => [r.id, parseFloat(r.total) || 0]));

        const [produits] = await pool.execute(
            `SELECT
                p.id_produit_entrepot,
                p.nom AS produit_nom,
                p.quantite_stock, p.quantite_minimale, p.quantite_maximale,
                p.prix_achat AS produit_prix_achat,
                m.nom AS marque_nom,
                u.symbole AS unite_symbole, u.nom AS unite_nom,
                f.id_fournisseur,
                f.nom AS fournisseur_nom, f.telephone AS fournisseur_telephone,
                f.email AS fournisseur_email, f.ville AS fournisseur_ville
               FROM produits_entrepot p
               LEFT JOIN marques m ON p.id_marque = m.id_marque
               LEFT JOIN unites u ON p.id_unite = u.id_unite
               LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
              WHERE p.id_entrepot = ? AND p.actif = 1
              ORDER BY f.nom ASC, p.nom ASC`,
            [id_entrepot]
        );

        const aCommander = produits.filter(p => {
            const stock = parseFloat(p.quantite_stock) || 0;
            const min = parseFloat(p.quantite_minimale) || 0;
            const prev = stock + (enCommandeMap.get(p.id_produit_entrepot) || 0);
            return prev <= 0 || prev <= min;
        });

        const vide = {
            niveaux: this.NIVEAUX,
            niveau_actif: niveau,
            jours_couverture: joursCouverture,
            destination: 'entrepot',
            id_entrepot,
            transferts: [],
            fournisseurs: [],
            total_produits: 0,
            total_fournisseurs: 0,
            total_estime: 0,
            produits: [],
        };
        if (aCommander.length === 0) return vide;

        const ids = aCommander.map(p => p.id_produit_entrepot);
        const ph = ids.map(() => '?').join(',');

        const [allUnites] = await pool.execute(
            `SELECT id_unite_vente_entrepot, id_produit_entrepot, nom, quantite_base,
                    prix_vente, prix_achat, est_principal
               FROM unites_vente_entrepot
              WHERE id_produit_entrepot IN (${ph}) AND actif = TRUE
              ORDER BY est_principal DESC, quantite_base ASC`,
            ids
        );
        const unitesParProduit = {};
        allUnites.forEach(u => {
            (unitesParProduit[u.id_produit_entrepot] ||= []).push({
                id_unite_vente: u.id_unite_vente_entrepot,
                nom: u.nom,
                quantite_base: parseFloat(u.quantite_base) || 1,
                prix_vente: parseFloat(u.prix_vente) || 0,
                prix_achat: parseFloat(u.prix_achat) || 0,
                est_principal: u.est_principal === 1 || u.est_principal === true,
            });
        });

        // Consommation de l'entrepôt sur 30 jours
        const [sorties] = await pool.execute(
            `SELECT id_produit_entrepot AS id,
                    COALESCE(SUM(quantite_totale_base), 0) AS total,
                    COUNT(*) AS nb
               FROM sorties_stock_entrepot
              WHERE id_entrepot = ?
                AND id_produit_entrepot IN (${ph})
                AND type_sortie <> 'retour_fournisseur'
                AND date_sortie >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
              GROUP BY id_produit_entrepot`,
            [id_entrepot, ...ids]
        );
        const sortiesMap = new Map(sorties.map(r => [r.id, { total: parseFloat(r.total) || 0, nb: parseInt(r.nb, 10) || 0 }]));

        const propositions = aCommander.map(p => {
            const stock = parseFloat(p.quantite_stock) || 0;
            const min = parseFloat(p.quantite_minimale) || 0;
            const max = parseFloat(p.quantite_maximale) || 0;
            const enCommande = enCommandeMap.get(p.id_produit_entrepot) || 0;
            const prev = stock + enCommande;

            const vente = sortiesMap.get(p.id_produit_entrepot) || { total: 0, nb: 0 };
            const vitesse = vente.total / 30;

            const besoinCouverture = Math.max(0, vitesse * joursCouverture - prev);
            const besoinMax = max > 0 ? Math.max(0, max - prev) : 0;
            const besoinMin = min > 0 ? Math.max(0, min * 2 - prev) : 0;
            let besoinBase = Math.max(besoinCouverture, besoinMax, besoinMin);
            if (besoinBase <= 0) besoinBase = Math.max(0, min - prev);
            const besoinArrondi = Math.max(1, Math.ceil(besoinBase));

            const unites = unitesParProduit[p.id_produit_entrepot] || [];
            const uv = unites.find(u => u.est_principal) || unites[0] || null;
            const qteBaseParUV = uv?.quantite_base || 1;
            const qteUV = Math.max(1, Math.ceil(besoinArrondi / qteBaseParUV));

            const prixUnitaire = uv?.prix_achat || (parseFloat(p.produit_prix_achat) > 0 ? parseFloat(p.produit_prix_achat) * qteBaseParUV : null) || null;
            const prixTotal = prixUnitaire ? qteUV * prixUnitaire : null;

            return {
                id_produit: p.id_produit_entrepot,          // clé utilisée par l'écran
                id_produit_entrepot: p.id_produit_entrepot,
                produit_nom: p.produit_nom,
                marque_nom: p.marque_nom,
                id_fournisseur: p.id_fournisseur || null,

                quantite_stock: stock,
                quantite_minimale: min,
                quantite_maximale: max,
                quantite_en_commande: enCommande,
                stock_previsionnel: prev,

                ventes_30j_base: vente.total,
                nb_commandes_30j: vente.nb,
                vitesse_jour: parseFloat(vitesse.toFixed(2)),

                besoin_base: besoinArrondi,
                unites_vente: unites,
                unite_proposee: uv ? { id_unite_vente: uv.id_unite_vente, nom: uv.nom, quantite_base: uv.quantite_base, prix_achat: uv.prix_achat } : null,
                quantite_proposee_uv: qteUV,
                quantite_proposee_base: qteUV * qteBaseParUV,

                prix_unitaire: prixUnitaire,
                prix_total: prixTotal,
                prix_connu: prixUnitaire !== null,

                unite_base_nom: p.unite_nom || 'Unité',
                unite_base_symbole: p.unite_symbole || '',
                type_alerte: prev <= 0 ? 'rupture' : 'stock_bas',
                _src: p,
            };
        });

        const groupesMap = new Map();
        propositions.forEach(p => {
            const src = p._src; delete p._src;
            const key = src.id_fournisseur || 'sans_fournisseur';
            if (!groupesMap.has(key)) {
                groupesMap.set(key, {
                    id_fournisseur: src.id_fournisseur || null,
                    fournisseur_nom: src.fournisseur_nom || 'Sans fournisseur',
                    fournisseur_telephone: src.fournisseur_telephone || null,
                    fournisseur_email: src.fournisseur_email || null,
                    fournisseur_ville: src.fournisseur_ville || null,
                    produits: [], total_estime: 0, nb_prix_connus: 0, nb_prix_inconnus: 0,
                });
            }
            const g = groupesMap.get(key);
            g.produits.push(p);
            if (p.prix_total) { g.total_estime += p.prix_total; g.nb_prix_connus += 1; } else { g.nb_prix_inconnus += 1; }
        });

        const fournisseurs = Array.from(groupesMap.values())
            .sort((a, b) => (a.fournisseur_nom || '').localeCompare(b.fournisseur_nom || ''));

        return {
            ...vide,
            fournisseurs,
            total_produits: propositions.length,
            total_fournisseurs: fournisseurs.length,
            total_estime: fournisseurs.reduce((sum, f) => sum + f.total_estime, 0),
            produits: propositions,
        };
    }

    /**
     * ============================================================
     * ✅ CRÉER LES BONS DE COMMANDE
     * ============================================================
     */
    static async creerBons(id_utilisateur, payload) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour creerBons');
        }

        const { groupes = [], date_commande, notes } = payload;
        const { destination, id_entrepot } = CommandeAchat.scope(payload.destination, payload.id_entrepot);
        const estEntrepot = destination === 'entrepot';
        if (estEntrepot) {
            const ok = await CommandeAchat.estProprietaireEntrepot(id_entrepot, id_utilisateur);
            if (!ok) {
                const err = new Error('Seul le propriétaire de l\'entrepôt peut commander pour cet entrepôt');
                err.statusCode = 403;
                throw err;
            }
        }

        if (!Array.isArray(groupes) || groupes.length === 0) {
            throw new Error('Aucun groupe de commande à créer');
        }

        // ------------------------------------------------------------
        // Nature de chaque ligne d'un bon livré à l'ENTREPÔT :
        //   - 'entrepot' : produit de l'entrepôt (id_produit_entrepot)
        //   - 'magasin'  : produit du catalogue du magasin livré à l'entrepôt (id_produit)
        // La ligne se décrit elle-même : id_produit_entrepot => entrepôt ; id_produit seul => magasin
        // (payload.lignes_magasin === true le confirme). Seul cas ambigu : un ancien écran qui envoie un
        // id_produit SANS drapeau → on regarde où cet identifiant existe réellement.
        // ------------------------------------------------------------
        let idsEntrepot = null;
        let idsMagasin = null;
        if (estEntrepot && payload.lignes_magasin !== true) {
            const besoinLookup = groupes.some(g => (g.lignes || []).some(l => !l.id_produit_entrepot && l.id_produit));
            if (besoinLookup) {
                const [pe] = await pool.execute(
                    'SELECT id_produit_entrepot AS id FROM produits_entrepot WHERE id_entrepot = ? AND actif = 1',
                    [id_entrepot]
                );
                const [pm] = await pool.execute(
                    'SELECT id_produit AS id FROM produits WHERE id_utilisateur = ?',
                    [id_utilisateur]
                );
                idsEntrepot = new Set(pe.map(r => Number(r.id)));
                idsMagasin = new Set(pm.map(r => Number(r.id)));
            }
        }
        const natureLigne = (l) => {
            if (!estEntrepot) return 'magasin';
            if (l.id_produit_entrepot) return 'entrepot';
            if (!l.id_produit) return null;
            if (payload.lignes_magasin === true) return 'magasin';
            const id = Number(l.id_produit);
            if (idsEntrepot?.has(id)) return 'entrepot';
            if (idsMagasin?.has(id)) return 'magasin';
            return 'entrepot'; // introuvable partout : l'erreur « non trouvé » sera explicite
        };

        // ✅ Fusionner les groupes par fournisseur
        const groupesFusionnes = new Map();
        groupes.forEach(g => {
            if (!g.id_fournisseur) return;
            if (!groupesFusionnes.has(g.id_fournisseur)) {
                groupesFusionnes.set(g.id_fournisseur, {
                    id_fournisseur: g.id_fournisseur,
                    lignes: [],
                });
            }
            groupesFusionnes.get(g.id_fournisseur).lignes.push(...g.lignes);
        });

        const bons = [];
        const erreurs = [];

        for (const groupe of groupesFusionnes.values()) {
            try {
                if (!Array.isArray(groupe.lignes) || groupe.lignes.length === 0) {
                    erreurs.push({
                        id_fournisseur: groupe.id_fournisseur,
                        message: 'Aucune ligne à commander pour ce fournisseur',
                    });
                    continue;
                }

                const lignesValides = groupe.lignes
                    .filter(l => {
                        const q = Math.max(1, parseInt(l.quantite, 10) || 1);
                        return q > 0 && natureLigne(l) !== null;
                    })
                    .map(l => {
                        const qteUV = Math.max(1, parseInt(l.quantite, 10) || 1);
                        const qteBase = parseFloat(l.quantite_base) || 1;
                        const qteTotaleBase = l.quantite_totale_base || (qteUV * qteBase);

                        return {
                            ...(natureLigne(l) === 'entrepot'
                                ? { id_produit_entrepot: l.id_produit_entrepot || l.id_produit }
                                : { id_produit: l.id_produit }),
                            id_unite_vente: l.id_unite_vente || null,
                            nom_unite_vente: l.nom_unite_vente || 'Unité',
                            quantite_base: qteBase,
                            quantite: qteUV,
                            quantite_totale_base: Math.max(qteUV, qteTotaleBase),
                            prix_achat: l.prix_achat ?? null,
                            remise: l.remise || 0,
                        };
                    });

                if (lignesValides.length === 0) {
                    erreurs.push({
                        id_fournisseur: groupe.id_fournisseur,
                        message: 'Aucune ligne valide',
                    });
                    continue;
                }

                const [bonsOuverts] = await pool.execute(
                    `SELECT id_commande_achat, numero_commande, statut
                    FROM commandes_achat
                    WHERE id_utilisateur = ?
                    AND id_fournisseur = ?
                    AND statut = 'en_attente'
                    AND destination = ?
                    AND ${estEntrepot ? 'id_entrepot = ?' : 'id_entrepot IS NULL'}
                    ORDER BY date_creation DESC
                    LIMIT 1`,
                    estEntrepot
                        ? [id_utilisateur, groupe.id_fournisseur, destination, id_entrepot]
                        : [id_utilisateur, groupe.id_fournisseur, destination]
                );

                const bonExistant = bonsOuverts[0] || null;

                let lignesAAjouter = lignesValides;

                if (bonExistant) {
                    const [lignesExistantes] = await pool.execute(
                        `SELECT id_produit, id_unite_vente, id_produit_entrepot, id_unite_vente_entrepot
                         FROM ligne_commande_achat
                         WHERE id_commande_achat = ?`,
                        [bonExistant.id_commande_achat]
                    );

                    const existantesSet = new Set(
                        lignesExistantes.map(l => l.id_produit_entrepot
                            ? `e${l.id_produit_entrepot}_${l.id_unite_vente_entrepot || 'null'}`
                            : `m${l.id_produit}_${l.id_unite_vente || 'null'}`)
                    );

                    lignesAAjouter = lignesValides.filter(l => {
                        const key = l.id_produit_entrepot
                            ? `e${l.id_produit_entrepot}_${l.id_unite_vente || 'null'}`
                            : `m${l.id_produit}_${l.id_unite_vente || 'null'}`;
                        return !existantesSet.has(key);
                    });

                    if (lignesAAjouter.length === 0) {
                        bons.push({
                            id_fournisseur: groupe.id_fournisseur,
                            id_commande_achat: bonExistant.id_commande_achat,
                            numero_commande: bonExistant.numero_commande,
                            action: 'aucune_modification',
                            message: 'Tous les produits sont déjà dans le bon ouvert',
                            nb_lignes_ajoutees: 0,
                        });
                        continue;
                    }
                }

                if (bonExistant) {
                    const commande = await CommandeAchat.addLignes(
                        bonExistant.id_commande_achat,
                        lignesAAjouter,
                        id_utilisateur
                    );

                    bons.push({
                        id_fournisseur: groupe.id_fournisseur,
                        fournisseur_nom: commande.fournisseur_nom,
                        id_commande_achat: commande.id_commande_achat,
                        numero_commande: commande.numero_commande,
                        montant_total: parseFloat(commande.montant_total) || 0,
                        nb_lignes: commande.lignes?.length || 0,
                        action: 'lignes_ajoutees',
                        nb_lignes_ajoutees: lignesAAjouter.length,
                        nb_lignes_ignorees: lignesValides.length - lignesAAjouter.length,
                    });
                } else {
                    const commande = await CommandeAchat.create({
                        id_fournisseur: groupe.id_fournisseur,
                        date_commande: date_commande || new Date().toISOString().split('T')[0],
                        notes: notes || 'Commande générée automatiquement par l\'assistant',
                        id_utilisateur,
                        destination,
                        id_entrepot,
                        lignes: lignesAAjouter,
                    });

                    bons.push({
                        id_fournisseur: groupe.id_fournisseur,
                        fournisseur_nom: commande.fournisseur_nom,
                        id_commande_achat: commande.id_commande_achat,
                        numero_commande: commande.numero_commande,
                        montant_total: parseFloat(commande.montant_total) || 0,
                        nb_lignes: commande.lignes?.length || 0,
                        action: 'bon_cree',
                        nb_lignes_ajoutees: lignesAAjouter.length,
                    });
                }
            } catch (err) {
                console.error('❌ Erreur création/complétion bon:', err);
                erreurs.push({
                    id_fournisseur: groupe.id_fournisseur,
                    message: err.message || 'Erreur inconnue',
                });
            }
        }

        return {
            bons,
            erreurs,
            total_crees: bons.filter(b => b.action === 'bon_cree').length,
            total_completes: bons.filter(b => b.action === 'lignes_ajoutees').length,
            total_ignores: bons.filter(b => b.action === 'aucune_modification').length,
            total_erreurs: erreurs.length,
        };
    }
}

export default AssistantAchat;