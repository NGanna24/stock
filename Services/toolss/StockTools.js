// Services/toolss/StockTools.js
import { pool } from '../../config/db.js';
import Produit from '../../models/Produit.js';

// ============================================================
// UTILITAIRE : sécurité numérique
// ============================================================
function safeNumber(value, max = 1_000_000_000) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || Math.abs(n) > max) return 0;
  return Math.round(n * 100) / 100;
}

// ============================================================
// UTILITAIRE : décomposition d'un stock en conditionnements
// ============================================================
function decomposerStock(stockBase, uniteBase, unitesVente) {
  return unitesVente
    .filter((u) => u.quantite_base > 1)
    .map((u) => {
      const qte = Math.floor(stockBase / u.quantite_base);
      const reste = stockBase - qte * u.quantite_base;
      return {
        nom: u.nom,
        contient: u.quantite_base,
        quantite: qte,
        reste_en_base: reste,
        phrase:
          reste > 0
            ? `${qte} ${u.nom}(s) + ${reste} ${uniteBase}(s)`
            : `${qte} ${u.nom}(s)`,
      };
    });
}

// ============================================================
// UTILITAIRE : formater une quantité (unité de vente prioritaire)
// Priorité : unité de vente > multi-conditionnements > unité de base
// ============================================================
function formaterQuantite(stockBase, uniteBase, unitesVente) {
  const stock = safeNumber(stockBase);
  const unitesConditionnees = (unitesVente || []).filter(
    (u) => u.quantite_base > 1
  );

  // --- CAS 1 : aucune unité de vente conditionnée → unité de base
  if (unitesConditionnees.length === 0) {
    return {
      quantite: stock,
      unite: uniteBase,
      phrase: `${stock} ${uniteBase}(s)`,
      repartition: null,
      stock_base: stock,
      reste_en_base: null,
      affichage_principal: 'unite_base',
    };
  }

  // --- CAS 2 : une seule unité de vente → l'utiliser directement
  if (unitesConditionnees.length === 1) {
    const u = unitesConditionnees[0];
    const qteEntier = Math.floor(stock / u.quantite_base);
    const reste = stock - qteEntier * u.quantite_base;

    const phrase =
      reste > 0
        ? `${qteEntier} ${u.nom}(s) (soit ${stock} ${uniteBase}(s), il reste ${reste} ${uniteBase}(s))`
        : `${qteEntier} ${u.nom}(s)`;

    return {
      quantite: qteEntier,
      unite: u.nom,
      phrase,
      repartition: [
        { nom: u.nom, quantite: qteEntier, contient: u.quantite_base },
      ],
      reste_en_base: reste,
      stock_base: stock,
      affichage_principal: 'unite_vente',
    };
  }

  // --- CAS 3 : plusieurs unités de vente → décomposition décroissante
  const sorted = [...unitesConditionnees].sort(
    (a, b) => b.quantite_base - a.quantite_base
  );

  let reste = stock;
  const repartition = [];

  for (const u of sorted) {
    const qte = Math.floor(reste / u.quantite_base);
    if (qte > 0) {
      repartition.push({
        nom: u.nom,
        quantite: qte,
        contient: u.quantite_base,
      });
      reste -= qte * u.quantite_base;
    }
  }

  const morceaux = repartition.map((r) => `${r.quantite} ${r.nom}(s)`);
  if (reste > 0) morceaux.push(`${reste} ${uniteBase}(s)`);

  const principal = repartition[0];
  const phrase =
    repartition.length === 1 && reste === 0
      ? `${principal.quantite} ${principal.nom}(s)`
      : `${morceaux.join(' + ')} (soit ${stock} ${uniteBase}(s))`;

  return {
    quantite: principal ? principal.quantite : stock,
    unite: principal ? principal.nom : uniteBase,
    phrase,
    repartition,
    reste_en_base: reste,
    stock_base: stock,
    affichage_principal: 'unite_vente_multi',
  };
}

