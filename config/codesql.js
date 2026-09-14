// config/schema.sql.js
const creation_tables = `-- =============================================================================
-- BASE DE DONNÉES STOCK - SCRIPT DE CRÉATION COMPLET MULTI-TENANT
-- Chaque table est isolée par id_utilisateur
-- =============================================================================

-- =============================================================================
-- UTILISATEURS ET RÔLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id_role INT PRIMARY KEY AUTO_INCREMENT,
    nom VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS utilisateurs (
    id_utilisateur INT PRIMARY KEY AUTO_INCREMENT,
    id_role INT,
    fullname VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255) NOT NULL,
    telephone VARCHAR(20),
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    derniere_connexion TIMESTAMP NULL DEFAULT NULL,
    INDEX idx_email (email),
    INDEX idx_telephone (telephone),
    INDEX idx_slug (slug),
    FOREIGN KEY (id_role) REFERENCES roles(id_role) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- CLIENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS clients (
    id_client INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(200) NOT NULL,
    description TEXT,
    adresse TEXT,
    ville VARCHAR(100),
    pays VARCHAR(100),
    code_postal VARCHAR(20),
    telephone VARCHAR(20),
    email VARCHAR(100),
    numero_tva VARCHAR(50),
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_email (email),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- PRODUITS - CATÉGORIES, MARQUES, MODÈLES, UNITÉS
-- =============================================================================

CREATE TABLE IF NOT EXISTS categories (
    id_categorie INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(100) NOT NULL,
    description TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    statut ENUM('actif', 'inactif') DEFAULT 'actif',
    date_modification DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marques (
    id_marque INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(100) NOT NULL,
    description TEXT,
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_marque_par_user (nom, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modeles (
    id_modele INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(100) NOT NULL,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unites (
    id_unite INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(50) NOT NULL,
    symbole VARCHAR(10) NOT NULL,
    description VARCHAR(255),
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_unite_par_user (nom, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fournisseurs (
    id_fournisseur INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(200) NOT NULL,
    telephone VARCHAR(20),
    email VARCHAR(100),
    ville VARCHAR(100),
    pays VARCHAR(100),
    numero_tva VARCHAR(50),
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_telephone (telephone),
    INDEX idx_email (email),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produits (
    id_produit INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(200) NOT NULL,
    description TEXT,
    id_categorie INT,
    id_marque INT,
    id_modele INT,
    id_unite INT,
    id_fournisseur INT,
    -- ⚠️ IMPORTANT : prix_achat et prix_vente sont TOUJOURS en UNITÉ DE BASE (ex: bidon)
    -- Les prix des conditionnements (carton, palette...) sont dans unites_vente
    prix_achat DECIMAL(15, 2) DEFAULT 0,
    prix_vente DECIMAL(15, 2) DEFAULT 0,
    -- ⚠️ quantite_stock est TOUJOURS en UNITÉ DE BASE (ex: bidon)
    quantite_stock DECIMAL(15, 2) DEFAULT 0,
    quantite_minimale DECIMAL(15, 2) DEFAULT 0,
    quantite_maximale DECIMAL(15, 2) DEFAULT 0,
    emplacement VARCHAR(100),
    rayon VARCHAR(50),
    etagere VARCHAR(50),
    statut ENUM('disponible', 'rupture') DEFAULT 'disponible',
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_categorie (id_categorie),
    INDEX idx_marque (id_marque),
    INDEX idx_modele (id_modele),
    INDEX idx_unite (id_unite),
    INDEX idx_fournisseur (id_fournisseur),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_categorie) REFERENCES categories(id_categorie) ON DELETE SET NULL,
    FOREIGN KEY (id_marque) REFERENCES marques(id_marque) ON DELETE SET NULL,
    FOREIGN KEY (id_modele) REFERENCES modeles(id_modele) ON DELETE SET NULL,
    FOREIGN KEY (id_unite) REFERENCES unites(id_unite) ON DELETE SET NULL,
    FOREIGN KEY (id_fournisseur) REFERENCES fournisseurs(id_fournisseur) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- UNITÉS DE VENTE (conditionnements : carton, palette, sachet...)
-- quantite_base = nombre d'unités de base dans ce conditionnement
-- Ex: carton de 12 bidons → quantite_base = 12
-- =============================================================================
CREATE TABLE IF NOT EXISTS unites_vente (
    id_unite_vente INT PRIMARY KEY AUTO_INCREMENT,
    id_produit INT NOT NULL,
    nom VARCHAR(50) NOT NULL,
    quantite_base DECIMAL(15, 2) NOT NULL DEFAULT 1,
    -- Prix du conditionnement (ex: prix du carton)
    prix_vente DECIMAL(15, 2) NOT NULL DEFAULT 0,
    prix_achat DECIMAL(15, 2) NOT NULL DEFAULT 0,
    est_principal BOOLEAN DEFAULT FALSE,
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_produit (id_produit),
    INDEX idx_principal (est_principal),
    UNIQUE KEY unique_nom_par_produit (nom, id_produit),
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- COMMANDES D'ACHAT
-- =============================================================================

CREATE TABLE IF NOT EXISTS commandes_achat (
    id_commande_achat INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_commande VARCHAR(50) NOT NULL,
    date_commande DATE NOT NULL,
    id_fournisseur INT NOT NULL,
    statut ENUM('en_attente', 'envoyee', 'partiellement_recue', 'recue', 'annulee') DEFAULT 'en_attente',
    montant_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_numero (numero_commande),
    INDEX idx_fournisseur (id_fournisseur),
    INDEX idx_statut (statut),
    INDEX idx_date (date_commande),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_commande, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_fournisseur) REFERENCES fournisseurs(id_fournisseur) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS ligne_commande_achat (
    id_ligne_achat INT PRIMARY KEY AUTO_INCREMENT,
    id_commande_achat INT NOT NULL,
    id_produit INT NOT NULL,
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite DECIMAL(15, 2) NOT NULL,
    prix_achat DECIMAL(15, 2) NULL DEFAULT NULL,
    remise DECIMAL(15, 2) DEFAULT 0.00,
    montant_total DECIMAL(15, 2) GENERATED ALWAYS AS (
        CASE
            WHEN prix_achat IS NULL THEN NULL
            ELSE quantite * prix_achat * (1 - remise/100)
        END
    ) STORED,
    quantite_totale_base DECIMAL(15, 2) GENERATED ALWAYS AS (quantite * quantite_base) STORED,
    INDEX idx_commande (id_commande_achat),
    INDEX idx_produit (id_produit),
    INDEX idx_unite_vente (id_unite_vente),
    FOREIGN KEY (id_commande_achat) REFERENCES commandes_achat(id_commande_achat) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- =============================================================================
-- RÉCEPTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS receptions (
    id_reception INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_reception VARCHAR(50) NOT NULL,
    date_reception DATE NOT NULL,
    id_commande_achat INT,
    statut ENUM('en_attente', 'partielle', 'complete', 'annulee') DEFAULT 'en_attente',
    montant_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_numero (numero_reception),
    INDEX idx_commande (id_commande_achat),
    INDEX idx_statut (statut),
    INDEX idx_date (date_reception),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_reception, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_commande_achat) REFERENCES commandes_achat(id_commande_achat) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reception_lignes (
    id_ligne_reception INT PRIMARY KEY AUTO_INCREMENT,
    id_reception INT NOT NULL,
    id_produit INT NOT NULL,
    id_ligne_achat INT,

    -- ✅ Traçabilité de l'unité de vente
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite_totale_base DECIMAL(15, 2) DEFAULT 0,

    quantite_commandee DECIMAL(15, 2) DEFAULT 0,
    quantite_recue DECIMAL(15, 2) NOT NULL,
    ecart DECIMAL(15, 2) DEFAULT 0,

    -- ✅ Prix d'achat réel saisi à la réception
    prix_achat_unite_vente DECIMAL(15, 2) NULL DEFAULT NULL,
    prix_achat_base DECIMAL(15, 2) NULL DEFAULT NULL,
    montant_total DECIMAL(15, 2) NULL DEFAULT NULL,

    etat_marchandise ENUM('bon', 'endommager', 'manquant', 'partiel') DEFAULT 'bon',
    num_lot VARCHAR(100),
    date_peremption DATE,
    notes TEXT,

    INDEX idx_reception (id_reception),
    INDEX idx_produit (id_produit),
    INDEX idx_ligne_achat (id_ligne_achat), 
    INDEX idx_unite_vente (id_unite_vente),

    FOREIGN KEY (id_reception) REFERENCES receptions(id_reception) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_ligne_achat) REFERENCES ligne_commande_achat(id_ligne_achat) ON DELETE SET NULL,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- =============================================================================
-- RETOURS FOURNISSEURS
-- =============================================================================

CREATE TABLE IF NOT EXISTS retours_fournisseurs (
    id_retour INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_retour VARCHAR(50) NOT NULL,
    date_retour DATE NOT NULL,
    id_fournisseur INT NOT NULL,
    id_commande_achat INT,
    id_reception INT,
    statut ENUM('en_attente', 'envoye', 'recu_par_fournisseur', 'traite', 'annule') DEFAULT 'en_attente',
    motif_retour ENUM('defectueux', 'non_conforme', 'surplus', 'perime', 'autre') NOT NULL,
    montant_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    date_traitement DATETIME,
    INDEX idx_numero (numero_retour),
    INDEX idx_fournisseur (id_fournisseur),
    INDEX idx_commande (id_commande_achat),
    INDEX idx_reception (id_reception),
    INDEX idx_statut (statut),
    INDEX idx_date (date_retour),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_retour, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_fournisseur) REFERENCES fournisseurs(id_fournisseur) ON DELETE RESTRICT,
    FOREIGN KEY (id_commande_achat) REFERENCES commandes_achat(id_commande_achat) ON DELETE SET NULL,
    FOREIGN KEY (id_reception) REFERENCES receptions(id_reception) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retour_lignes (
    id_ligne_retour INT PRIMARY KEY AUTO_INCREMENT,
    id_retour INT NOT NULL,
    id_produit INT NOT NULL,
    id_ligne_achat INT,
    quantite DECIMAL(15, 2) NOT NULL,
    prix_achat DECIMAL(15, 2) NOT NULL,
    remise DECIMAL(15, 2) DEFAULT 0.00,
    montant_total DECIMAL(15, 2) GENERATED ALWAYS AS (quantite * prix_achat * (1 - remise/100)) STORED,
    motif_retour ENUM('defectueux', 'non_conforme', 'surplus', 'perime', 'autre') NOT NULL,
    etat_produit ENUM('neuf', 'endommage', 'usage') DEFAULT 'neuf',
    notes TEXT,
    INDEX idx_retour (id_retour),
    INDEX idx_produit (id_produit),
    INDEX idx_ligne_achat (id_ligne_achat),
    FOREIGN KEY (id_retour) REFERENCES retours_fournisseurs(id_retour) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_ligne_achat) REFERENCES ligne_commande_achat(id_ligne_achat) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- COMMANDES DE VENTE ET FACTURES
-- =============================================================================

CREATE TABLE IF NOT EXISTS commandes_vente (
    id_commande INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_commande VARCHAR(50) NOT NULL,
    date_commande DATE NOT NULL,
    nomclient VARCHAR(200) NULL,
    telephone VARCHAR(200) NULL,
    statut ENUM('en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee') DEFAULT 'en_attente',
    montant_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_numero (numero_commande),
    INDEX idx_statut (statut),
    INDEX idx_date (date_commande),
    INDEX idx_utilisateur (id_utilisateur),
    INDEX idx_telephone (telephone),
    UNIQUE KEY unique_numero_par_user (numero_commande, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lignes de commande de vente
-- quantite = quantité en unité de vente choisie (ex: 1 carton)
-- quantite_base = conversion (ex: 12)
-- quantite_totale_base = quantite × quantite_base (ex: 12 bidons)
-- prix_vente = prix de l'unité de vente choisie (ex: 30000 F le carton)
CREATE TABLE IF NOT EXISTS ligne_commande_vente (
    id_ligne_vente INT PRIMARY KEY AUTO_INCREMENT,
    id_commande INT NOT NULL,
    id_produit INT NOT NULL,
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite DECIMAL(15, 2) NOT NULL,
    prix_vente DECIMAL(15, 2) NOT NULL,
    remise DECIMAL(15, 2) DEFAULT 0.00,
    montant_total DECIMAL(15, 2) GENERATED ALWAYS AS (quantite * prix_vente * (1 - remise/100)) STORED,
    quantite_totale_base DECIMAL(15, 2) GENERATED ALWAYS AS (quantite * quantite_base) STORED,
    INDEX idx_commande (id_commande),
    INDEX idx_produit (id_produit),
    INDEX idx_unite_vente (id_unite_vente),
    FOREIGN KEY (id_commande) REFERENCES commandes_vente(id_commande) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS factures_vente (
    id_facture INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_facture VARCHAR(50) NOT NULL,
    date_facture DATE NOT NULL,
    date_echeance DATE NOT NULL,
    id_commande INT,
    montant_total DECIMAL(15, 2) DEFAULT 0.00,
    statut ENUM('en_attente', 'payee', 'partiellement_payee', 'en_retard', 'annulee') DEFAULT 'en_attente',
    mode_paiement ENUM('especes', 'carte', 'virement', 'cheque', 'autre') DEFAULT 'especes',
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_numero (numero_facture),
    INDEX idx_commande (id_commande),
    INDEX idx_statut (statut),
    INDEX idx_date (date_facture),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_facture, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_commande) REFERENCES commandes_vente(id_commande) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- PAIEMENTS ET RÈGLEMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS paiements (
    id_paiement INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    id_facture INT NOT NULL,
    date_paiement DATE NOT NULL,
    montant DECIMAL(15, 2) NOT NULL,
    mode_paiement ENUM('especes', 'carte', 'virement', 'cheque', 'autre') DEFAULT 'especes',
    note TEXT,
    reference VARCHAR(100),
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_facture (id_facture),
    INDEX idx_date (date_paiement),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_facture) REFERENCES factures_vente(id_facture) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reglements (
    id_reglement INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_rejet VARCHAR(50) NOT NULL,
    date_rejet DATE NOT NULL,
    montant_total DECIMAL(15, 2) NOT NULL,
    id_facture INT,
    motif VARCHAR(255),
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_numero (numero_rejet),
    INDEX idx_facture (id_facture),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_rejet, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_facture) REFERENCES factures_vente(id_facture) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- RETOURS CLIENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS retours_clients (
    id_retour_client INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_retour VARCHAR(50) NOT NULL,
    date_retour DATE NOT NULL,
    id_commande_vente INT,
    id_facture INT,
    nomclient VARCHAR(200),
    telephone VARCHAR(20),
    email VARCHAR(100),
    adresse TEXT,
    statut ENUM('en_attente', 'recu', 'controle', 'accepte', 'refuse', 'rembourse', 'echange', 'annule') DEFAULT 'en_attente',
    motif_retour ENUM('defectueux', 'non_conforme', 'mecontentement', 'erreur_livraison', 'echange', 'autre') NOT NULL,
    montant_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    date_traitement DATETIME,
    INDEX idx_numero (numero_retour),
    INDEX idx_commande (id_commande_vente),
    INDEX idx_facture (id_facture),
    INDEX idx_statut (statut),
    INDEX idx_date (date_retour),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_retour, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_commande_vente) REFERENCES commandes_vente(id_commande) ON DELETE SET NULL,
    FOREIGN KEY (id_facture) REFERENCES factures_vente(id_facture) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retour_client_lignes (
    id_ligne_retour_client INT PRIMARY KEY AUTO_INCREMENT,
    id_retour_client INT NOT NULL,
    id_produit INT NOT NULL,
    id_ligne_commande_vente INT,
    quantite DECIMAL(15, 2) NOT NULL,
    prix_vente DECIMAL(15, 2) NOT NULL,
    remise DECIMAL(15, 2) DEFAULT 0.00,
    montant_total DECIMAL(15, 2) GENERATED ALWAYS AS (quantite * prix_vente * (1 - remise/100)) STORED,
    motif_retour ENUM('defectueux', 'non_conforme', 'mecontentement', 'erreur_livraison', 'echange', 'autre') NOT NULL,
    etat_produit ENUM('neuf', 'endommage', 'usage', 'incomplet') DEFAULT 'neuf',
    notes TEXT,
    INDEX idx_retour (id_retour_client),
    INDEX idx_produit (id_produit),
    INDEX idx_ligne_commande (id_ligne_commande_vente),
    FOREIGN KEY (id_retour_client) REFERENCES retours_clients(id_retour_client) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_ligne_commande_vente) REFERENCES ligne_commande_vente(id_ligne_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- ENTREPÔTS ET EMPLACEMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS entrepots (
    id_entrepot INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(100) NOT NULL,
    adresse TEXT,
    ville VARCHAR(100),
    pays VARCHAR(100),
    code_postal VARCHAR(20),
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nom (nom),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS emplacements (
    id_emplacement INT PRIMARY KEY AUTO_INCREMENT,
    id_entrepot INT NOT NULL,
    code VARCHAR(50) NOT NULL,
    rayon VARCHAR(50),
    etagere VARCHAR(50),
    description TEXT,
    INDEX idx_entrepot (id_entrepot),
    INDEX idx_code (code),
    FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- MOUVEMENTS DE STOCK
-- ✅ CORRIGÉ : entrees_stock et sorties_stock stockent maintenant :
--    - quantite (en unité de vente : ex: 10 cartons)
--    - quantite_totale_base (en unité de base : ex: 120 bidons)
--    - id_unite_vente, nom_unite_vente, quantite_base
-- =============================================================================

CREATE TABLE IF NOT EXISTS entrees_stock (
    id_entree INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    id_produit INT NOT NULL,
    id_reception INT,

    -- ✅ NOUVEAU : traçabilité de l'unité
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite DECIMAL(15, 2) NOT NULL,
    quantite_totale_base DECIMAL(15, 2) NOT NULL,

    id_emplacement INT,
    num_lot VARCHAR(100),
    date_peremption DATE,
    notes TEXT,
    date_entree DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_reference (reference),
    INDEX idx_produit (id_produit),
    INDEX idx_reception (id_reception),
    INDEX idx_emplacement (id_emplacement),
    INDEX idx_utilisateur (id_utilisateur),
    INDEX idx_unite_vente (id_unite_vente),

    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_reception) REFERENCES receptions(id_reception) ON DELETE SET NULL,
    FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sorties_stock (
    id_sortie INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    date_sortie DATE NOT NULL,
    id_produit INT NOT NULL,

    -- ✅ NOUVEAU : traçabilité de l'unité
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite DECIMAL(15, 2) NOT NULL,
    quantite_totale_base DECIMAL(15, 2) NOT NULL,

    type_sortie ENUM('vente', 'retour_fournisseur', 'transfert', 'perte', 'casse', 'don') DEFAULT 'vente',
    id_commande_vente INT,
    id_emplacement INT,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_reference (reference),
    INDEX idx_produit (id_produit),
    INDEX idx_commande (id_commande_vente),
    INDEX idx_type (type_sortie),
    INDEX idx_date (date_sortie),
    INDEX idx_utilisateur (id_utilisateur),
    INDEX idx_unite_vente (id_unite_vente),

    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_commande_vente) REFERENCES commandes_vente(id_commande) ON DELETE SET NULL,
    FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transferts_stock (
    id_transfert INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    date_transfert DATE NOT NULL,
    id_produit INT NOT NULL,
    quantite DECIMAL(15, 2) NOT NULL,
    id_emplacement_source INT,
    id_emplacement_destination INT,
    motif VARCHAR(200),
    notes TEXT,
    statut ENUM('en_attente', 'en_cours', 'termine', 'annule') DEFAULT 'en_attente',
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME,
    valide_par VARCHAR(100),
    INDEX idx_reference (reference),
    INDEX idx_produit (id_produit),
    INDEX idx_source (id_emplacement_source),
    INDEX idx_destination (id_emplacement_destination),
    INDEX idx_statut (statut),
    INDEX idx_date (date_transfert),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_emplacement_source) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL,
    FOREIGN KEY (id_emplacement_destination) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ajustements_stock (
    id_ajustement INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    date_ajustement DATE NOT NULL,
    id_produit INT NOT NULL,
    quantite DECIMAL(15, 2) NOT NULL,
    ancienne_quantite DECIMAL(15, 2) DEFAULT 0,
    nouvelle_quantite DECIMAL(15, 2) DEFAULT 0,
    id_emplacement INT,
    motif VARCHAR(200) NOT NULL,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME,
    valide_par VARCHAR(100),
    INDEX idx_reference (reference),
    INDEX idx_produit (id_produit),
    INDEX idx_emplacement (id_emplacement),
    INDEX idx_date (date_ajustement),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- INVENTAIRES
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventaires (
    id_inventaire INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    libelle VARCHAR(200) NOT NULL,
    date_debut DATE NOT NULL,
    date_fin DATE,
    type_inventaire ENUM('complet', 'partiel', 'tournant') DEFAULT 'complet',
    id_emplacement INT,
    statut ENUM('planifie', 'en_cours', 'termine', 'annule') DEFAULT 'planifie',
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME,
    valide_par VARCHAR(100),
    INDEX idx_reference (reference),
    INDEX idx_statut (statut),
    INDEX idx_emplacement (id_emplacement),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventaire_lignes (
    id_ligne INT PRIMARY KEY AUTO_INCREMENT,
    id_inventaire INT NOT NULL,
    id_produit INT NOT NULL,
    id_emplacement INT,
    quantite_theorique DECIMAL(15, 2) DEFAULT 0,
    quantite_reelle DECIMAL(15, 2) DEFAULT 0,
    ecart DECIMAL(15, 2) DEFAULT 0,
    notes TEXT,
    date_scannage DATETIME,
    INDEX idx_inventaire (id_inventaire),
    INDEX idx_produit (id_produit),
    INDEX idx_emplacement (id_emplacement),
    FOREIGN KEY (id_inventaire) REFERENCES inventaires(id_inventaire) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- ALERTES DE STOCK
-- =============================================================================

CREATE TABLE IF NOT EXISTS alertes_stock (
    id_alerte INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    id_produit INT NOT NULL,
    type_alerte ENUM('stock_min', 'stock_max', 'peremption', 'rupture') NOT NULL,
    message VARCHAR(255) NOT NULL,
    seuil DECIMAL(15, 2),
    quantite_actuelle DECIMAL(15, 2),
    statut ENUM('non_traite', 'en_cours', 'traite') DEFAULT 'non_traite',
    date_alerte DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_traitement DATETIME,
    traite_par VARCHAR(100),
    INDEX idx_produit (id_produit),
    INDEX idx_statut (statut),
    INDEX idx_type (type_alerte),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- DÉPENSES ET COMPTABILITÉ
-- =============================================================================

CREATE TABLE IF NOT EXISTS categories_depenses (
    id_categorie_depense INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(100) NOT NULL,
    description TEXT,
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_nom_par_user (nom, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS depenses (
    id_depense INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    date_depense DATE NOT NULL,
    libelle VARCHAR(200) NOT NULL,
    montant DECIMAL(15, 2) NOT NULL,
    id_categorie_depense INT,
    mode_paiement ENUM('especes', 'carte', 'virement', 'cheque', 'autre') DEFAULT 'especes',
    reference VARCHAR(100),
    note TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (date_depense),
    INDEX idx_categorie (id_categorie_depense),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_categorie_depense) REFERENCES categories_depenses(id_categorie_depense) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- HISTORIQUE DES MOUVEMENTS DE STOCK
-- Note : quantite est TOUJOURS en unité de base (ex: bidon)
-- =============================================================================

CREATE TABLE IF NOT EXISTS mouvements_stock (
    id_mouvement INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    id_produit INT NOT NULL,
    type_mouvement ENUM('entree', 'sortie', 'ajustement', 'transfert') NOT NULL,
    quantite DECIMAL(15, 2) NOT NULL,
    ancienne_quantite DECIMAL(15, 2) DEFAULT 0,
    nouvelle_quantite DECIMAL(15, 2) DEFAULT 0,
    id_reference INT,
    type_reference VARCHAR(50),
    notes TEXT,
    date_mouvement DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_produit (id_produit),
    INDEX idx_type (type_mouvement),
    INDEX idx_date (date_mouvement),
    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- PRODUITS IMPORTÉS (YUXING)
-- =============================================================================

CREATE TABLE IF NOT EXISTS produits_yuxing (
    code VARCHAR(200) NOT NULL,
    designation TEXT,
    caracteristiques TEXT,
    categorie VARCHAR(100),
    unite VARCHAR(50),
    prix_le_plus_bas DECIMAL(15, 2) DEFAULT 0,
    INDEX idx_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- VUES POUR LES RAPPORTS
-- =============================================================================

CREATE OR REPLACE VIEW v_produits_plus_vendus AS
SELECT
    p.id_produit,
    p.id_utilisateur,
    p.nom AS produit_nom,
    md.nom AS modele_nom,
    c.nom AS categorie_nom,
    m.nom AS marque_nom,
    SUM(lcv.quantite_totale_base) AS total_vendu_base,
    SUM(lcv.montant_total) AS chiffre_affaires,
    COUNT(DISTINCT cv.id_commande) AS nombre_commandes
FROM produits p
LEFT JOIN ligne_commande_vente lcv ON p.id_produit = lcv.id_produit
LEFT JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
LEFT JOIN categories c ON p.id_categorie = c.id_categorie
LEFT JOIN marques m ON p.id_marque = m.id_marque
LEFT JOIN modeles md ON p.id_modele = md.id_modele
WHERE cv.statut IN ('livree', 'expediee')
GROUP BY p.id_produit, p.id_utilisateur
ORDER BY total_vendu_base DESC;

CREATE OR REPLACE VIEW v_rapport_ventes AS
SELECT
    cv.id_commande,
    cv.id_utilisateur,
    cv.numero_commande,
    cv.date_commande,
    cv.nomclient AS client_nom,
    cv.telephone AS client_telephone,
    cv.montant_total,
    cv.statut,
    fv.numero_facture,
    fv.statut AS statut_facture,
    fv.date_facture,
    fv.date_echeance,
    fv.mode_paiement,
    u.fullname AS vendeur_nom
FROM commandes_vente cv
LEFT JOIN factures_vente fv ON cv.id_commande = fv.id_commande
LEFT JOIN utilisateurs u ON cv.id_utilisateur = u.id_utilisateur;

CREATE OR REPLACE VIEW v_rapport_achats AS
SELECT
    ca.id_commande_achat,
    ca.id_utilisateur,
    ca.numero_commande,
    ca.date_commande,
    f.nom AS fournisseur_nom,
    f.ville AS fournisseur_ville,
    ca.montant_total,
    ca.statut,
    r.numero_reception,
    r.date_reception,
    r.statut AS statut_reception,
    u.fullname AS acheteur_nom
FROM commandes_achat ca
LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
LEFT JOIN receptions r ON ca.id_commande_achat = r.id_commande_achat
LEFT JOIN utilisateurs u ON ca.id_utilisateur = u.id_utilisateur;

CREATE OR REPLACE VIEW v_rapport_stocks AS
SELECT
    p.id_produit,
    p.id_utilisateur,
    md.nom AS modele_nom,
    p.nom AS produit_nom,
    p.quantite_stock,
    p.quantite_minimale,
    p.quantite_maximale,
    p.prix_achat,
    p.prix_vente,
    c.nom AS categorie_nom,
    m.nom AS marque_nom,
    u.symbole AS unite_symbole,
    p.emplacement,
    p.statut,
    CASE
        WHEN p.quantite_stock <= p.quantite_minimale THEN 'Alerte stock bas'
        WHEN p.quantite_stock >= p.quantite_maximale THEN 'Alerte stock haut'
        ELSE 'Normal'
    END AS etat_stock
FROM produits p
LEFT JOIN categories c ON p.id_categorie = c.id_categorie
LEFT JOIN marques m ON p.id_marque = m.id_marque
LEFT JOIN modeles md ON p.id_modele = md.id_modele
LEFT JOIN unites u ON p.id_unite = u.id_unite;

-- Vue des bénéfices (utilise quantite_totale_base pour le coût d'achat)
CREATE OR REPLACE VIEW v_benefices AS
WITH ventes AS (
    SELECT
        cv.id_utilisateur,
        DATE(cv.date_commande) AS date_vente,
        YEAR(cv.date_commande) AS annee,
        MONTH(cv.date_commande) AS mois,
        SUM(lcv.montant_total) AS total_ventes,
        SUM(lcv.quantite_totale_base * p.prix_achat) AS cout_achat,
        SUM(lcv.montant_total - (lcv.quantite_totale_base * p.prix_achat)) AS benefice
    FROM ligne_commande_vente lcv
    JOIN produits p ON lcv.id_produit = p.id_produit
    JOIN commandes_vente cv ON lcv.id_commande = cv.id_commande
    WHERE cv.statut IN ('livree', 'expediee')
    GROUP BY cv.id_utilisateur, DATE(cv.date_commande), YEAR(cv.date_commande), MONTH(cv.date_commande)
)
SELECT
    id_utilisateur,
    date_vente,
    annee,
    mois,
    total_ventes,
    cout_achat,
    benefice,
    ROUND((benefice / total_ventes) * 100, 2) AS marge_beneficiaire
FROM ventes
ORDER BY date_vente DESC;

-- =============================================================================
-- FIN DU SCRIPT
-- =============================================================================
`;

export default { creation_tables };