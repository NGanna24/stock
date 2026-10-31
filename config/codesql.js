// config/schema.sql.js
//
// ORDRE DE CRÉATION (important : une clé étrangère exige que la table cible existe) :
//   1. Utilisateurs, magasins, entrepôts, emplacements, membres
//   2. Référentiels (catégories, marques, modèles, unités, fournisseurs)
//   3. Catalogues : produits (magasin) puis produits_entrepot (entrepôt)
//   4. Unités de vente : magasin puis entrepôt
//   5. Achats, réceptions, ventes, retours, opérations de stock MAGASIN
//   6. Mouvements, transferts (pont entrepôt -> magasin)
//   7. Opérations de stock ENTREPÔT (après transferts_stock)
//   8. Vues
const creation_tables = `-- =============================================================================
-- BASE DE DONNÉES STOCK - SCRIPT DE CRÉATION COMPLET MULTI-TENANT
-- Chaque compte (id_utilisateur) a son propre catalogue et son propre stock.
-- MAGASIN et ENTREPÔT sont deux mondes séparés :
--   magasin  : produits, unites_vente, entrees_stock, sorties_stock, ...
--   entrepôt : produits_entrepot, unites_vente_entrepot, *_entrepot, emplacements
-- Le SEUL pont entre les deux est la table transferts_stock.
-- L'entrepôt est OPTIONNEL : un client sans entrepôt n'a aucune ligne dans les
-- tables d'entrepôt, et aucune table du magasin n'en dépend.
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
-- TABLE SUPER_ADMIN — accès propriétaire du logiciel
-- Séparée des utilisateurs tenants pour isolation totale
-- =============================================================================

CREATE TABLE IF NOT EXISTS super_admins (
    id_super_admin   INT PRIMARY KEY AUTO_INCREMENT,
    fullname         VARCHAR(100) NOT NULL,

    -- Identifiants de connexion
    telephone        VARCHAR(20)  NOT NULL UNIQUE,
    email            VARCHAR(255) NOT NULL UNIQUE,
    password         VARCHAR(255) NOT NULL,   -- hash bcrypt

    -- Sécurité renforcée
    actif                 BOOLEAN DEFAULT TRUE,
    tentatives_echouees   INT DEFAULT 0,
    bloque_jusqua         DATETIME NULL,       -- blocage après N tentatives
    derniere_connexion    TIMESTAMP NULL DEFAULT NULL,
    derniere_ip           VARCHAR(45) NULL,

    -- Traçabilité
    date_creation    DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_email (email),
    INDEX idx_telephone (telephone),
    INDEX idx_actif (actif)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- RÉINITIALISATION DE MOT DE PASSE (OTP par EMAIL)
-- Concerne UNIQUEMENT les utilisateurs (patrons)
-- =============================================================================

CREATE TABLE IF NOT EXISTS password_reset_otp (
    id_otp INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    code_otp VARCHAR(10) NOT NULL,
    id_utilisateur INT NOT NULL,
    tentatives INT DEFAULT 0,
    utilise BOOLEAN DEFAULT FALSE,
    expire_at DATETIME NOT NULL,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_demande VARCHAR(45),

    INDEX idx_email (email),
    INDEX idx_code (code_otp),
    INDEX idx_expire (expire_at),
    INDEX idx_email_code (email, code_otp),

    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- MAGASINS ET EMPLOYÉS
-- =============================================================================

CREATE TABLE IF NOT EXISTS magasins (
    id_magasin INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,

    -- ========== IDENTITÉ COMMERCIALE ==========
    nom_commercial VARCHAR(200),
    slogan VARCHAR(200),
    logo_url VARCHAR(500),
    description TEXT,

    -- ========== COORDONNÉES (ADAPTÉES AFRIQUE) ==========
    quartier VARCHAR(100),
    ville VARCHAR(100),
    pays VARCHAR(100),
    telephone VARCHAR(20),
    telephone2 VARCHAR(20),
    whatsapp VARCHAR(20),
    email VARCHAR(150),

    -- ========== GÉOLOCALISATION DU MAGASIN ==========
    latitude DECIMAL(10, 8) NULL,
    longitude DECIMAL(11, 8) NULL,
    adresse_complete VARCHAR(500) NULL,
    position_source ENUM('gps', 'ip', 'manuel') DEFAULT 'manuel',
    precision_gps DECIMAL(10, 2) NULL,   -- précision en mètres (utile pour filtrer)

    -- ========== INFORMATIONS LÉGALES ==========
    numero_rccm VARCHAR(50),
    numero_nif VARCHAR(50),
    numero_contribuable VARCHAR(50),
    regime_fiscal VARCHAR(50),

    -- ========== MÉTADONNÉES ==========
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_utilisateur (id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employes (
    id_employe INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,          -- LE PATRON (workspace)
    id_magasin INT NOT NULL,              -- magasin où il travaille
    id_role INT NOT NULL,                 -- caissier, magasinier...
    fullname VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    telephone VARCHAR(20) NOT NULL,
    password VARCHAR(255) NOT NULL,
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    derniere_connexion TIMESTAMP NULL DEFAULT NULL,

    INDEX idx_utilisateur (id_utilisateur),
    INDEX idx_magasin (id_magasin),
    INDEX idx_role (id_role),
    INDEX idx_telephone (telephone),

    UNIQUE KEY unique_telephone_par_patron (telephone, id_utilisateur),
    UNIQUE KEY unique_slug_par_patron (slug, id_utilisateur),

    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_magasin) REFERENCES magasins(id_magasin) ON DELETE CASCADE,
    FOREIGN KEY (id_role) REFERENCES roles(id_role) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- ENTREPÔTS (optionnels), EMPLACEMENTS et MEMBRES
-- Les emplacements appartiennent à l'ENTREPÔT uniquement.
-- =============================================================================

CREATE TABLE IF NOT EXISTS entrepots (
    id_entrepot INT PRIMARY KEY AUTO_INCREMENT,
    nom VARCHAR(100) NOT NULL,
    adresse TEXT,
    ville VARCHAR(100),
    pays VARCHAR(100),
    code_postal VARCHAR(20),
    code_acces VARCHAR(20) NOT NULL UNIQUE,
    id_utilisateur_proprietaire INT NOT NULL,
    actif BOOLEAN DEFAULT TRUE,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code_acces (code_acces),
    INDEX idx_proprietaire (id_utilisateur_proprietaire),
    INDEX idx_actif (actif),
    FOREIGN KEY (id_utilisateur_proprietaire)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS emplacements (
    id_emplacement INT PRIMARY KEY AUTO_INCREMENT,
    id_entrepot INT NOT NULL,
    code VARCHAR(50) NOT NULL,
    rayon VARCHAR(50),
    etagere VARCHAR(50),
    description TEXT,
    INDEX idx_emp_entrepot (id_entrepot),
    INDEX idx_emp_code (code),
    UNIQUE KEY uq_emp_code (id_entrepot, code),
    CONSTRAINT fk_emp_entrepot FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS membres_entrepot (
    id_membre INT PRIMARY KEY AUTO_INCREMENT,
    id_entrepot INT NOT NULL,
    id_utilisateur INT NOT NULL,
    role_membre ENUM('proprietaire', 'membre') DEFAULT 'membre',
    actif BOOLEAN DEFAULT TRUE,
    date_ajout DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_entrepot (id_entrepot),
    INDEX idx_user (id_utilisateur),
    INDEX idx_role (role_membre),
    UNIQUE KEY unique_entrepot_user (id_entrepot, id_utilisateur),
    FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE,
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
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
-- RÉFÉRENTIELS - CATÉGORIES, MARQUES, MODÈLES, UNITÉS, FOURNISSEURS
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

-- =============================================================================
-- PRODUITS MAGASIN
-- =============================================================================

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
-- PRODUITS ENTREPÔT (catalogue indépendant du catalogue magasin)
-- Le doublon "nom + marque + modèle" est contrôlé par le code (produits actifs).
-- Pas de contrainte UNIQUE en base : MySQL interdit une colonne générée dont les
-- colonnes de base ont une clé étrangère en CASCADE / SET NULL.
-- =============================================================================

CREATE TABLE IF NOT EXISTS produits_entrepot (
    id_produit_entrepot INT PRIMARY KEY AUTO_INCREMENT,

    id_entrepot    INT NOT NULL,
    id_utilisateur INT NOT NULL,              -- créateur

    nom         VARCHAR(200) NOT NULL,
    description TEXT,

    id_categorie   INT NULL,
    id_marque      INT NULL,
    id_modele      INT NULL,
    id_unite       INT NULL,                  -- unité de base
    id_fournisseur INT NULL,

    -- Prix en UNITÉ DE BASE
    prix_achat DECIMAL(15,2) NOT NULL DEFAULT 0,
    prix_vente DECIMAL(15,2) NOT NULL DEFAULT 0,

    -- Stock en UNITÉ DE BASE
    quantite_stock    DECIMAL(15,2) NOT NULL DEFAULT 0,
    quantite_minimale DECIMAL(15,2) NOT NULL DEFAULT 0,
    quantite_maximale DECIMAL(15,2) NOT NULL DEFAULT 0,

    emplacement VARCHAR(100) NULL,
    rayon       VARCHAR(50)  NULL,
    etagere     VARCHAR(50)  NULL,

    actif BOOLEAN NOT NULL DEFAULT TRUE,

    date_creation     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_pe_entrepot    (id_entrepot),
    INDEX idx_pe_utilisateur (id_utilisateur),
    INDEX idx_pe_nom         (nom),
    INDEX idx_pe_categorie   (id_categorie),
    INDEX idx_pe_marque      (id_marque),
    INDEX idx_pe_modele      (id_modele),
    INDEX idx_pe_fournisseur (id_fournisseur),
    INDEX idx_pe_actif       (actif),
    INDEX idx_pe_scope       (id_entrepot, nom),

    CONSTRAINT fk_pe_entrepot    FOREIGN KEY (id_entrepot)    REFERENCES entrepots(id_entrepot)       ON DELETE CASCADE,
    CONSTRAINT fk_pe_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    CONSTRAINT fk_pe_categorie   FOREIGN KEY (id_categorie)   REFERENCES categories(id_categorie)     ON DELETE SET NULL,
    CONSTRAINT fk_pe_marque      FOREIGN KEY (id_marque)      REFERENCES marques(id_marque)           ON DELETE SET NULL,
    CONSTRAINT fk_pe_modele      FOREIGN KEY (id_modele)      REFERENCES modeles(id_modele)           ON DELETE SET NULL,
    CONSTRAINT fk_pe_unite       FOREIGN KEY (id_unite)       REFERENCES unites(id_unite)             ON DELETE SET NULL,
    CONSTRAINT fk_pe_fournisseur FOREIGN KEY (id_fournisseur) REFERENCES fournisseurs(id_fournisseur) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- UNITÉS DE VENTE MAGASIN (conditionnements : carton, palette, sachet...)
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
-- UNITÉS DE VENTE ENTREPÔT
-- Le nom d'une unité est unique parmi les unités ACTIVES seulement : on peut
-- supprimer (actif = 0) puis recréer "Carton" sans erreur.
-- =============================================================================

CREATE TABLE IF NOT EXISTS unites_vente_entrepot (
    id_unite_vente_entrepot INT PRIMARY KEY AUTO_INCREMENT,
    id_produit_entrepot     INT NOT NULL,

    nom           VARCHAR(50)   NOT NULL,
    quantite_base DECIMAL(15,2) NOT NULL DEFAULT 1,   -- nb d'unités de base
    prix_vente    DECIMAL(15,2) NOT NULL DEFAULT 0,
    prix_achat    DECIMAL(15,2) NOT NULL DEFAULT 0,
    est_principal BOOLEAN NOT NULL DEFAULT FALSE,
    actif         BOOLEAN NOT NULL DEFAULT TRUE,

    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    nom_actif VARCHAR(50) GENERATED ALWAYS AS (IF(actif = 1, LOWER(TRIM(nom)), NULL)) STORED,

    INDEX idx_uve_produit   (id_produit_entrepot),
    INDEX idx_uve_principal (est_principal),
    UNIQUE KEY uq_uve_nom_actif (id_produit_entrepot, nom_actif),

    CONSTRAINT fk_uve_produit FOREIGN KEY (id_produit_entrepot)
        REFERENCES produits_entrepot(id_produit_entrepot) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- COMMANDES D'ACHAT (magasin)
-- =============================================================================

CREATE TABLE IF NOT EXISTS commandes_achat (
    id_commande_achat INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_commande VARCHAR(50) NOT NULL,
    date_commande DATE NOT NULL,
    id_fournisseur INT NOT NULL,
    -- Livraison : 'magasin' (défaut) ou 'entrepot' (réservé au propriétaire de l'entrepôt)
    destination ENUM('magasin', 'entrepot') NOT NULL DEFAULT 'magasin',
    id_entrepot INT NULL,
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
    INDEX idx_ca_destination (id_utilisateur, destination, id_entrepot),
    UNIQUE KEY unique_numero_par_user (numero_commande, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_fournisseur) REFERENCES fournisseurs(id_fournisseur) ON DELETE RESTRICT,
    CONSTRAINT fk_ca_entrepot FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ligne_commande_achat (
    id_ligne_achat INT PRIMARY KEY AUTO_INCREMENT,
    id_commande_achat INT NOT NULL,
    -- Magasin : id_produit / id_unite_vente.  Entrepôt : id_produit_entrepot / id_unite_vente_entrepot.
    -- Un seul des deux produits est renseigné (contrôlé par le code, pas de CHECK : voir migration).
    id_produit INT NULL,
    id_produit_entrepot INT NULL,
    id_unite_vente INT,
    id_unite_vente_entrepot INT NULL,
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
    INDEX idx_lca_produit_entrepot (id_produit_entrepot),
    FOREIGN KEY (id_commande_achat) REFERENCES commandes_achat(id_commande_achat) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL,
    CONSTRAINT fk_lca_produit_entrepot FOREIGN KEY (id_produit_entrepot) REFERENCES produits_entrepot(id_produit_entrepot) ON DELETE CASCADE,
    CONSTRAINT fk_lca_unite_entrepot FOREIGN KEY (id_unite_vente_entrepot) REFERENCES unites_vente_entrepot(id_unite_vente_entrepot) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- RÉCEPTIONS (magasin)
-- =============================================================================

CREATE TABLE IF NOT EXISTS receptions (
    id_reception INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_reception VARCHAR(50) NOT NULL,
    date_reception DATE NOT NULL,
    id_commande_achat INT,
    destination ENUM('magasin', 'entrepot') NOT NULL DEFAULT 'magasin',
    id_entrepot INT NULL,
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
    INDEX idx_rec_destination (id_utilisateur, destination, id_entrepot),
    UNIQUE KEY unique_numero_par_user (numero_reception, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_commande_achat) REFERENCES commandes_achat(id_commande_achat) ON DELETE SET NULL,
    CONSTRAINT fk_rec_entrepot FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reception_lignes (
    id_ligne_reception INT PRIMARY KEY AUTO_INCREMENT,
    id_reception INT NOT NULL,
    id_produit INT NULL,
    id_produit_entrepot INT NULL,
    id_ligne_achat INT,

    -- ✅ Traçabilité de l'unité de vente
    id_unite_vente INT,
    id_unite_vente_entrepot INT NULL,
    id_emplacement INT NULL,
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
    INDEX idx_rl_produit_entrepot (id_produit_entrepot),

    FOREIGN KEY (id_reception) REFERENCES receptions(id_reception) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_ligne_achat) REFERENCES ligne_commande_achat(id_ligne_achat) ON DELETE SET NULL,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL,
    CONSTRAINT fk_rl_produit_entrepot FOREIGN KEY (id_produit_entrepot) REFERENCES produits_entrepot(id_produit_entrepot) ON DELETE CASCADE,
    CONSTRAINT fk_rl_unite_entrepot FOREIGN KEY (id_unite_vente_entrepot) REFERENCES unites_vente_entrepot(id_unite_vente_entrepot) ON DELETE SET NULL,
    CONSTRAINT fk_rl_emplacement FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- RETOURS FOURNISSEURS (magasin)
-- =============================================================================

CREATE TABLE IF NOT EXISTS retours_fournisseurs (
    id_retour INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    numero_retour VARCHAR(50) NOT NULL,
    date_retour DATE NOT NULL,
    id_fournisseur INT NOT NULL,
    destination ENUM('magasin', 'entrepot') NOT NULL DEFAULT 'magasin',
    id_entrepot INT NULL,
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
    INDEX idx_rf_destination (id_utilisateur, destination, id_entrepot),
    INDEX idx_statut (statut),
    INDEX idx_date (date_retour),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_numero_par_user (numero_retour, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_fournisseur) REFERENCES fournisseurs(id_fournisseur) ON DELETE RESTRICT,
    FOREIGN KEY (id_commande_achat) REFERENCES commandes_achat(id_commande_achat) ON DELETE SET NULL,
    FOREIGN KEY (id_reception) REFERENCES receptions(id_reception) ON DELETE SET NULL,
    CONSTRAINT fk_rf_entrepot FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retour_lignes (
    id_ligne_retour INT PRIMARY KEY AUTO_INCREMENT,
    id_retour INT NOT NULL,
    id_produit INT NULL,
    id_produit_entrepot INT NULL,
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
    INDEX idx_rtl_produit_entrepot (id_produit_entrepot),
    FOREIGN KEY (id_retour) REFERENCES retours_fournisseurs(id_retour) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    CONSTRAINT fk_rtl_produit_entrepot FOREIGN KEY (id_produit_entrepot) REFERENCES produits_entrepot(id_produit_entrepot) ON DELETE CASCADE,
    FOREIGN KEY (id_ligne_achat) REFERENCES ligne_commande_achat(id_ligne_achat) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- COMMANDES DE VENTE ET FACTURES (magasin)
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
    quantite_retournee_base DECIMAL(15, 2) DEFAULT 0,
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
-- RETOURS CLIENTS (magasin)
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
    type_resolution ENUM('remboursement_especes', 'avoir', 'echange', 'refus') DEFAULT 'remboursement_especes',
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

    -- ✅ Traçabilité de l'unité (Carton, Bidon, Palette...)
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite_totale_base DECIMAL(15, 2) DEFAULT 0,

    -- Quantités
    quantite DECIMAL(15, 2) NOT NULL,

    -- Prix (catalogue vs réel remboursé)
    prix_vente DECIMAL(15, 2) NOT NULL,             -- Prix catalogue actuel
    prix_remboursement DECIMAL(15, 2) DEFAULT 0,    -- Prix réel calculé (prorata)
    remise DECIMAL(15, 2) DEFAULT 0.00,

    montant_total DECIMAL(15, 2) GENERATED ALWAYS AS (quantite * prix_remboursement * (1 - remise/100)) STORED,

    motif_retour ENUM('defectueux', 'non_conforme', 'mecontentement', 'erreur_livraison', 'echange', 'autre') NOT NULL,
    etat_produit ENUM('neuf', 'endommage', 'usage', 'incomplet') DEFAULT 'neuf',
    notes TEXT,

    INDEX idx_retour (id_retour_client),
    INDEX idx_produit (id_produit),
    INDEX idx_ligne_commande (id_ligne_commande_vente),
    INDEX idx_unite_vente (id_unite_vente),

    FOREIGN KEY (id_retour_client) REFERENCES retours_clients(id_retour_client) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_ligne_commande_vente) REFERENCES ligne_commande_vente(id_ligne_vente) ON DELETE SET NULL,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- OPÉRATIONS DE STOCK MAGASIN
-- (entrées, sorties, ajustements, inventaires, alertes)
-- Indépendantes de l'entrepôt : aucune référence à emplacements / entrepots.
-- =============================================================================

CREATE TABLE IF NOT EXISTS entrees_stock (
    id_entree INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    id_produit INT NOT NULL,
    id_reception INT,

    -- ✅ Traçabilité de l'unité
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite DECIMAL(15, 2) NOT NULL,
    quantite_totale_base DECIMAL(15, 2) NOT NULL,

    num_lot VARCHAR(100),
    date_peremption DATE,
    notes TEXT,
    date_entree DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_reference (reference),
    INDEX idx_produit (id_produit),
    INDEX idx_reception (id_reception),
    INDEX idx_utilisateur (id_utilisateur),
    INDEX idx_unite_vente (id_unite_vente),

    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE,
    FOREIGN KEY (id_reception) REFERENCES receptions(id_reception) ON DELETE SET NULL,
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sorties_stock (
    id_sortie INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    date_sortie DATE NOT NULL,
    id_produit INT NOT NULL,

    -- ✅ Traçabilité de l'unité
    id_unite_vente INT,
    nom_unite_vente VARCHAR(50) DEFAULT 'Unité',
    quantite_base DECIMAL(15, 2) DEFAULT 1,
    quantite DECIMAL(15, 2) NOT NULL,
    quantite_totale_base DECIMAL(15, 2) NOT NULL,

    type_sortie ENUM('vente', 'retour_fournisseur', 'transfert', 'perte', 'casse', 'don') DEFAULT 'vente',
    id_commande_vente INT,
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
    FOREIGN KEY (id_unite_vente) REFERENCES unites_vente(id_unite_vente) ON DELETE SET NULL
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
    motif VARCHAR(200) NOT NULL,
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME,
    valide_par VARCHAR(100),
    INDEX idx_reference (reference),
    INDEX idx_produit (id_produit),
    INDEX idx_date (date_ajustement),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- INVENTAIRES MAGASIN
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventaires (
    id_inventaire INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    reference VARCHAR(50) NOT NULL,
    libelle VARCHAR(200) NOT NULL,
    date_debut DATE NOT NULL,
    date_fin DATE,
    type_inventaire ENUM('complet', 'partiel', 'tournant') DEFAULT 'complet',
    statut ENUM('planifie', 'en_cours', 'termine', 'annule') DEFAULT 'planifie',
    notes TEXT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME,
    valide_par VARCHAR(100),
    INDEX idx_reference (reference),
    INDEX idx_statut (statut),
    INDEX idx_utilisateur (id_utilisateur),
    UNIQUE KEY unique_ref_par_user (reference, id_utilisateur),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventaire_lignes (
    id_ligne INT PRIMARY KEY AUTO_INCREMENT,
    id_inventaire INT NOT NULL,
    id_produit INT NOT NULL,
    quantite_theorique DECIMAL(15, 2) DEFAULT 0,
    quantite_reelle DECIMAL(15, 2) DEFAULT 0,
    ecart DECIMAL(15, 2) DEFAULT 0,
    notes TEXT,
    date_scannage DATETIME,
    INDEX idx_inventaire (id_inventaire),
    INDEX idx_produit (id_produit),
    FOREIGN KEY (id_inventaire) REFERENCES inventaires(id_inventaire) ON DELETE CASCADE,
    FOREIGN KEY (id_produit) REFERENCES produits(id_produit) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- ALERTES DE STOCK (magasin)
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
-- HISTORIQUE DES MOUVEMENTS DE STOCK MAGASIN
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
-- HISTORIQUE DES MOUVEMENTS DE STOCK ENTREPÔT
-- Journal unique de chaque variation de stock de produits_entrepot.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mouvements_entrepot (
    id_mouvement_entrepot INT PRIMARY KEY AUTO_INCREMENT,

    id_entrepot         INT NOT NULL,
    id_produit_entrepot INT NOT NULL,
    id_utilisateur      INT NOT NULL,

    type_mouvement ENUM(
        'entree', 'sortie', 'ajustement',
        'transfert_sortie', 'perte', 'inventaire'
    ) NOT NULL,

    -- Toujours en UNITÉ DE BASE
    quantite          DECIMAL(15,2) NOT NULL,
    ancienne_quantite DECIMAL(15,2) NOT NULL DEFAULT 0,
    nouvelle_quantite DECIMAL(15,2) NOT NULL DEFAULT 0,

    -- Traçabilité de la saisie (ex : 3 cartons de 12)
    id_unite_vente_entrepot INT NULL,
    nom_unite_vente         VARCHAR(50)   NULL DEFAULT 'Unité',
    quantite_base           DECIMAL(15,2) NULL DEFAULT 1,
    quantite_saisie         DECIMAL(15,2) NULL,

    num_lot         VARCHAR(100) NULL,
    date_peremption DATE NULL,

    type_reference VARCHAR(50) NULL,          -- 'transfert', 'manuel', 'inventaire'...
    id_reference   INT NULL,                  -- ex : id_transfert

    notes          TEXT NULL,
    date_mouvement DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_me_entrepot (id_entrepot),
    INDEX idx_me_produit  (id_produit_entrepot),
    INDEX idx_me_user     (id_utilisateur),
    INDEX idx_me_type     (type_mouvement),
    INDEX idx_me_date     (date_mouvement),
    INDEX idx_me_ref      (type_reference, id_reference),
    INDEX idx_me_histo    (id_entrepot, id_produit_entrepot, date_mouvement),

    CONSTRAINT fk_me_entrepot FOREIGN KEY (id_entrepot)             REFERENCES entrepots(id_entrepot)                         ON DELETE CASCADE,
    CONSTRAINT fk_me_produit  FOREIGN KEY (id_produit_entrepot)     REFERENCES produits_entrepot(id_produit_entrepot)         ON DELETE CASCADE,
    CONSTRAINT fk_me_user     FOREIGN KEY (id_utilisateur)          REFERENCES utilisateurs(id_utilisateur)                   ON DELETE CASCADE,
    CONSTRAINT fk_me_unite    FOREIGN KEY (id_unite_vente_entrepot) REFERENCES unites_vente_entrepot(id_unite_vente_entrepot) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TRANSFERTS ENTREPÔT -> MAGASIN (le seul pont entre les deux mondes)
--   Source      : un produit d'ENTREPÔT
--   Destination : un compte (id_utilisateur_destination) et son magasin.
--                 id_produit_destination (produits.id_produit) est renseigné à
--                 la validation.
-- Le stock de l'entrepôt ne baisse qu'à la validation du transfert.
-- =============================================================================

CREATE TABLE IF NOT EXISTS transferts_stock (
    id_transfert     INT PRIMARY KEY AUTO_INCREMENT,
    numero_transfert VARCHAR(50) NOT NULL UNIQUE,
    numero_lot       VARCHAR(50) NULL,              -- même valeur pour toutes les lignes d'un panier (un seul bon)

    -- Source
    id_entrepot_source  INT NOT NULL,
    id_produit_entrepot INT NOT NULL,

    -- Destination
    id_magasin_destination     INT NOT NULL,   -- magasin du DEMANDEUR
    id_utilisateur_destination INT NOT NULL,   -- compte DEMANDEUR (reçoit dans son propre catalogue)
    id_produit_destination     INT NULL,      -- produits.id_produit du demandeur (choisi à la demande si 'existant', rempli à l'approbation si 'creer')
    mode_destination           ENUM('existant', 'creer') NOT NULL DEFAULT 'existant',
    unite_forcee               TINYINT(1) NOT NULL DEFAULT 0,   -- le demandeur a accepté une unité de base différente

    -- Quantité (toujours en UNITÉ DE BASE) + traçabilité de la saisie
    quantite                DECIMAL(15,2) NOT NULL,
    id_unite_vente_entrepot INT NULL,
    nom_unite_vente         VARCHAR(50)   NOT NULL DEFAULT 'Unité',
    quantite_base           DECIMAL(15,2) NOT NULL DEFAULT 1,
    quantite_saisie         DECIMAL(15,2) NULL,

    date_transfert  DATE NOT NULL,
    date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME NULL,

    statut ENUM('en_attente', 'valide', 'refuse', 'annule') NOT NULL DEFAULT 'en_attente',
    id_utilisateur_validateur INT NULL,
    motif_refus VARCHAR(255) NULL,
    motif       VARCHAR(200) NULL,
    notes       TEXT NULL,

    INDEX idx_ts_entrepot     (id_entrepot_source),
    INDEX idx_ts_lot          (id_entrepot_source, numero_lot),
    INDEX idx_ts_produit_ent  (id_produit_entrepot),
    INDEX idx_ts_magasin      (id_magasin_destination),
    INDEX idx_ts_produit_dest (id_produit_destination),
    INDEX idx_ts_statut       (statut),
    INDEX idx_ts_destinataire (id_utilisateur_destination),
    INDEX idx_ts_date         (date_transfert),

    CONSTRAINT fk_ts_entrepot     FOREIGN KEY (id_entrepot_source)         REFERENCES entrepots(id_entrepot)                         ON DELETE RESTRICT,
    CONSTRAINT fk_ts_produit_ent  FOREIGN KEY (id_produit_entrepot)        REFERENCES produits_entrepot(id_produit_entrepot)         ON DELETE RESTRICT,
    CONSTRAINT fk_ts_magasin      FOREIGN KEY (id_magasin_destination)     REFERENCES magasins(id_magasin)                           ON DELETE RESTRICT,
    CONSTRAINT fk_ts_produit_dest FOREIGN KEY (id_produit_destination)     REFERENCES produits(id_produit)                           ON DELETE SET NULL,
    CONSTRAINT fk_ts_unite        FOREIGN KEY (id_unite_vente_entrepot)    REFERENCES unites_vente_entrepot(id_unite_vente_entrepot) ON DELETE SET NULL,
    CONSTRAINT fk_ts_user_dest    FOREIGN KEY (id_utilisateur_destination) REFERENCES utilisateurs(id_utilisateur)                   ON DELETE CASCADE,
    CONSTRAINT fk_ts_user_valid   FOREIGN KEY (id_utilisateur_validateur)  REFERENCES utilisateurs(id_utilisateur)                   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- OPÉRATIONS DE STOCK ENTREPÔT
-- (entrées, sorties, ajustements, inventaires) — indépendantes du magasin.
-- Elles viennent APRÈS transferts_stock (sorties_stock_entrepot le référence).
-- =============================================================================

CREATE TABLE IF NOT EXISTS entrees_stock_entrepot (
    id_entree_entrepot INT PRIMARY KEY AUTO_INCREMENT,

    id_entrepot         INT NOT NULL,
    id_utilisateur      INT NOT NULL,              -- auteur
    reference           VARCHAR(50) NOT NULL,
    id_produit_entrepot INT NOT NULL,

    -- Traçabilité du conditionnement saisi (ex : 3 cartons de 12)
    id_unite_vente_entrepot INT NULL,
    nom_unite_vente         VARCHAR(50)   NOT NULL DEFAULT 'Unité',
    quantite_base           DECIMAL(15,2) NOT NULL DEFAULT 1,
    quantite                DECIMAL(15,2) NOT NULL,   -- saisie (en unité de vente)
    quantite_totale_base    DECIMAL(15,2) NOT NULL,   -- en UNITÉ DE BASE

    id_emplacement  INT NULL,
    num_lot         VARCHAR(100) NULL,
    date_peremption DATE NULL,
    notes           TEXT NULL,
    date_entree     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ee_entrepot    (id_entrepot),
    INDEX idx_ee_produit     (id_produit_entrepot),
    INDEX idx_ee_emplacement (id_emplacement),
    INDEX idx_ee_user        (id_utilisateur),
    INDEX idx_ee_date        (date_entree),
    UNIQUE KEY uq_ee_ref (id_entrepot, reference),

    CONSTRAINT fk_ee_entrepot    FOREIGN KEY (id_entrepot)             REFERENCES entrepots(id_entrepot)                         ON DELETE CASCADE,
    CONSTRAINT fk_ee_user        FOREIGN KEY (id_utilisateur)          REFERENCES utilisateurs(id_utilisateur)                   ON DELETE CASCADE,
    CONSTRAINT fk_ee_produit     FOREIGN KEY (id_produit_entrepot)     REFERENCES produits_entrepot(id_produit_entrepot)         ON DELETE CASCADE,
    CONSTRAINT fk_ee_unite       FOREIGN KEY (id_unite_vente_entrepot) REFERENCES unites_vente_entrepot(id_unite_vente_entrepot) ON DELETE SET NULL,
    CONSTRAINT fk_ee_emplacement FOREIGN KEY (id_emplacement)          REFERENCES emplacements(id_emplacement)                   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sorties_stock_entrepot (
    id_sortie_entrepot INT PRIMARY KEY AUTO_INCREMENT,

    id_entrepot         INT NOT NULL,
    id_utilisateur      INT NOT NULL,
    reference           VARCHAR(50) NOT NULL,
    date_sortie         DATE NOT NULL,
    id_produit_entrepot INT NOT NULL,

    id_unite_vente_entrepot INT NULL,
    nom_unite_vente         VARCHAR(50)   NOT NULL DEFAULT 'Unité',
    quantite_base           DECIMAL(15,2) NOT NULL DEFAULT 1,
    quantite                DECIMAL(15,2) NOT NULL,
    quantite_totale_base    DECIMAL(15,2) NOT NULL,

    type_sortie ENUM('transfert', 'perte', 'casse', 'don', 'retour_fournisseur', 'autre') NOT NULL DEFAULT 'transfert',
    id_transfert   INT NULL,                       -- si la sortie vient d'un transfert
    id_emplacement INT NULL,
    notes          TEXT NULL,
    date_creation  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_se_entrepot    (id_entrepot),
    INDEX idx_se_produit     (id_produit_entrepot),
    INDEX idx_se_transfert   (id_transfert),
    INDEX idx_se_emplacement (id_emplacement),
    INDEX idx_se_user        (id_utilisateur),
    INDEX idx_se_type        (type_sortie),
    INDEX idx_se_date        (date_sortie),
    UNIQUE KEY uq_se_ref (id_entrepot, reference),

    CONSTRAINT fk_se_entrepot    FOREIGN KEY (id_entrepot)             REFERENCES entrepots(id_entrepot)                         ON DELETE CASCADE,
    CONSTRAINT fk_se_user        FOREIGN KEY (id_utilisateur)          REFERENCES utilisateurs(id_utilisateur)                   ON DELETE CASCADE,
    CONSTRAINT fk_se_produit     FOREIGN KEY (id_produit_entrepot)     REFERENCES produits_entrepot(id_produit_entrepot)         ON DELETE CASCADE,
    CONSTRAINT fk_se_unite       FOREIGN KEY (id_unite_vente_entrepot) REFERENCES unites_vente_entrepot(id_unite_vente_entrepot) ON DELETE SET NULL,
    CONSTRAINT fk_se_transfert   FOREIGN KEY (id_transfert)            REFERENCES transferts_stock(id_transfert)                 ON DELETE SET NULL,
    CONSTRAINT fk_se_emplacement FOREIGN KEY (id_emplacement)          REFERENCES emplacements(id_emplacement)                   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ajustements_stock_entrepot (
    id_ajustement_entrepot INT PRIMARY KEY AUTO_INCREMENT,

    id_entrepot         INT NOT NULL,
    id_utilisateur      INT NOT NULL,
    reference           VARCHAR(50) NOT NULL,
    date_ajustement     DATE NOT NULL,
    id_produit_entrepot INT NOT NULL,

    -- En UNITÉ DE BASE
    quantite          DECIMAL(15,2) NOT NULL,      -- écart (+/-)
    ancienne_quantite DECIMAL(15,2) NOT NULL DEFAULT 0,
    nouvelle_quantite DECIMAL(15,2) NOT NULL DEFAULT 0,

    id_emplacement  INT NULL,
    motif           VARCHAR(200) NOT NULL,
    notes           TEXT NULL,
    date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME NULL,
    valide_par      VARCHAR(100) NULL,

    INDEX idx_ae_entrepot    (id_entrepot),
    INDEX idx_ae_produit     (id_produit_entrepot),
    INDEX idx_ae_emplacement (id_emplacement),
    INDEX idx_ae_user        (id_utilisateur),
    INDEX idx_ae_date        (date_ajustement),
    UNIQUE KEY uq_ae_ref (id_entrepot, reference),

    CONSTRAINT fk_ae_entrepot    FOREIGN KEY (id_entrepot)         REFERENCES entrepots(id_entrepot)                 ON DELETE CASCADE,
    CONSTRAINT fk_ae_user        FOREIGN KEY (id_utilisateur)      REFERENCES utilisateurs(id_utilisateur)           ON DELETE CASCADE,
    CONSTRAINT fk_ae_produit     FOREIGN KEY (id_produit_entrepot) REFERENCES produits_entrepot(id_produit_entrepot) ON DELETE CASCADE,
    CONSTRAINT fk_ae_emplacement FOREIGN KEY (id_emplacement)      REFERENCES emplacements(id_emplacement)           ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventaires_entrepot (
    id_inventaire_entrepot INT PRIMARY KEY AUTO_INCREMENT,

    id_entrepot    INT NOT NULL,
    id_utilisateur INT NOT NULL,
    reference      VARCHAR(50)  NOT NULL,
    libelle        VARCHAR(200) NOT NULL,
    date_debut     DATE NOT NULL,
    date_fin       DATE NULL,
    type_inventaire ENUM('complet', 'partiel', 'tournant') NOT NULL DEFAULT 'complet',
    id_emplacement INT NULL,                       -- si l'inventaire cible un emplacement
    statut ENUM('planifie', 'en_cours', 'termine', 'annule') NOT NULL DEFAULT 'planifie',
    notes           TEXT NULL,
    date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date_validation DATETIME NULL,
    valide_par      VARCHAR(100) NULL,

    INDEX idx_ie_entrepot    (id_entrepot),
    INDEX idx_ie_emplacement (id_emplacement),
    INDEX idx_ie_user        (id_utilisateur),
    INDEX idx_ie_statut      (statut),
    UNIQUE KEY uq_ie_ref (id_entrepot, reference),

    CONSTRAINT fk_ie_entrepot    FOREIGN KEY (id_entrepot)    REFERENCES entrepots(id_entrepot)       ON DELETE CASCADE,
    CONSTRAINT fk_ie_user        FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    CONSTRAINT fk_ie_emplacement FOREIGN KEY (id_emplacement) REFERENCES emplacements(id_emplacement) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventaire_lignes_entrepot (
    id_ligne_entrepot      INT PRIMARY KEY AUTO_INCREMENT,
    id_inventaire_entrepot INT NOT NULL,
    id_produit_entrepot    INT NOT NULL,
    id_emplacement         INT NULL,

    -- En UNITÉ DE BASE
    quantite_theorique DECIMAL(15,2) NOT NULL DEFAULT 0,
    quantite_reelle    DECIMAL(15,2) NOT NULL DEFAULT 0,
    ecart              DECIMAL(15,2) NOT NULL DEFAULT 0,

    notes         TEXT NULL,
    date_scannage DATETIME NULL,

    INDEX idx_ile_inventaire  (id_inventaire_entrepot),
    INDEX idx_ile_produit     (id_produit_entrepot),
    INDEX idx_ile_emplacement (id_emplacement),
    UNIQUE KEY uq_ile_inv_produit (id_inventaire_entrepot, id_produit_entrepot),

    CONSTRAINT fk_ile_inventaire  FOREIGN KEY (id_inventaire_entrepot) REFERENCES inventaires_entrepot(id_inventaire_entrepot) ON DELETE CASCADE,
    CONSTRAINT fk_ile_produit     FOREIGN KEY (id_produit_entrepot)    REFERENCES produits_entrepot(id_produit_entrepot)       ON DELETE CASCADE,
    CONSTRAINT fk_ile_emplacement FOREIGN KEY (id_emplacement)         REFERENCES emplacements(id_emplacement)                 ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- VUES POUR LES RAPPORTS (magasin)
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