// ============================================================
// UTILITAIRE : charger les unités de vente pour un lot de produits
// ============================================================
async function chargerUnitesVente(idProduits) {
  if (!idProduits.length) return {};

  const placeholders = idProduits.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT id_produit, nom, quantite_base, prix_vente, est_principal
     FROM unites_vente
     WHERE id_produit IN (${placeholders}) AND actif = TRUE
     ORDER BY est_principal DESC, quantite_base ASC`,
    idProduits
  );

  const map = {};
  for (const u of rows) {
    if (!map[u.id_produit]) map[u.id_produit] = [];
    map[u.id_produit].push({
      nom: u.nom,
      quantite_base: parseFloat(u.quantite_base) || 1,
      prix_vente: safeNumber(u.prix_vente),
      est_principal: !!u.est_principal,
    });
  }
  return map;
}

// ============================================================
// 🏷️ PRODUITS
// ============================================================
export async function rechercher_produit({ nom }, workspaceId) {
  if (!nom || typeof nom !== 'string') {
    return { error: 'Nom de produit requis' };
  }

  const produits = await Produit.search(nom.trim(), workspaceId);

  if (!produits || produits.length === 0) {
    return { found: false, message: `Aucun produit trouvé pour "${nom}"` };
  }

  const top = produits.slice(0, 5);
  const unitesParProduit = await chargerUnitesVente(top.map((p) => p.id_produit));

  const produitsEnrichis = top.map((p) => {
    const stockBase = safeNumber(p.quantite_stock);
    const uniteBase = p.unite_symbole || p.unite_nom || 'unité';
    const unitesVente = unitesParProduit[p.id_produit] || [];
    const affichage = formaterQuantite(stockBase, uniteBase, unitesVente);

    return {
      nom: p.nom,
      quantite_disponible: affichage.quantite,
      unite_affichage: affichage.unite,
      reponse_humaine: affichage.phrase,
      repartition: affichage.repartition || null,
      stock_total_en_unite_base: `${stockBase} ${uniteBase}(s)`,
      stock_total_chiffre: stockBase,
      unite_base: uniteBase,
      reste_en_unite_base: affichage.reste_en_base,
      affichage_principal: affichage.affichage_principal,
      prix_unite_base: safeNumber(p.prix_vente),
      prix_achat_unite_base: safeNumber(p.prix_achat),
      statut: p.statut,
      categorie: p.categorie_nom || null,
      marque: p.marque_nom || null,
      unites_vente: unitesVente,
    };
  });

  return {
    found: true,
    count: produits.length,
    produits: produitsEnrichis,
  };
}

export async function lister_produits({ limite = 30 }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 30, 1), 100);

  const [rows] = await pool.execute(
    `SELECT p.id_produit, p.nom, p.quantite_stock, p.quantite_minimale, p.prix_vente, p.statut,
            u.symbole AS unite_symbole, u.nom AS unite_nom,
            c.nom AS categorie_nom
     FROM produits p
     LEFT JOIN unites u ON p.id_unite = u.id_unite
     LEFT JOIN categories c ON p.id_categorie = c.id_categorie
     WHERE p.id_utilisateur = ?
     ORDER BY p.nom ASC
     LIMIT ${limit}`,
    [workspaceId]
  );

  const unitesParProduit = await chargerUnitesVente(rows.map((r) => r.id_produit));

  return {
    count: rows.length,
    produits: rows.map((r) => {
      const stockBase = safeNumber(r.quantite_stock);
      const uniteBase = r.unite_symbole || r.unite_nom || 'unité';
      const unitesVente = unitesParProduit[r.id_produit] || [];
      const affichage = formaterQuantite(stockBase, uniteBase, unitesVente);

      return {
        nom: r.nom,
        quantite_disponible: affichage.quantite,
        unite_affichage: affichage.unite,
        reponse_humaine: affichage.phrase,
        repartition: affichage.repartition || null,
        stock_en_unite_base: `${stockBase} ${uniteBase}(s)`,
        stock_chiffre: stockBase,
        unite_base: uniteBase,
        affichage_principal: affichage.affichage_principal,
        stock_min: safeNumber(r.quantite_minimale),
        prix_vente_unite_base: safeNumber(r.prix_vente),
        statut: r.statut,
        categorie: r.categorie_nom || null,
      };
    }),
  };
}

export async function details_produit({ nom }, workspaceId) {
  if (!nom) return { error: 'Nom du produit requis' };

  const produits = await Produit.search(nom.trim(), workspaceId);
  if (!produits || produits.length === 0) {
    return { found: false, message: `Aucun produit trouvé pour "${nom}"` };
  }

  const p = produits[0];
  const stockBase = safeNumber(p.quantite_stock);
  const uniteBase = p.unite_symbole || p.unite_nom || 'unité';

  const unitesParProduit = await chargerUnitesVente([p.id_produit]);
  const unitesVente = unitesParProduit[p.id_produit] || [];
  const affichage = formaterQuantite(stockBase, uniteBase, unitesVente);

  const [mouvements] = await pool.execute(
    `SELECT type_mouvement, quantite, ancienne_quantite, nouvelle_quantite,
            notes, date_mouvement
     FROM mouvements_stock
     WHERE id_produit = ? AND id_utilisateur = ?
     ORDER BY date_mouvement DESC
     LIMIT 5`,
    [p.id_produit, workspaceId]
  );

  const [ventes] = await pool.execute(
    `SELECT 
        COALESCE(SUM(lcv.quantite_totale_base), 0) AS total_vendu_base,
        COALESCE(SUM(lcv.montant_total), 0) AS ca,
        COUNT(DISTINCT cv.id_commande) AS nb_commandes
     FROM ligne_commande_vente lcv
     JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
     WHERE cv.id_utilisateur = ?
       AND lcv.id_produit = ?
       AND cv.date_commande >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       AND cv.statut NOT IN ('annulee')`,
    [workspaceId, p.id_produit]
  );

  const v = ventes[0];
  const totalVenduBase = safeNumber(v.total_vendu_base);
  const affichageVentes = formaterQuantite(totalVenduBase, uniteBase, unitesVente);

  return {
    found: true,
    produit: {
      nom: p.nom,
      description: p.description || null,
      categorie: p.categorie_nom || null,
      marque: p.marque_nom || null,
      statut: p.statut,
      unite_base: uniteBase,

      quantite_disponible: affichage.quantite,
      unite_affichage: affichage.unite,
      reponse_humaine: affichage.phrase,
      repartition: affichage.repartition || null,
      stock_total_en_unite_base: `${stockBase} ${uniteBase}(s)`,
      stock_chiffre: stockBase,
      reste_en_unite_base: affichage.reste_en_base,
      affichage_principal: affichage.affichage_principal,

      stock_min: safeNumber(p.quantite_minimale),
      stock_max: safeNumber(p.quantite_maximale),

      prix_achat_unite_base: safeNumber(p.prix_achat),
      prix_vente_unite_base: safeNumber(p.prix_vente),
      marge_unitaire: safeNumber(p.prix_vente) - safeNumber(p.prix_achat),
      marge_pourcentage:
        safeNumber(p.prix_achat) > 0
          ? Math.round(
              ((safeNumber(p.prix_vente) - safeNumber(p.prix_achat)) /
                safeNumber(p.prix_achat)) * 100
            )
          : null,

      unites_vente: unitesVente.map((u) => ({
        nom: u.nom,
        contient: u.quantite_base,
        prix_vente: u.prix_vente,
      })),

      ventes_30_jours: {
        quantite_vendue: affichageVentes.quantite,
        unite_affichage: affichageVentes.unite,
        reponse_humaine: affichageVentes.phrase,
        quantite_vendue_base: totalVenduBase,
        chiffre_affaires: safeNumber(v.ca, 10_000_000_000),
        nombre_commandes: parseInt(v.nb_commandes) || 0,
      },

      derniers_mouvements: mouvements.map((m) => ({
        type: m.type_mouvement,
        quantite: safeNumber(m.quantite),
        ancien_stock: safeNumber(m.ancienne_quantite),
        nouveau_stock: safeNumber(m.nouvelle_quantite),
        date: m.date_mouvement,
        notes: m.notes || null,
      })),
    },
  };
}

// ============================================================
// ⚠️ ALERTES
// ============================================================
export async function produits_en_rupture(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT p.nom, p.quantite_stock, u.symbole AS unite_symbole, u.nom AS unite_nom,
            f.nom AS fournisseur_nom, f.telephone AS fournisseur_tel
     FROM produits p
     LEFT JOIN unites u ON p.id_unite = u.id_unite
     LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
     WHERE p.id_utilisateur = ?
       AND (p.statut = 'rupture' OR p.quantite_stock <= 0)
     ORDER BY p.nom ASC
     LIMIT 30`,
    [workspaceId]
  );

  return {
    count: rows.length,
    produits: rows.map((r) => ({
      nom: r.nom,
      unite: r.unite_symbole || r.unite_nom || 'unité',
      fournisseur: r.fournisseur_nom || null,
      telephone_fournisseur: r.fournisseur_tel || null,
    })),
  };
}

