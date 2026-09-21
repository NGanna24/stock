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
     * ✅ GÉNÉRER LA PROPOSITION DE RÉAPPROVISIONNEMENT (v3)
     * ============================================================
     * ⚠️ CORRECTION MAJEURE : tient compte du STOCK EN COMMANDE
     *    → stock_prévisionnel = quantite_stock + en_commande
     *    → évite de recommander ce qui est déjà en cours
     * ⚠️ GARANTIE : quantite_proposee_uv >= 1 (jamais 0)
     */
    static async getProposition(id_utilisateur, options = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour getProposition');
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
                m.nom AS marque_nom,
                u.symbole AS unite_symbole,
                u.nom AS unite_nom,
                f.id_fournisseur,
                f.nom AS fournisseur_nom,
                f.telephone AS fournisseur_telephone,
                f.email AS fournisseur_email,
                f.ville AS fournisseur_ville,
                uv.id_unite_vente AS uv_id,
                uv.nom AS uv_nom,
                uv.quantite_base AS uv_quantite_base,
                uv.prix_achat AS uv_prix_achat
             FROM produits p
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites u ON p.id_unite = u.id_unite
             LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
             LEFT JOIN unites_vente uv
                ON uv.id_produit = p.id_produit
                AND uv.est_principal = TRUE
                AND uv.actif = TRUE
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
                produits: [],
            };
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

            // ✅ FIX 1a : garantir au moins 1 unité de base
            const besoinArrondi = Math.max(1, Math.ceil(besoinBase));

            // --- Unité de vente proposée ---
            const uv = p.uv_id
                ? {
                    id_unite_vente: p.uv_id,
                    nom: p.uv_nom,
                    quantite_base: parseFloat(p.uv_quantite_base) || 1,
                    prix_achat: p.uv_prix_achat !== null ? parseFloat(p.uv_prix_achat) : null,
                }
                : null;

            const qteBaseParUV = uv?.quantite_base || 1;

            // ✅ FIX 1b : garantir au moins 1 unité de vente
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
        // 🔑 ÉTAPE 6 : Grouper par fournisseur
        // ============================================================
        const groupesMap = new Map();
        produitsAvecProposition.forEach(p => {
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
            total_produits: produitsAvecProposition.length,
            total_fournisseurs: fournisseurs.length,
            total_estime: totalEstime,
            produits: produitsAvecProposition,
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

        if (!Array.isArray(groupes) || groupes.length === 0) {
            throw new Error('Aucun groupe de commande à créer');
        }

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

                // ✅ FIX 2 : garantir quantité >= 1
                const lignesValides = groupe.lignes
                    .filter(l => {
                        const q = Math.max(1, parseInt(l.quantite, 10) || 1);
                        return q > 0 && l.id_produit;
                    })
                    .map(l => {
                        const qteUV = Math.max(1, parseInt(l.quantite, 10) || 1);
                        const qteBase = parseFloat(l.quantite_base) || 1;
                        const qteTotaleBase = l.quantite_totale_base || (qteUV * qteBase);

                        return {
                            id_produit: l.id_produit,
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
                    ORDER BY date_creation DESC
                    LIMIT 1`,
                    [id_utilisateur, groupe.id_fournisseur]
                );

                const bonExistant = bonsOuverts[0] || null;

                let lignesAAjouter = lignesValides;

                if (bonExistant) {
                    const [lignesExistantes] = await pool.execute(
                        `SELECT id_produit, id_unite_vente
                         FROM ligne_commande_achat
                         WHERE id_commande_achat = ?`,
                        [bonExistant.id_commande_achat]
                    );

                    const existantesSet = new Set(
                        lignesExistantes.map(l => `${l.id_produit}_${l.id_unite_vente || 'null'}`)
                    );

                    lignesAAjouter = lignesValides.filter(l => {
                        const key = `${l.id_produit}_${l.id_unite_vente || 'null'}`;
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