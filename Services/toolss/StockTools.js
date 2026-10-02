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

  // ✅ Charger les unités de vente de chaque produit
  const produitsEnrichis = await Promise.all(
    produits.slice(0, 5).map(async (p) => {
      let unitesVente = [];
      try {
        const [unites] = await pool.execute(
          `SELECT nom, quantite_base, prix_vente, est_principal
           FROM unites_vente
           WHERE id_produit = ? AND actif = TRUE
           ORDER BY est_principal DESC, quantite_base ASC`,
          [p.id_produit]
        );
        unitesVente = unites.map(u => ({
          nom: u.nom,
          quantite_base: parseFloat(u.quantite_base) || 1,
          prix_vente: safeNumber(u.prix_vente),
        }));
      } catch (e) {
        console.warn(`⚠️ Unités vente produit ${p.id_produit}:`, e.message);
      }

      const stockBase = safeNumber(p.quantite_stock);
      const uniteBase = p.unite_symbole || p.unite_nom || 'unité';

      // ✅ Calcul de la décomposition en conditionnements
      const decompositions = unitesVente
        .filter(u => u.quantite_base > 1)
        .map(u => {
          const qte = Math.floor(stockBase / u.quantite_base);
          const reste = stockBase - qte * u.quantite_base;
          return {
            conditionnement: u.nom,
            contient: u.quantite_base,
            unite_base: uniteBase,
            quantite: qte,
            reste_en_base: reste,
            phrase: reste > 0
              ? `${qte} ${u.nom}(s) + ${reste} ${uniteBase}(s)`
              : `${qte} ${u.nom}(s)`,
          };
        });

      return {
        nom: p.nom,
        stock_base: stockBase,
        unite_base: uniteBase,
        prix_vente_base: safeNumber(p.prix_vente),
        prix_achat_base: safeNumber(p.prix_achat),
        statut: p.statut,
        categorie: p.categorie_nom || null,
        marque: p.marque_nom || null,
        // ✅ NOUVEAU : la décomposition en cartons, palettes, etc.
        conditionnements: decompositions,
        unites_vente: unitesVente,
      };
    })
  );

  return {
    found: true,
    count: produits.length,
    produits: produitsEnrichis,
  };
}

export async function lister_produits({ limite = 30 }, workspaceId) {
  const limit = Math.min(Math.max(parseInt(limite) || 30, 1), 100);

  const [rows] = await pool.execute(
    `SELECT p.nom, p.quantite_stock, p.quantite_minimale, p.prix_vente, p.statut,
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

  return {
    count: rows.length,
    produits: rows.map(r => ({
      nom: r.nom,
      stock: safeNumber(r.quantite_stock),
      stock_min: safeNumber(r.quantite_minimale),
      unite: r.unite_symbole || r.unite_nom || 'unité',
      prix_vente: safeNumber(r.prix_vente),
      statut: r.statut,
      categorie: r.categorie_nom || null,
    })),
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
    produits: rows.map(r => ({
      nom: r.nom,
      unite: r.unite_symbole || r.unite_nom || 'unité',
      fournisseur: r.fournisseur_nom || null,
      telephone_fournisseur: r.fournisseur_tel || null,
    })),
  };
}

export async function produits_stock_bas(args, workspaceId) {
  const [rows] = await pool.execute(
    `SELECT p.nom, p.quantite_stock, p.quantite_minimale,
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

  return {
    count: rows.length,
    produits: rows.map(r => ({
      nom: r.nom,
      stock: safeNumber(r.quantite_stock),
      stock_min: safeNumber(r.quantite_minimale),
      unite: r.unite_symbole || r.unite_nom || 'unité',
      fournisseur: r.fournisseur_nom || null,
    })),
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
    categories: rows.map(r => ({
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
    fournisseurs: rows.map(r => ({
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
  const debut = date_debut || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
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
  const debut = date_debut || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
    produits: rows.map(r => ({
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
    factures: rows.map(r => ({
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
    commandes: rows.map(r => ({
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
    clients: rows.map(r => ({
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
  const debut = date_debut || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
    clients: rows.map(r => ({
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
};