export async function produits_stock_bas(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT p.id_produit, p.nom, p.quantite_stock, p.quantite_minimale,
            u.symbole AS unite_symbole, u.nom AS unite_nom,
            f.nom AS fournisseur_nom
     FROM produits p
     LEFT JOIN unites u ON p.id_unite = u.id_unite
     LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
     WHERE p.id_utilisateur = ?
       AND p.quantite_stock > 0
       AND p.quantite_stock <= p.quantite_minimale
     ORDER BY p.quantite_stock ASC
     LIMIT 30`,
    [workspaceId]
  );

  const unitesParProduit = await chargerUnitesVente(rows.map((r) => r.id_produit));

  return {
    count: rows.length,
    produits: rows.map((r) => {
      const stockBase = safeNumber(r.quantite_stock);
      const uniteBase = r.unite_symbole || r.unite_nom || 'unité';
      const unitesVente = unitesParProduit[r.id_produit] || [];
      const affichage = formaterQuantite(stockBase, uniteBase, unitesVente);

      return {
        nom: r.nom,
        quantite_disponible: affichage.quantite,
        unite_affichage: affichage.unite,
        reponse_humaine: affichage.phrase,
        repartition: affichage.repartition || null,
        stock_en_unite_base: `${stockBase} ${uniteBase}(s)`,
        stock_chiffre: stockBase,
        unite_base: uniteBase,
        stock_min: safeNumber(r.quantite_minimale),
        fournisseur: r.fournisseur_nom || null,
      };
    }),
  };
}

// ============================================================
// 📊 STATISTIQUES STOCK
// ============================================================
export async function stats_generales(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT 
        COUNT(*) AS total_produits,
        SUM(CASE WHEN quantite_stock <= 0 OR statut = 'rupture' THEN 1 ELSE 0 END) AS en_rupture,
        SUM(CASE WHEN quantite_stock > 0 AND quantite_stock <= quantite_minimale THEN 1 ELSE 0 END) AS stock_bas,
        COALESCE(SUM(quantite_stock * prix_achat), 0) AS valeur_achat,
        COALESCE(SUM(quantite_stock * prix_vente), 0) AS valeur_vente
     FROM produits
     WHERE id_utilisateur = ?`,
    [workspaceId]
  );

  const r = rows[0];
  return {
    total_produits: parseInt(r.total_produits) || 0,
    en_rupture: parseInt(r.en_rupture) || 0,
    stock_bas: parseInt(r.stock_bas) || 0,
    valeur_achat: safeNumber(r.valeur_achat, 10_000_000_000),
    valeur_vente: safeNumber(r.valeur_vente, 10_000_000_000),
  };
}

export async function valeur_stock(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT 
        COALESCE(SUM(quantite_stock * prix_achat), 0) AS valeur_achat,
        COALESCE(SUM(quantite_stock * prix_vente), 0) AS valeur_vente,
        COUNT(*) AS total_produits
     FROM produits
     WHERE id_utilisateur = ?`,
    [workspaceId]
  );

  const r = rows[0];
  const va = safeNumber(r.valeur_achat, 10_000_000_000);
  const vv = safeNumber(r.valeur_vente, 10_000_000_000);

  return {
    valeur_achat: va,
    valeur_vente: vv,
    marge_potentielle: vv - va,
    total_produits: parseInt(r.total_produits) || 0,
  };
}

export async function stock_par_categorie(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT 
        COALESCE(c.nom, 'Sans catégorie') AS categorie,
        COUNT(*) AS nb_produits,
        COALESCE(SUM(p.quantite_stock * p.prix_vente), 0) AS valeur_vente,
        COALESCE(SUM(p.quantite_stock * p.prix_achat), 0) AS valeur_achat
     FROM produits p
     LEFT JOIN categories c ON p.id_categorie = c.id_categorie
     WHERE p.id_utilisateur = ?
     GROUP BY c.id_categorie, c.nom
     ORDER BY valeur_vente DESC
     LIMIT 15`,
    [workspaceId]
  );

  return {
    count: rows.length,
    categories: rows.map((r) => ({
      categorie: r.categorie,
      nb_produits: parseInt(r.nb_produits) || 0,
      valeur_vente: safeNumber(r.valeur_vente, 10_000_000_000),
      valeur_achat: safeNumber(r.valeur_achat, 10_000_000_000),
    })),
  };
}

export async function stock_par_fournisseur(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT 
        COALESCE(f.nom, 'Sans fournisseur') AS fournisseur,
        COUNT(*) AS nb_produits,
        COALESCE(SUM(p.quantite_stock * p.prix_achat), 0) AS valeur_achat
     FROM produits p
     LEFT JOIN fournisseurs f ON p.id_fournisseur = f.id_fournisseur
     WHERE p.id_utilisateur = ?
     GROUP BY f.id_fournisseur, f.nom
     ORDER BY valeur_achat DESC
     LIMIT 15`,
    [workspaceId]
  );

  return {
    count: rows.length,
    fournisseurs: rows.map((r) => ({
      fournisseur: r.fournisseur,
      nb_produits: parseInt(r.nb_produits) || 0,
      valeur_achat: safeNumber(r.valeur_achat, 10_000_000_000),
    })),
  };
}

// ============================================================
// 💰 VENTES
// ============================================================
export async function chiffre_affaires({ date_debut, date_fin }, workspaceId) {
  const debut =
    date_debut ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const fin = date_fin || new Date().toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `SELECT 
        COUNT(DISTINCT cv.id_commande) AS nb_commandes,
        COALESCE(SUM(cv.montant_total), 0) AS ca_total
     FROM commandes_vente cv
     WHERE cv.id_utilisateur = ?
       AND cv.date_commande BETWEEN ? AND ?
       AND cv.statut NOT IN ('annulee')`,
    [workspaceId, debut, fin]
  );

  const r = rows[0];
  const caTotal = safeNumber(r.ca_total, 10_000_000_000);
  const nbCmd = parseInt(r.nb_commandes) || 0;

  return {
    periode: { debut, fin },
    chiffre_affaires: caTotal,
    nombre_commandes: nbCmd,
    panier_moyen: nbCmd > 0 ? Math.round(caTotal / nbCmd) : 0,
  };
}

export async function top_produits({ limite = 5, date_debut, date_fin }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 5, 1), 10);
  const fin = date_fin || new Date().toISOString().slice(0, 10);
  const debut =
    date_debut ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `SELECT 
        p.id_produit,
        p.nom,
        SUM(lcv.quantite_totale_base) AS total_vendu,
        SUM(lcv.montant_total) AS chiffre_affaires
     FROM ligne_commande_vente lcv
     JOIN produits p ON lcv.id_produit = p.id_produit
     JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
     WHERE cv.id_utilisateur = ?
       AND cv.date_commande BETWEEN ? AND ?
       AND cv.statut NOT IN ('annulee')
     GROUP BY p.id_produit, p.nom
     ORDER BY chiffre_affaires DESC
     LIMIT ${limit}`,
    [workspaceId, debut, fin]
  );

  const unitesParProduit = await chargerUnitesVente(rows.map((r) => r.id_produit));

  return {
    periode: { debut, fin },
    count: rows.length,
    produits: rows.map((r) => {
      const totalVenduBase = safeNumber(r.total_vendu);
      const unitesVente = unitesParProduit[r.id_produit] || [];
      const uniteBase = 'unité';
      const affichage = formaterQuantite(totalVenduBase, uniteBase, unitesVente);

      return {
        nom: r.nom,
        quantite_vendue: affichage.quantite,
        unite_affichage: affichage.unite,
        reponse_humaine: affichage.phrase,
        quantite_vendue_base: totalVenduBase,
        chiffre_affaires: safeNumber(r.chiffre_affaires, 10_000_000_000),
      };
    }),
  };
}

export async function factures_impayees(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT numero_facture, date_facture, date_echeance, montant_total, statut
     FROM factures_vente
     WHERE id_utilisateur = ?
       AND statut IN ('en_attente', 'partiellement_payee', 'en_retard')
     ORDER BY date_facture DESC
     LIMIT 20`,
    [workspaceId]
  );

  const total = rows.reduce((s, r) => s + safeNumber(r.montant_total), 0);

  return {
    count: rows.length,
    montant_total_impaye: total,
    factures: rows.map((r) => ({
      numero: r.numero_facture,
      date: r.date_facture,
      echeance: r.date_echeance,
      montant: safeNumber(r.montant_total),
      statut: r.statut,
    })),
  };
}

