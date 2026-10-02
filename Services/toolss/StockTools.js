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
// Retourne un tableau { nom, contient, quantite, reste_en_base, phrase }
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
    });
  }
  return map;
}

// ============================================================
// PRODUITS
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
    const decompositions = decomposerStock(stockBase, uniteBase, unitesVente);

    // ✅ Phrase humanisée complète, directement lisible par l'IA
    const reponseHumaine =
      decompositions.length > 0
        ? `${stockBase} ${uniteBase}(s) = ${decompositions.map((d) => d.phrase).join(' + ')}`
        : `${stockBase} ${uniteBase}(s)`;

    return {
      nom: p.nom,

      // ✅ Champs explicites (plus jamais d'ambiguïté base/conditionnement)
      stock_total_en_unite_base: `${stockBase} ${uniteBase}(s)`,
      stock_total_chiffre: stockBase,
      unite_base: uniteBase,
      reponse_humaine: reponseHumaine,

      // ✅ Détail des conditionnements
      conditionnements: decompositions.map((d) => ({
        nom: d.nom,
        contient_nb_unites_base: d.contient,
        quantite_disponible: d.quantite,
        reste_en_unite_base: d.reste_en_base,
        phrase_complete: d.phrase,
      })),

      // Prix + méta
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
      const decompositions = decomposerStock(stockBase, uniteBase, unitesVente);

      const conditionnementsPhrase =
        decompositions.length > 0
          ? decompositions.map((d) => d.phrase).join(' | ')
          : null;

      return {
        nom: r.nom,
        stock_en_unite_base: `${stockBase} ${uniteBase}(s)`,
        stock_chiffre: stockBase,
        unite_base: uniteBase,
        conditionnements: conditionnementsPhrase, // "6 Carton(s) + 8 bidon(s)" ou null
        stock_min: safeNumber(r.quantite_minimale),
        prix_vente_unite_base: safeNumber(r.prix_vente),
        statut: r.statut,
        categorie: r.categorie_nom || null,
      };
    }),
  };
}

// ============================================================
// ALERTES
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
      const decompositions = decomposerStock(stockBase, uniteBase, unitesVente);

      return {
        nom: r.nom,
        stock_en_unite_base: `${stockBase} ${uniteBase}(s)`,
        stock_chiffre: stockBase,
        unite_base: uniteBase,
        conditionnements:
          decompositions.length > 0
            ? decompositions.map((d) => d.phrase).join(' | ')
            : null,
        stock_min: safeNumber(r.quantite_minimale),
        fournisseur: r.fournisseur_nom || null,
      };
    }),
  };
}

// ============================================================
// STATISTIQUES STOCK
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
// VENTES
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

  return {
    periode: { debut, fin },
    count: rows.length,
    produits: rows.map((r) => ({
      nom: r.nom,
      total_vendu: safeNumber(r.total_vendu),
      chiffre_affaires: safeNumber(r.chiffre_affaires, 10_000_000_000),
    })),
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
// COMMANDES
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

// ============================================================
// CLIENTS
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

// ============================================================
// BOUTIQUE
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
// FOURNISSEURS
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

// ============================================================
// CATÉGORIES
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
// MARQUES
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
// MOUVEMENTS DE STOCK
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
// DÉPENSES
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
// RETOURS CLIENTS
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
// NO-OP : pour salutations et hors-sujet
// ============================================================
export async function aucune_action({ raison } = {}) {
  return { ok: true, note: raison || 'Aucune action nécessaire' };
}

// ============================================================
// EXPORT
// ============================================================
export const toolExecutors = {
  rechercher_produit,
  lister_produits,
  produits_en_rupture,
  produits_stock_bas,
  stats_generales,
  valeur_stock,
  stock_par_categorie,
  stock_par_fournisseur,
  chiffre_affaires,
  top_produits,
  factures_impayees,
  commandes_en_attente,
  rechercher_client,
  top_clients,
  info_boutique,
  lister_fournisseurs,
  lister_categories,
  lister_marques,
  derniers_mouvements,
  depenses_periode,
  retours_clients_recents,
  aucune_action,
};