// ============================================================
// 🛒 COMMANDES
// ============================================================
export async function commandes_en_attente(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT numero_commande, date_commande, nomclient, telephone, montant_total, statut
     FROM commandes_vente
     WHERE id_utilisateur = ?
       AND statut IN ('en_attente', 'confirmee', 'en_preparation')
     ORDER BY date_commande DESC
     LIMIT 20`,
    [workspaceId]
  );

  return {
    count: rows.length,
    commandes: rows.map((r) => ({
      numero: r.numero_commande,
      date: r.date_commande,
      client: r.nomclient || r.telephone || 'Anonyme',
      montant: safeNumber(r.montant_total),
      statut: r.statut,
    })),
  };
}

export async function commandes_par_periode(
  { date_debut, date_fin, statut },
  workspaceId
) {
  if (!date_debut || !date_fin) {
    return { error: 'date_debut et date_fin requis' };
  }

  let query = `
    SELECT numero_commande, date_commande, nomclient, telephone,
           montant_total, statut
    FROM commandes_vente
    WHERE id_utilisateur = ?
      AND date_commande BETWEEN ? AND ?`;
  const params = [workspaceId, date_debut, date_fin];

  if (statut) {
    query += ` AND statut = ?`;
    params.push(statut);
  }

  query += ` ORDER BY date_commande DESC LIMIT 50`;

  const [rows] = await pool.execute(query, params);
  const total = rows.reduce((s, r) => s + safeNumber(r.montant_total), 0);

  return {
    periode: { debut: date_debut, fin: date_fin },
    statut_filtre: statut || 'tous',
    count: rows.length,
    montant_total: total,
    commandes: rows.map((r) => ({
      numero: r.numero_commande,
      date: r.date_commande,
      client: r.nomclient || r.telephone || 'Anonyme',
      montant: safeNumber(r.montant_total),
      statut: r.statut,
    })),
  };
}

export async function commandes_par_statut({ statut, limite = 20 }, workspaceId) {
  if (!statut) return { error: 'Statut requis' };

  const limit = Math.min(Math.max(parseInt(limite) || 20, 1), 50);

  const [rows] = await pool.execute(
    `SELECT numero_commande, date_commande, nomclient, telephone,
            montant_total, statut
     FROM commandes_vente
     WHERE id_utilisateur = ? AND statut = ?
     ORDER BY date_commande DESC
     LIMIT ${limit}`,
    [workspaceId, statut]
  );

  return {
    statut,
    count: rows.length,
    commandes: rows.map((r) => ({
      numero: r.numero_commande,
      date: r.date_commande,
      client: r.nomclient || r.telephone || 'Anonyme',
      montant: safeNumber(r.montant_total),
    })),
  };
}

// ============================================================
// 👥 CLIENTS
// ============================================================
export async function rechercher_client({ telephone }, workspaceId) {
  if (!telephone) return { error: 'Numéro requis' };
  const clean = String(telephone).replace(/\D/g, '');

  const [rows] = await pool.execute(
    `SELECT nomclient, telephone, COUNT(*) AS nb_commandes,
            COALESCE(SUM(montant_total), 0) AS total_achete
     FROM commandes_vente
     WHERE id_utilisateur = ?
       AND telephone LIKE ?
       AND statut NOT IN ('annulee')
     GROUP BY nomclient, telephone
     LIMIT 5`,
    [workspaceId, `%${clean}%`]
  );

  if (rows.length === 0) {
    return { found: false, message: `Aucun client trouvé pour ${telephone}` };
  }

  return {
    found: true,
    clients: rows.map((r) => ({
      nom: r.nomclient || 'Anonyme',
      telephone: r.telephone,
      nombre_commandes: parseInt(r.nb_commandes) || 0,
      total_achete: safeNumber(r.total_achete, 10_000_000_000),
    })),
  };
}

export async function top_clients({ limite = 5, date_debut, date_fin }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 5, 1), 10);
  const fin = date_fin || new Date().toISOString().slice(0, 10);
  const debut =
    date_debut ||
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `SELECT nomclient, telephone, COUNT(*) AS nb_commandes,
            COALESCE(SUM(montant_total), 0) AS total_achete
     FROM commandes_vente
     WHERE id_utilisateur = ?
       AND date_commande BETWEEN ? AND ?
       AND statut NOT IN ('annulee')
       AND telephone IS NOT NULL AND telephone <> ''
     GROUP BY nomclient, telephone
     ORDER BY total_achete DESC
     LIMIT ${limit}`,
    [workspaceId, debut, fin]
  );

  return {
    periode: { debut, fin },
    count: rows.length,
    clients: rows.map((r) => ({
      nom: r.nomclient || 'Anonyme',
      telephone: r.telephone,
      nombre_commandes: parseInt(r.nb_commandes) || 0,
      total_achete: safeNumber(r.total_achete, 10_000_000_000),
    })),
  };
}

export async function details_client({ nom_ou_telephone }, workspaceId) {
  if (!nom_ou_telephone) return { error: 'Nom ou téléphone requis' };

  const clean = String(nom_ou_telephone).replace(/\D/g, '');
  const isPhone = clean.length >= 6;

  const [rows] = await pool.execute(
    `SELECT nomclient, telephone,
            COUNT(*) AS nb_commandes,
            COALESCE(SUM(montant_total), 0) AS total_achete,
            MAX(date_commande) AS derniere_commande,
            MIN(date_commande) AS premiere_commande
     FROM commandes_vente
     WHERE id_utilisateur = ?
       AND ${isPhone ? 'telephone LIKE ?' : 'nomclient LIKE ?'}
       AND statut NOT IN ('annulee')
     GROUP BY nomclient, telephone
     ORDER BY total_achete DESC
     LIMIT 3`,
    [workspaceId, isPhone ? `%${clean}%` : `%${nom_ou_telephone}%`]
  );

  if (rows.length === 0) {
    return { found: false, message: `Aucun client trouvé pour "${nom_ou_telephone}"` };
  }

  return {
    found: true,
    clients: rows.map((r) => ({
      nom: r.nomclient || 'Anonyme',
      telephone: r.telephone,
      nombre_commandes: parseInt(r.nb_commandes) || 0,
      total_achete: safeNumber(r.total_achete, 10_000_000_000),
      premiere_commande: r.premiere_commande,
      derniere_commande: r.derniere_commande,
    })),
  };
}

// ============================================================
// 🏪 BOUTIQUE
// ============================================================
export async function info_boutique(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT nom_commercial, slogan, telephone, telephone2, whatsapp,
            email, quartier, ville, pays, description
     FROM magasins
     WHERE id_utilisateur = ? AND actif = TRUE
     LIMIT 1`,
    [workspaceId]
  );

  if (rows.length === 0) {
    return { found: false, message: 'Aucune information de boutique enregistrée.' };
  }

  const m = rows[0];
  return {
    found: true,
    nom_commercial: m.nom_commercial || 'Non renseigné',
    slogan: m.slogan || null,
    telephone: m.telephone || null,
    telephone2: m.telephone2 || null,
    whatsapp: m.whatsapp || null,
    email: m.email || null,
    adresse: [m.quartier, m.ville, m.pays].filter(Boolean).join(', ') || null,
    description: m.description || null,
  };
}

// ============================================================
// 🚚 FOURNISSEURS
// ============================================================
export async function lister_fournisseurs({ recherche = '' }, workspaceId) {
  let query = `
    SELECT f.id_fournisseur, f.nom, f.telephone, f.ville, f.pays,
           COUNT(p.id_produit) AS nb_produits
    FROM fournisseurs f
    LEFT JOIN produits p ON p.id_fournisseur = f.id_fournisseur
    WHERE f.id_utilisateur = ? AND f.actif = TRUE
  `;
  const params = [workspaceId];

  if (recherche && recherche.trim().length > 0) {
    query += ` AND f.nom LIKE ?`;
    params.push(`%${recherche.trim()}%`);
  }

  query += ` GROUP BY f.id_fournisseur ORDER BY f.nom ASC LIMIT 30`;

  const [rows] = await pool.execute(query, params);

  return {
    count: rows.length,
    fournisseurs: rows.map((r) => ({
      nom: r.nom,
      telephone: r.telephone || null,
      ville: r.ville || null,
      pays: r.pays || null,
      nb_produits: parseInt(r.nb_produits) || 0,
    })),
  };
}

export async function details_fournisseur({ nom }, workspaceId) {
  if (!nom) return { error: 'Nom du fournisseur requis' };

  const [rows] = await pool.execute(
    `SELECT id_fournisseur, nom, telephone, email, ville, pays
     FROM fournisseurs
     WHERE id_utilisateur = ? AND nom LIKE ?
     LIMIT 1`,
    [workspaceId, `%${nom.trim()}%`]
  );

  if (rows.length === 0) {
    return { found: false, message: `Aucun fournisseur trouvé pour "${nom}"` };
  }
  const f = rows[0];

  const [produits] = await pool.execute(
    `SELECT COUNT(*) AS nb FROM produits WHERE id_fournisseur = ?`,
    [f.id_fournisseur]
  );

  const [achats] = await pool.execute(
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS total
     FROM commandes_achat
     WHERE id_fournisseur = ? AND statut NOT IN ('annulee')`,
    [f.id_fournisseur]
  );

  return {
    found: true,
    fournisseur: {
      nom: f.nom,
      telephone: f.telephone,
      email: f.email,
      ville: f.ville,
      pays: f.pays,
      nombre_produits: parseInt(produits[0].nb) || 0,
      nombre_commandes_achat: parseInt(achats[0].nb) || 0,
      total_achats: safeNumber(achats[0].total, 10_000_000_000),
    },
  };
}

// ============================================================
// 🏷️ CATÉGORIES
// ============================================================
export async function lister_categories(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT c.nom, COUNT(p.id_produit) AS nb_produits,
            COALESCE(SUM(p.quantite_stock * p.prix_vente), 0) AS valeur_vente
     FROM categories c
     LEFT JOIN produits p ON p.id_categorie = c.id_categorie
     WHERE c.id_utilisateur = ? AND c.statut = 'actif'
     GROUP BY c.id_categorie, c.nom
     ORDER BY nb_produits DESC
     LIMIT 30`,
    [workspaceId]
  );

  return {
    count: rows.length,
    categories: rows.map((r) => ({
      nom: r.nom,
      nb_produits: parseInt(r.nb_produits) || 0,
      valeur_vente: safeNumber(r.valeur_vente, 10_000_000_000),
    })),
  };
}

// ============================================================
// 🏷️ MARQUES
// ============================================================
export async function lister_marques(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT m.nom, COUNT(p.id_produit) AS nb_produits
     FROM marques m
     LEFT JOIN produits p ON p.id_marque = m.id_marque
     WHERE m.id_utilisateur = ? AND m.actif = TRUE
     GROUP BY m.id_marque, m.nom
     ORDER BY nb_produits DESC
     LIMIT 30`,
    [workspaceId]
  );

  return {
    count: rows.length,
    marques: rows.map((r) => ({
      nom: r.nom,
      nb_produits: parseInt(r.nb_produits) || 0,
    })),
  };
}

// ============================================================
// 📦 MOUVEMENTS DE STOCK
// ============================================================
export async function derniers_mouvements({ limite = 10 }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 10, 1), 30);

  const [rows] = await pool.execute(
    `SELECT m.type_mouvement, m.quantite, m.ancienne_quantite, m.nouvelle_quantite,
            m.notes, m.date_mouvement,
            p.nom AS produit_nom,
            u.symbole AS unite_symbole
     FROM mouvements_stock m
     LEFT JOIN produits p ON m.id_produit = p.id_produit
     LEFT JOIN unites u ON p.id_unite = u.id_unite
     WHERE m.id_utilisateur = ?
     ORDER BY m.date_mouvement DESC
     LIMIT ${limit}`,
    [workspaceId]
  );

  return {
    count: rows.length,
    mouvements: rows.map((r) => ({
      type: r.type_mouvement,
      produit: r.produit_nom || 'Produit supprimé',
      quantite: safeNumber(r.quantite),
      unite: r.unite_symbole || 'unité',
      ancien_stock: safeNumber(r.ancienne_quantite),
      nouveau_stock: safeNumber(r.nouvelle_quantite),
      notes: r.notes || null,
      date: r.date_mouvement,
    })),
  };
}

// ============================================================
// 💸 DÉPENSES
// ============================================================
export async function depenses_periode({ date_debut, date_fin }, workspaceId) {
  const debut =
    date_debut ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const fin = date_fin || new Date().toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `SELECT cd.nom AS categorie, COUNT(d.id_depense) AS nb,
            COALESCE(SUM(d.montant), 0) AS total
     FROM depenses d
     LEFT JOIN categories_depenses cd ON d.id_categorie_depense = cd.id_categorie_depense
     WHERE d.id_utilisateur = ?
       AND d.date_depense BETWEEN ? AND ?
     GROUP BY cd.id_categorie_depense, cd.nom
     ORDER BY total DESC`,
    [workspaceId, debut, fin]
  );

  const total = rows.reduce((s, r) => s + safeNumber(r.total, 100_000_000), 0);

  return {
    periode: { debut, fin },
    total_depenses: total,
    par_categorie: rows.map((r) => ({
      categorie: r.categorie || 'Sans catégorie',
      nombre: parseInt(r.nb) || 0,
      montant: safeNumber(r.total, 100_000_000),
    })),
  };
}

// ============================================================
// ↩️ RETOURS CLIENTS
// ============================================================
export async function retours_clients_recents({ limite = 10 }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 10, 1), 30);

  const [rows] = await pool.execute(
    `SELECT numero_retour, nomclient, telephone, motif_retour,
            montant_total, statut, date_retour
     FROM retours_clients
     WHERE id_utilisateur = ?
     ORDER BY date_retour DESC
     LIMIT ${limit}`,
    [workspaceId]
  );

  const total = rows.reduce((s, r) => s + safeNumber(r.montant_total), 0);

  return {
    count: rows.length,
    montant_total: total,
    retours: rows.map((r) => ({
      numero: r.numero_retour,
      client: r.nomclient || r.telephone || 'Anonyme',
      motif: r.motif_retour,
      montant: safeNumber(r.montant_total),
      statut: r.statut,
      date: r.date_retour,
    })),
  };
}

// ============================================================
// 🆕 INVENTAIRES
// ============================================================
export async function inventaires_recents({ limite = 10, statut }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 10, 1), 30);

  let query = `
    SELECT reference, libelle, date_debut, date_fin,
           type_inventaire, statut
    FROM inventaires
    WHERE id_utilisateur = ?`;
  const params = [workspaceId];

  if (statut) {
    query += ` AND statut = ?`;
    params.push(statut);
  }

  query += ` ORDER BY date_debut DESC LIMIT ${limit}`;

  const [rows] = await pool.execute(query, params);

  return {
    count: rows.length,
    inventaires: rows.map((r) => ({
      reference: r.reference,
      libelle: r.libelle,
      date_debut: r.date_debut,
      date_fin: r.date_fin,
      type: r.type_inventaire,
      statut: r.statut,
    })),
  };
}

export async function details_inventaire({ reference }, workspaceId) {
  if (!reference) return { error: "Référence de l'inventaire requise" };

  const [inv] = await pool.execute(
    `SELECT id_inventaire, reference, libelle, date_debut, date_fin,
            type_inventaire, statut, notes
     FROM inventaires
     WHERE id_utilisateur = ? AND reference = ?
     LIMIT 1`,
    [workspaceId, reference]
  );

  if (inv.length === 0) {
    return { found: false, message: `Aucun inventaire trouvé pour "${reference}"` };
  }
  const i = inv[0];

  const [lignes] = await pool.execute(
    `SELECT p.nom AS produit_nom, il.quantite_theorique, il.quantite_reelle,
            il.ecart, il.notes
     FROM inventaire_lignes il
     LEFT JOIN produits p ON il.id_produit = p.id_produit
     WHERE il.id_inventaire = ?
     ORDER BY ABS(il.ecart) DESC
     LIMIT 50`,
    [i.id_inventaire]
  );

  const totalEcart = lignes.reduce((s, l) => s + Math.abs(safeNumber(l.ecart)), 0);

  return {
    found: true,
    inventaire: {
      reference: i.reference,
      libelle: i.libelle,
      periode: { debut: i.date_debut, fin: i.date_fin },
      type: i.type_inventaire,
      statut: i.statut,
      notes: i.notes,
      nombre_lignes: lignes.length,
      ecart_total_absolu: totalEcart,
      lignes: lignes.map((l) => ({
        produit: l.produit_nom || 'Produit supprimé',
        theorique: safeNumber(l.quantite_theorique),
        reel: safeNumber(l.quantite_reelle),
        ecart: safeNumber(l.ecart),
        notes: l.notes,
      })),
    },
  };
}

// ============================================================
// 👤 EMPLOYÉS / MAGASINS
// ============================================================
export async function lister_employes({ actif_seulement = true }, workspaceId) {
  let query = `
    SELECT e.fullname, e.slug, e.telephone, e.actif, e.date_creation,
           r.nom AS role_nom, m.nom_commercial AS magasin_nom
    FROM employes e
    LEFT JOIN roles r ON e.id_role = r.id_role
    LEFT JOIN magasins m ON e.id_magasin = m.id_magasin
    WHERE e.id_utilisateur = ?`;
  const params = [workspaceId];

  if (actif_seulement) query += ` AND e.actif = TRUE`;
  query += ` ORDER BY e.fullname ASC LIMIT 50`;

  const [rows] = await pool.execute(query, params);

  return {
    count: rows.length,
    employes: rows.map((r) => ({
      nom: r.fullname,
      telephone: r.telephone,
      role: r.role_nom || null,
      magasin: r.magasin_nom || null,
      actif: !!r.actif,
      date_embauche: r.date_creation,
    })),
  };
}

export async function lister_magasins(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT id_magasin, nom_commercial, slogan, quartier, ville, pays,
            telephone, whatsapp, email, actif, date_creation
     FROM magasins
     WHERE id_utilisateur = ?
     ORDER BY actif DESC, nom_commercial ASC`,
    [workspaceId]
  );

  return {
    count: rows.length,
    magasins: rows.map((m) => ({
      nom: m.nom_commercial || 'Sans nom',
      slogan: m.slogan,
      adresse: [m.quartier, m.ville, m.pays].filter(Boolean).join(', ') || null,
      telephone: m.telephone,
      whatsapp: m.whatsapp,
      email: m.email,
      actif: !!m.actif,
      date_creation: m.date_creation,
    })),
  };
}

// ============================================================
// 📊 VUES RAPPORTS
// ============================================================
export async function benefices_periode({ date_debut, date_fin }, workspaceId) {
  const debut =
    date_debut ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const fin = date_fin || new Date().toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `SELECT 
        COALESCE(SUM(lcv.montant_total), 0) AS total_ventes,
        COALESCE(SUM(lcv.quantite_totale_base * p.prix_achat), 0) AS cout_achat,
        COALESCE(SUM(lcv.montant_total - (lcv.quantite_totale_base * p.prix_achat)), 0) AS benefice
     FROM ligne_commande_vente lcv
     JOIN produits p ON lcv.id_produit = p.id_produit
     JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
     WHERE cv.id_utilisateur = ?
       AND cv.date_commande BETWEEN ? AND ?
       AND cv.statut NOT IN ('annulee')`,
    [workspaceId, debut, fin]
  );

  const r = rows[0];
  const totalVentes = safeNumber(r.total_ventes, 10_000_000_000);
  const coutAchat = safeNumber(r.cout_achat, 10_000_000_000);
  const benefice = safeNumber(r.benefice, 10_000_000_000);

  return {
    periode: { debut, fin },
    total_ventes: totalVentes,
    cout_achat: coutAchat,
    benefice,
    marge_pourcentage:
      totalVentes > 0 ? Math.round((benefice / totalVentes) * 100) : 0,
  };
}

export async function rapport_ventes_complet({ date_debut, date_fin }, workspaceId) {
  if (!date_debut || !date_fin) {
    return { error: 'date_debut et date_fin requis' };
  }

  const [rows] = await pool.execute(
    `SELECT 
        cv.numero_commande, cv.date_commande, cv.nomclient, cv.telephone,
        cv.montant_total, cv.statut,
        fv.numero_facture, fv.statut AS statut_facture,
        fv.date_echeance, fv.mode_paiement
     FROM commandes_vente cv
     LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
     WHERE cv.id_utilisateur = ?
       AND cv.date_commande BETWEEN ? AND ?
     ORDER BY cv.date_commande DESC
     LIMIT 100`,
    [workspaceId, date_debut, date_fin]
  );

  const total = rows.reduce((s, r) => s + safeNumber(r.montant_total), 0);
  const parStatut = {};
  rows.forEach((r) => {
    parStatut[r.statut] = (parStatut[r.statut] || 0) + 1;
  });

  return {
    periode: { debut: date_debut, fin: date_fin },
    total_commandes: rows.length,
    montant_total: total,
    repartition_par_statut: parStatut,
    commandes: rows.map((r) => ({
      numero: r.numero_commande,
      date: r.date_commande,
      client: r.nomclient || r.telephone || 'Anonyme',
      montant: safeNumber(r.montant_total),
      statut: r.statut,
      facture: r.numero_facture || null,
      statut_facture: r.statut_facture || null,
    })),
  };
}

export async function rapport_stocks_complet({ limite = 50 }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 50, 1), 200);

  const [rows] = await pool.execute(
    `SELECT 
        p.id_produit, p.nom, p.quantite_stock, p.quantite_minimale, p.quantite_maximale,
        p.prix_achat, p.prix_vente, p.statut,
        u.symbole AS unite_symbole, u.nom AS unite_nom,
        c.nom AS categorie_nom,
        CASE
          WHEN p.quantite_stock <= 0 OR p.statut = 'rupture' THEN 'rupture'
          WHEN p.quantite_stock <= p.quantite_minimale THEN 'alerte_bas'
          WHEN p.quantite_stock >= p.quantite_maximale AND p.quantite_maximale > 0 THEN 'alerte_haut'
          ELSE 'normal'
        END AS etat_stock
     FROM produits p
     LEFT JOIN unites u ON p.id_unite = u.id_unite
     LEFT JOIN categories c ON p.id_categorie = c.id_categorie
     WHERE p.id_utilisateur = ?
     ORDER BY 
       CASE
         WHEN p.quantite_stock <= 0 OR p.statut = 'rupture' THEN 0
         WHEN p.quantite_stock <= p.quantite_minimale THEN 1
         ELSE 2
       END,
       p.nom ASC
     LIMIT ${limit}`,
    [workspaceId]
  );

  const unitesParProduit = await chargerUnitesVente(rows.map((r) => r.id_produit));

  const stats = { normal: 0, alerte_bas: 0, alerte_haut: 0, rupture: 0 };
  rows.forEach((r) => {
    stats[r.etat_stock] = (stats[r.etat_stock] || 0) + 1;
  });

  return {
    count: rows.length,
    repartition_etats: stats,
    produits: rows.map((r) => {
      const stockBase = safeNumber(r.quantite_stock);
      const uniteBase = r.unite_symbole || r.unite_nom || 'unité';
      const unitesVente = unitesParProduit[r.id_produit] || [];
      const affichage = formaterQuantite(stockBase, uniteBase, unitesVente);

      return {
        nom: r.nom,
        quantite_disponible: affichage.quantite,
        unite_affichage: affichage.unite,
        reponse_humaine: affichage.phrase,
        stock_en_unite_base: `${stockBase} ${uniteBase}(s)`,
        stock_chiffre: stockBase,
        unite_base: uniteBase,
        stock_min: safeNumber(r.quantite_minimale),
        prix_achat: safeNumber(r.prix_achat),
        prix_vente: safeNumber(r.prix_vente),
        categorie: r.categorie_nom || null,
        etat: r.etat_stock,
      };
    }),
  };
}

// ============================================================
// 🔍 RECHERCHES AVANCÉES
// ============================================================
export async function ventes_produit_periode(
  { nom_produit, date_debut, date_fin },
  workspaceId
) {
  if (!nom_produit) return { error: 'Nom du produit requis' };

  const fin = date_fin || new Date().toISOString().slice(0, 10);
  const debut =
    date_debut ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const produits = await Produit.search(nom_produit.trim(), workspaceId);
  if (!produits || produits.length === 0) {
    return { found: false, message: `Aucun produit trouvé pour "${nom_produit}"` };
  }
  const produit = produits[0];

  const [rows] = await pool.execute(
    `SELECT 
        COALESCE(SUM(lcv.quantite_totale_base), 0) AS total_vendu_base,
        COALESCE(SUM(lcv.montant_total), 0) AS ca,
        COUNT(DISTINCT cv.id_commande) AS nb_commandes
     FROM ligne_commande_vente lcv
     JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
     WHERE cv.id_utilisateur = ?
       AND lcv.id_produit = ?
       AND cv.date_commande BETWEEN ? AND ?
       AND cv.statut NOT IN ('annulee')`,
    [workspaceId, produit.id_produit, debut, fin]
  );

  const r = rows[0];
  const uniteBase = produit.unite_symbole || produit.unite_nom || 'unité';
  const unitesParProduit = await chargerUnitesVente([produit.id_produit]);
  const unitesVente = unitesParProduit[produit.id_produit] || [];
  const affichage = formaterQuantite(
    safeNumber(r.total_vendu_base),
    uniteBase,
    unitesVente
  );

  return {
    produit: produit.nom,
    periode: { debut, fin },
    quantite_vendue: affichage.quantite,
    unite_affichage: affichage.unite,
    reponse_humaine: affichage.phrase,
    quantite_vendue_base: safeNumber(r.total_vendu_base),
    unite_base: uniteBase,
    chiffre_affaires: safeNumber(r.ca, 10_000_000_000),
    nombre_commandes: parseInt(r.nb_commandes) || 0,
  };
}

export async function produits_non_vendus({ jours = 90, limite = 20 }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 20, 1), 50);
  const joursNum = Math.min(Math.max(parseInt(jours) || 90, 1), 3650);

  const [rows] = await pool.execute(
    `SELECT p.id_produit, p.nom, p.quantite_stock, 
            u.symbole AS unite_symbole, u.nom AS unite_nom,
            MAX(cv.date_commande) AS derniere_vente
     FROM produits p
     LEFT JOIN unites u ON p.id_unite = u.id_unite
     LEFT JOIN ligne_commande_vente lcv ON lcv.id_produit = p.id_produit
     LEFT JOIN commandes_vente cv 
       ON lcv.id_commande = cv.id_commande 
       AND cv.statut NOT IN ('annulee')
     WHERE p.id_utilisateur = ?
     GROUP BY p.id_produit, p.nom, p.quantite_stock, u.symbole, u.nom
     HAVING derniere_vente IS NULL 
        OR derniere_vente < DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY derniere_vente ASC, p.nom ASC
     LIMIT ${limit}`,
    [workspaceId, joursNum]
  );

  const unitesParProduit = await chargerUnitesVente(rows.map((r) => r.id_produit));

  return {
    periode_jours: joursNum,
    count: rows.length,
    produits: rows.map((r) => {
      const stockBase = safeNumber(r.quantite_stock);
      const uniteBase = r.unite_symbole || r.unite_nom || 'unité';
      const unitesVente = unitesParProduit[r.id_produit] || [];
      const affichage = formaterQuantite(stockBase, uniteBase, unitesVente);

      return {
        nom: r.nom,
        quantite_disponible: affichage.quantite,
        unite_affichage: affichage.unite,
        reponse_humaine: affichage.phrase,
        derniere_vente: r.derniere_vente || 'Jamais vendu',
      };
    }),
  };
}

export async function comparer_ventes_periodes(
  { periode1_debut, periode1_fin, periode2_debut, periode2_fin },
  workspaceId
) {
  if (!periode1_debut || !periode1_fin || !periode2_debut || !periode2_fin) {
    return { error: 'Les 4 dates sont requises' };
  }

  const [r1] = await pool.execute(
    `SELECT COUNT(DISTINCT id_commande) AS nb, COALESCE(SUM(montant_total), 0) AS ca
     FROM commandes_vente
     WHERE id_utilisateur = ? AND date_commande BETWEEN ? AND ?
       AND statut NOT IN ('annulee')`,
    [workspaceId, periode1_debut, periode1_fin]
  );

  const [r2] = await pool.execute(
    `SELECT COUNT(DISTINCT id_commande) AS nb, COALESCE(SUM(montant_total), 0) AS ca
     FROM commandes_vente
     WHERE id_utilisateur = ? AND date_commande BETWEEN ? AND ?
       AND statut NOT IN ('annulee')`,
    [workspaceId, periode2_debut, periode2_fin]
  );

  const ca1 = safeNumber(r1[0].ca, 10_000_000_000);
  const ca2 = safeNumber(r2[0].ca, 10_000_000_000);
  const diff = ca1 - ca2;
  const variationPct = ca2 > 0 ? Math.round((diff / ca2) * 100) : null;

  return {
    periode1: { debut: periode1_debut, fin: periode1_fin, ca: ca1, commandes: r1[0].nb },
    periode2: { debut: periode2_debut, fin: periode2_fin, ca: ca2, commandes: r2[0].nb },
    difference_ca: diff,
    variation_pourcentage: variationPct,
    tendance: diff > 0 ? 'hausse' : diff < 0 ? 'baisse' : 'stable',
  };
}

// ============================================================
// 🚫 NO-OP : salutations et hors-sujet
// ============================================================
export async function aucune_action({ raison } = {}) {
  return { ok: true, note: raison || 'Aucune action nécessaire' };
}

// ============================================================
// 📤 EXPORT
// ============================================================
export const toolExecutors = {
  // Produits
  rechercher_produit,
  lister_produits,
  details_produit,

  // Alertes
  produits_en_rupture,
  produits_stock_bas,

  // Stats
  stats_generales,
  valeur_stock,
  stock_par_categorie,
  stock_par_fournisseur,

  // Ventes
  chiffre_affaires,
  top_produits,
  ventes_produit_periode,
  produits_non_vendus,
  comparer_ventes_periodes,

  // Factures
  factures_impayees,

  // Commandes
  commandes_en_attente,
  commandes_par_periode,
  commandes_par_statut,

  // Clients
  rechercher_client,
  top_clients,
  details_client,

  // Boutique
  info_boutique,

  // Fournisseurs
  lister_fournisseurs,
  details_fournisseur,

  // Catégories / Marques
  lister_categories,
  lister_marques,

  // Mouvements
  derniers_mouvements,

  // Dépenses
  depenses_periode,

  // Retours
  retours_clients_recents,

  // Inventaires
  inventaires_recents,
  details_inventaire,

  // Employés / Magasins
  lister_employes,
  lister_magasins,

  // Rapports
  benefices_periode,
  rapport_ventes_complet,
  rapport_stocks_complet,

  // No-op
  aucune_action,
};