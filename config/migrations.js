// config/migrations.js
//
// Ajouts à la base faits AU DÉMARRAGE, sans risque et sans perte :
//   - on n'ajoute une colonne / un index / une clé que s'il manque (vérifié dans information_schema) ;
//   - rien n'est supprimé ni modifié dans les données existantes
//     (seule exception : les colonnes « mode de paiement » passent d'une liste fermée
//     à du texte, les valeurs enregistrées restent identiques).
// Fonctionne avec MySQL 5.7/8 et MariaDB.
import normaliserTelephone from '../utils/telephone.js';
import { prochainNumero, estDoublonNumero } from '../utils/numerotation.js';

async function colonneExiste(conn, table, colonne) {
    const [r] = await conn.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, colonne]
    );
    return r.length > 0;
}

async function indexExiste(conn, table, index) {
    const [r] = await conn.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
        [table, index]
    );
    return r.length > 0;
}

async function cleExiste(conn, table, contrainte) {
    const [r] = await conn.query(
        `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
        [table, contrainte]
    );
    return r.length > 0;
}

const COLONNES = [
    // ---------- Fiche client ----------
    ['clients', 'type_client', "ENUM('particulier', 'revendeur', 'entreprise') NOT NULL DEFAULT 'particulier'"],
    ['clients', 'quartier', 'VARCHAR(100) NULL'],
    ['clients', 'telephone2', 'VARCHAR(30) NULL'],
    ['clients', 'telephone_normalise', 'VARCHAR(20) NULL'],
    ['clients', 'telephone2_normalise', 'VARCHAR(20) NULL'],
    ['clients', 'plafond_credit', 'DECIMAL(15, 2) NULL'],
    ['clients', 'note', 'TEXT NULL'],
    ['clients', 'fusionne_dans', 'INT NULL'],
    ['clients', 'date_modification', 'DATETIME NULL ON UPDATE CURRENT_TIMESTAMP'],
    ['clients', 'code_client', 'VARCHAR(20) NULL'],
    // ---------- Sécurité de la connexion ----------
    ['utilisateurs', 'tentatives_echouees', 'INT NOT NULL DEFAULT 0'],
    ['utilisateurs', 'bloque_jusqua', 'DATETIME NULL'],
    ['utilisateurs', 'session_version', 'INT NOT NULL DEFAULT 1'],
    ['employes', 'tentatives_echouees', 'INT NOT NULL DEFAULT 0'],
    ['employes', 'bloque_jusqua', 'DATETIME NULL'],
    ['employes', 'session_version', 'INT NOT NULL DEFAULT 1'],
    // ---------- Photo de profil (fichier public au nom aléatoire) ----------
    ['utilisateurs', 'photo_url', 'VARCHAR(255) NULL'],
    ['employes', 'photo_url', 'VARCHAR(255) NULL'],
    // ---------- Fiche employé ----------
    ['employes', 'date_naissance', 'DATE NULL'],
    ['employes', 'adresse', 'VARCHAR(255) NULL'],
    ['employes', 'quartier', 'VARCHAR(100) NULL'],
    ['employes', 'piece_type', 'VARCHAR(30) NULL'],
    ['employes', 'piece_numero', 'VARCHAR(60) NULL'],
    ['employes', 'date_embauche', 'DATE NULL'],
    ['employes', 'salaire', 'DECIMAL(15, 2) NULL'],
    ['employes', 'contact_urgence_nom', 'VARCHAR(120) NULL'],
    ['employes', 'contact_urgence_tel', 'VARCHAR(30) NULL'],
    ['employes', 'notes', 'TEXT NULL'],
    // ---------- Vente rattachée à une fiche client ----------
    ['commandes_vente', 'id_client', 'INT NULL'],
];

const INDEX = [
    ['clients', 'idx_client_tel', '(id_utilisateur, telephone_normalise)'],
    ['clients', 'idx_client_tel2', '(id_utilisateur, telephone2_normalise)'],
    ['commandes_vente', 'idx_cv_client', '(id_client)'],
    // Numéro client unique par compte (CL-0001…) ; plusieurs NULL autorisés le temps de la numérotation
    ['clients', 'uniq_code_client', '(id_utilisateur, code_client)', 'UNIQUE'],
];

// Abonnements des patrons (validés à la main par le super-admin).
// Nouvelle table : aucune table existante n'est touchée.
const TABLE_ABONNEMENTS = `
CREATE TABLE IF NOT EXISTS abonnements (
    id_abonnement INT AUTO_INCREMENT PRIMARY KEY,
    id_utilisateur INT NOT NULL,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    nb_mois INT NOT NULL DEFAULT 1,
    montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
    moyen_paiement VARCHAR(30) NULL,
    reference VARCHAR(100) NULL,
    note VARCHAR(255) NULL,
    id_super_admin INT NULL,
    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_abo_utilisateur (id_utilisateur, date_fin),
    CONSTRAINT fk_abo_utilisateur FOREIGN KEY (id_utilisateur)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
)`;

// Modes de paiement choisis par chaque boutique (Paramètres)
const TABLE_MODES_PAIEMENT = `
CREATE TABLE IF NOT EXISTS modes_paiement_magasin (
    id_utilisateur INT NOT NULL,
    code VARCHAR(30) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id_utilisateur, code),
    CONSTRAINT fk_mpm_utilisateur FOREIGN KEY (id_utilisateur)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
)`;

// Colonnes « mode de paiement » : liste fermée → texte libre (Wave, Orange Money…).
// Les valeurs déjà enregistrées (especes, carte…) restent identiques.
const COLONNES_MODE_PAIEMENT = ['paiements', 'factures_vente', 'depenses', 'paiements_fournisseurs'];

// Emplacements de la boutique : emplacement > rayon > étagère
const TABLE_EMPLACEMENTS = `
CREATE TABLE IF NOT EXISTS emplacements_magasin (
    id_emplacement INT AUTO_INCREMENT PRIMARY KEY,
    id_utilisateur INT NOT NULL,
    id_parent INT NULL,
    niveau ENUM('emplacement', 'rayon', 'etagere') NOT NULL,
    nom VARCHAR(100) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_empl_util (id_utilisateur, niveau),
    INDEX idx_empl_parent (id_parent),
    CONSTRAINT fk_empl_utilisateur FOREIGN KEY (id_utilisateur)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    CONSTRAINT fk_empl_parent FOREIGN KEY (id_parent)
        REFERENCES emplacements_magasin(id_emplacement) ON DELETE CASCADE
)`;

async function assouplirModesPaiement(conn) {
    for (const table of COLONNES_MODE_PAIEMENT) {
        const [r] = await conn.query(
            `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nul FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'mode_paiement' LIMIT 1`,
            [table]
        );
        if (!r.length || !/^enum/i.test(r[0].type)) continue;
        const nul = r[0].nul === 'YES' ? 'NULL' : 'NOT NULL';
        await conn.query(`ALTER TABLE \`${table}\` MODIFY mode_paiement VARCHAR(30) ${nul} DEFAULT 'especes'`);
        console.log(` [Migration] ${table}.mode_paiement : modes de paiement libres`);
    }
}

// Reprend les emplacements tapés en texte sur les produits (une seule fois par produit)
// Reprend l'emplacement saisi en texte libre et le range dans les listes.
// Boutique : produits.id_emplacement_magasin ; entrepôt : produits_entrepot.id_emplacement
const REPRISES = [
    { table: 'produits', id: 'id_produit', lien: 'id_emplacement_magasin', entrepot: false, racine: 'Boutique' },
    { table: 'produits_entrepot', id: 'id_produit_entrepot', lien: 'id_emplacement', entrepot: true, racine: 'Entrepôt' },
];

async function reprendreEmplacementsTexte(conn, cfg) {
    const [produits] = await conn.query(
        `SELECT ${cfg.id} AS id, id_utilisateur, ${cfg.entrepot ? 'id_entrepot' : 'NULL'} AS id_entrepot,
                TRIM(emplacement) AS e, TRIM(rayon) AS r, TRIM(etagere) AS t
         FROM ${cfg.table}
         WHERE ${cfg.lien} IS NULL
           AND (COALESCE(TRIM(emplacement), '') <> '' OR COALESCE(TRIM(rayon), '') <> '' OR COALESCE(TRIM(etagere), '') <> '')`
    );
    if (!produits.length) return;
    const cache = new Map();
    const noeud = async (p, parent, niveau, nom) => {
        const portee = cfg.entrepot ? `e${p.id_entrepot}` : `u${p.id_utilisateur}`;
        const cle = `${portee}|${parent || 0}|${niveau}|${nom.toLowerCase()}`;
        if (cache.has(cle)) return cache.get(cle);
        const [ex] = await conn.query(
            `SELECT id_emplacement FROM emplacements_magasin
             WHERE ${cfg.entrepot ? 'id_entrepot = ?' : 'id_utilisateur = ? AND id_entrepot IS NULL'}
               AND niveau = ? AND LOWER(nom) = LOWER(?) AND ${parent ? 'id_parent = ?' : 'id_parent IS NULL'} LIMIT 1`,
            [cfg.entrepot ? p.id_entrepot : p.id_utilisateur, niveau, nom, ...(parent ? [parent] : [])]
        );
        let id = ex[0]?.id_emplacement;
        if (!id) {
            const [ins] = await conn.query(
                'INSERT INTO emplacements_magasin (id_utilisateur, id_entrepot, id_parent, niveau, nom) VALUES (?, ?, ?, ?, ?)',
                [p.id_utilisateur, p.id_entrepot || null, parent || null, niveau, nom.slice(0, 100)]
            );
            id = ins.insertId;
        }
        cache.set(cle, id);
        return id;
    };
    for (const p of produits) {
        // Rayon ou étagère sans emplacement : rangés dans « Boutique » (ou « Entrepôt »)
        const e = await noeud(p, null, 'emplacement', p.e || cfg.racine);
        let feuille = e;
        if (p.r || p.t) feuille = await noeud(p, e, 'rayon', p.r || 'Sans rayon');
        if (p.t) feuille = await noeud(p, feuille, 'etagere', p.t);
        await conn.query(`UPDATE ${cfg.table} SET ${cfg.lien} = ? WHERE ${cfg.id} = ?`, [feuille, p.id]);
        if (!p.e) await conn.query(`UPDATE ${cfg.table} SET emplacement = ? WHERE ${cfg.id} = ?`, [cfg.racine, p.id]);
        if (p.t && !p.r) await conn.query(`UPDATE ${cfg.table} SET rayon = 'Sans rayon' WHERE ${cfg.id} = ?`, [p.id]);
    }
    console.log(` [Migration] emplacements repris pour ${produits.length} produit(s) (${cfg.table})`);
}


// ============================================================
// COMPTES FOURNISSEURS : carnet de compte du commerçant chez chaque fournisseur
// (achats, versements, bonus, plafond, rapprochements). Indépendant du stock.
// ============================================================
const TABLE_COMPTES_FOURNISSEURS = `
CREATE TABLE IF NOT EXISTS comptes_fournisseurs (
    id_compte INT AUTO_INCREMENT PRIMARY KEY,
    id_utilisateur INT NOT NULL,
    id_fournisseur INT NOT NULL,
    plafond DECIMAL(15,2) NOT NULL DEFAULT 0,
    solde_initial DECIMAL(15,2) NOT NULL DEFAULT 0,
    seuil_alerte_pct TINYINT UNSIGNED NOT NULL DEFAULT 20,
    note TEXT NULL,
    actif TINYINT(1) NOT NULL DEFAULT 1,
    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cf_fournisseur (id_utilisateur, id_fournisseur),
    CONSTRAINT fk_cf_utilisateur FOREIGN KEY (id_utilisateur)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE,
    CONSTRAINT fk_cf_fournisseur FOREIGN KEY (id_fournisseur)
        REFERENCES fournisseurs(id_fournisseur) ON DELETE CASCADE
)`;

// Une ligne par opération. On ne supprime jamais : une annulation est une ligne de plus.
const TABLE_OPERATIONS_COMPTE_FOURNISSEUR = `
CREATE TABLE IF NOT EXISTS operations_compte_fournisseur (
    id_operation INT AUTO_INCREMENT PRIMARY KEY,
    id_compte INT NOT NULL,
    id_utilisateur INT NOT NULL,
    type ENUM('achat','versement','bonus','utilisation_bonus','ajustement','plafond','annulation') NOT NULL,
    date_operation DATE NOT NULL,
    montant DECIMAL(15,2) NOT NULL DEFAULT 0,
    montant_paye DECIMAL(15,2) NOT NULL DEFAULT 0,
    bonus_utilise DECIMAL(15,2) NOT NULL DEFAULT 0,
    sur_dette TINYINT(1) NOT NULL DEFAULT 0,
    mode_paiement VARCHAR(30) NULL,
    type_bonus ENUM('libre','conditionnel','avoir') NULL,
    date_expiration DATE NULL,
    reference VARCHAR(100) NULL,
    observation TEXT NULL,
    justificatif VARCHAR(255) NULL,
    id_operation_liee INT NULL,
    annulee TINYINT(1) NOT NULL DEFAULT 0,
    dette_avant DECIMAL(15,2) NULL,
    dette_apres DECIMAL(15,2) NULL,
    bonus_avant DECIMAL(15,2) NULL,
    bonus_apres DECIMAL(15,2) NULL,
    plafond_avant DECIMAL(15,2) NULL,
    plafond_apres DECIMAL(15,2) NULL,
    cree_par_type ENUM('utilisateur','employe') NULL,
    cree_par_id INT NULL,
    cree_par_nom VARCHAR(100) NULL,
    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ocf_compte (id_compte, date_operation),
    INDEX idx_ocf_liee (id_operation_liee),
    CONSTRAINT fk_ocf_compte FOREIGN KEY (id_compte)
        REFERENCES comptes_fournisseurs(id_compte) ON DELETE CASCADE
)`;

const TABLE_RAPPROCHEMENTS_FOURNISSEUR = `
CREATE TABLE IF NOT EXISTS rapprochements_fournisseur (
    id_rapprochement INT AUTO_INCREMENT PRIMARY KEY,
    id_compte INT NOT NULL,
    id_utilisateur INT NOT NULL,
    date_verification DATE NOT NULL,
    solde_fournisseur DECIMAL(15,2) NOT NULL,
    solde_miyo DECIMAL(15,2) NOT NULL,
    ecart DECIMAL(15,2) NOT NULL,
    observation TEXT NULL,
    statut ENUM('conforme','ecart','resolu') NOT NULL,
    note_resolution TEXT NULL,
    date_resolution DATETIME NULL,
    cree_par_nom VARCHAR(100) NULL,
    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rf_compte (id_compte, date_verification),
    CONSTRAINT fk_rf_compte FOREIGN KEY (id_compte)
        REFERENCES comptes_fournisseurs(id_compte) ON DELETE CASCADE
)`;


// Paiements fournisseurs = les versements du compte fournisseur (une seule liste).
// On ne supprime plus : on annule (avec la raison). Un versement réparti sur plusieurs
// commandes garde un même « groupe ». Photo du reçu possible.
async function unifierPaiementsFournisseurs(conn) {
    const colonnes = [
        ['justificatif', 'VARCHAR(255) NULL'],
        ['groupe', 'VARCHAR(40) NULL'],
        ['annule', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['motif_annulation', 'VARCHAR(500) NULL'],
        ['annule_le', 'DATETIME NULL'],
        ['annule_par_nom', 'VARCHAR(100) NULL'],
    ];
    for (const [c, def] of colonnes) {
        if (!(await colonneExiste(conn, 'paiements_fournisseurs', c))) {
            await conn.query(`ALTER TABLE paiements_fournisseurs ADD COLUMN ${c} ${def}`);
            console.log(` [Migration] paiements_fournisseurs.${c} ajoutée`);
        }
    }
    // Versements saisis dans la première version des comptes fournisseurs → paiements fournisseurs
    const [vers] = await conn.query(
        `SELECT o.*, c.id_fournisseur FROM operations_compte_fournisseur o
         JOIN comptes_fournisseurs c ON c.id_compte = o.id_compte WHERE o.type = 'versement'`
    );
    for (const v of vers) {
        const [an] = await conn.query(
            "SELECT observation, cree_par_nom, date_creation FROM operations_compte_fournisseur WHERE type = 'annulation' AND id_operation_liee = ? LIMIT 1",
            [v.id_operation]
        );
        await conn.query(
            `INSERT INTO paiements_fournisseurs
                (id_utilisateur, id_fournisseur, id_commande_achat, date_paiement, montant, mode_paiement, reference, note,
                 cree_par_type, cree_par_id, cree_par_nom, date_creation, justificatif, groupe,
                 annule, motif_annulation, annule_le, annule_par_nom)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.id_utilisateur, v.id_fournisseur, v.date_operation, v.montant, v.mode_paiement || 'especes', v.reference, v.observation,
                v.cree_par_type, v.cree_par_id, v.cree_par_nom, v.date_creation, v.justificatif, `cf-${v.id_operation}`,
                v.annulee ? 1 : 0, an[0]?.observation || null, an[0]?.date_creation || null, an[0]?.cree_par_nom || null]
        );
        await conn.query("DELETE FROM operations_compte_fournisseur WHERE type = 'annulation' AND id_operation_liee = ?", [v.id_operation]);
        await conn.query('DELETE FROM operations_compte_fournisseur WHERE id_operation = ?', [v.id_operation]);
    }
    if (vers.length) console.log(` [Migration] ${vers.length} versement(s) déplacé(s) vers paiements_fournisseurs`);
}


// ============================================================
// CACHETS ET SIGNATURE des documents (images rangées hors du dossier public)
// ============================================================
const TABLE_CACHETS = `
CREATE TABLE IF NOT EXISTS cachets_magasin (
    id_cachet INT AUTO_INCREMENT PRIMARY KEY,
    id_utilisateur INT NOT NULL,
    nom VARCHAR(80) NOT NULL,
    fichier VARCHAR(255) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cachets_u (id_utilisateur),
    CONSTRAINT fk_cachets_u FOREIGN KEY (id_utilisateur)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
)`;

// Réglages des documents : quel cachet sur quel document, signature, modèle de facture
const TABLE_REGLAGES_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS reglages_documents (
    id_utilisateur INT PRIMARY KEY,
    signature_fichier VARCHAR(255) NULL,
    modele_facture VARCHAR(30) NOT NULL DEFAULT 'classique',
    regles JSON NULL,
    date_modification DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_regdoc_u FOREIGN KEY (id_utilisateur)
        REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
)`;

export async function executerMigrations(pool) {
    const conn = await pool.getConnection();
    try {
        await conn.query(TABLE_ABONNEMENTS);
        await conn.query(TABLE_MODES_PAIEMENT);
        await assouplirModesPaiement(conn);
        await conn.query(TABLE_EMPLACEMENTS);
        await conn.query(TABLE_COMPTES_FOURNISSEURS);
        await conn.query(TABLE_OPERATIONS_COMPTE_FOURNISSEUR);
        await conn.query(TABLE_RAPPROCHEMENTS_FOURNISSEUR);
        await unifierPaiementsFournisseurs(conn);
        await conn.query(TABLE_CACHETS);
        await conn.query(TABLE_REGLAGES_DOCUMENTS);
        if (!(await colonneExiste(conn, 'produits', 'id_emplacement_magasin'))) {
            await conn.query('ALTER TABLE produits ADD COLUMN id_emplacement_magasin INT NULL');
            await conn.query('ALTER TABLE produits ADD INDEX idx_produit_emplacement (id_emplacement_magasin)');
            console.log(' [Migration] produits.id_emplacement_magasin ajoutée');
        }
        // Emplacements propres à chaque entrepôt (id_entrepot vide = boutique)
        if (!(await colonneExiste(conn, 'emplacements_magasin', 'id_entrepot'))) {
            await conn.query('ALTER TABLE emplacements_magasin ADD COLUMN id_entrepot INT NULL AFTER id_utilisateur');
            await conn.query('ALTER TABLE emplacements_magasin ADD INDEX idx_empl_entrepot (id_entrepot, niveau)');
            await conn.query(`ALTER TABLE emplacements_magasin ADD CONSTRAINT fk_empl_entrepot
                FOREIGN KEY (id_entrepot) REFERENCES entrepots(id_entrepot) ON DELETE CASCADE`);
            console.log(' [Migration] emplacements_magasin.id_entrepot ajoutée');
        }
        if (!(await colonneExiste(conn, 'produits_entrepot', 'id_emplacement'))) {
            await conn.query('ALTER TABLE produits_entrepot ADD COLUMN id_emplacement INT NULL');
            await conn.query('ALTER TABLE produits_entrepot ADD INDEX idx_pe_emplacement (id_emplacement)');
            console.log(' [Migration] produits_entrepot.id_emplacement ajoutée');
        }
        for (const cfg of REPRISES) await reprendreEmplacementsTexte(conn, cfg);
        for (const [table, colonne, definition] of COLONNES) {
            if (!(await colonneExiste(conn, table, colonne))) {
                await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${colonne}\` ${definition}`);
                console.log(` [Migration] ${table}.${colonne} ajoutée`);
            }
        }
        for (const [table, nom, colonnes, type] of INDEX) {
            if (!(await indexExiste(conn, table, nom))) {
                await conn.query(`ALTER TABLE \`${table}\` ADD ${type === 'UNIQUE' ? 'UNIQUE ' : ''}INDEX \`${nom}\` ${colonnes}`);
            }
        }
        if (!(await cleExiste(conn, 'commandes_vente', 'fk_cv_client'))) {
            await conn.query(
                `ALTER TABLE commandes_vente ADD CONSTRAINT fk_cv_client
                 FOREIGN KEY (id_client) REFERENCES clients(id_client) ON DELETE SET NULL`
            );
        }
    } finally {
        conn.release();
    }
}

/**
 * Crée les fiches clients à partir des ventes déjà enregistrées (par téléphone) et rattache ces ventes.
 * Idempotent : ne traite que les ventes pas encore rattachées. Lancé en arrière-plan au démarrage.
 */
export async function rattacherVentesAuxClients(pool) {
    // 1. Fiches existantes sans forme normalisée du téléphone
    const [sansNorme] = await pool.query(
        `SELECT id_client, telephone, telephone2 FROM clients
         WHERE (telephone_normalise IS NULL AND telephone IS NOT NULL AND telephone <> '')
            OR (telephone2_normalise IS NULL AND telephone2 IS NOT NULL AND telephone2 <> '')`
    );
    for (const c of sansNorme) {
        await pool.query(
            'UPDATE clients SET telephone_normalise = ?, telephone2_normalise = ? WHERE id_client = ?',
            [normaliserTelephone(c.telephone), normaliserTelephone(c.telephone2), c.id_client]
        );
    }

    // 2. Ventes pas encore rattachées (les plus récentes d'abord : le nom le plus récent est gardé)
    let total = 0;
    const cache = new Map();
    let dernierId = Number.MAX_SAFE_INTEGER;
    for (;;) {
        const [ventes] = await pool.query(
            `SELECT id_commande, id_utilisateur, telephone, nomclient, date_creation
             FROM commandes_vente
             WHERE id_client IS NULL AND telephone IS NOT NULL AND telephone <> '' AND id_commande < ?
             ORDER BY id_commande DESC LIMIT 1000`,
            [dernierId]
        );
        if (!ventes.length) break;
        dernierId = ventes[ventes.length - 1].id_commande;

        const parClient = new Map();
        for (const v of ventes) {
            const norme = normaliserTelephone(v.telephone);
            if (!norme) continue;
            const cle = `${v.id_utilisateur}|${norme}`;
            let id = cache.get(cle);
            if (!id) {
                const [trouve] = await pool.query(
                    `SELECT id_client, fusionne_dans FROM clients
                     WHERE id_utilisateur = ? AND (telephone_normalise = ? OR telephone2_normalise = ?)
                     ORDER BY fusionne_dans IS NOT NULL, actif DESC, id_client ASC LIMIT 1`,
                    [v.id_utilisateur, norme, norme]
                );
                if (trouve[0]) {
                    id = trouve[0].fusionne_dans || trouve[0].id_client;
                } else {
                    const [r] = await pool.query(
                        `INSERT INTO clients (id_utilisateur, nom, telephone, telephone_normalise, date_creation)
                         VALUES (?, ?, ?, ?, ?)`,
                        [v.id_utilisateur, String(v.nomclient || 'Client').trim().slice(0, 200) || 'Client',
                         String(v.telephone).trim().slice(0, 20), norme, v.date_creation || new Date()]
                    );
                    id = r.insertId;
                }
                cache.set(cle, id);
            }
            if (!parClient.has(id)) parClient.set(id, []);
            parClient.get(id).push(v.id_commande);
        }
        for (const [id, ids] of parClient) {
            await pool.query(`UPDATE commandes_vente SET id_client = ? WHERE id_commande IN (${ids.map(() => '?').join(',')})`, [id, ...ids]);
            total += ids.length;
        }
    }
    // La date de création d'une fiche reprise = date de la première vente
    await pool.query(
        `UPDATE clients c
         JOIN (SELECT id_client, MIN(date_creation) AS premiere FROM commandes_vente WHERE id_client IS NOT NULL GROUP BY id_client) v
           ON v.id_client = c.id_client
         SET c.date_creation = v.premiere
         WHERE v.premiere < c.date_creation`
    );
    if (total) console.log(` [Clients] ${total} vente(s) rattachée(s) à une fiche client`);

    // 3. Numéro client (CL-0001…) pour les fiches qui n'en ont pas, dans l'ordre d'ancienneté
    const [sansCode] = await pool.query(
        'SELECT id_client, id_utilisateur FROM clients WHERE code_client IS NULL ORDER BY id_utilisateur, date_creation, id_client'
    );
    for (const c of sansCode) {
        await attribuerCodeClient(pool, c.id_client, c.id_utilisateur);
    }
    if (sansCode.length) console.log(` [Clients] ${sansCode.length} numéro(s) client attribué(s)`);
    return total;
}

/**
 * Donne à une fiche client son numéro définitif (CL-0001, CL-0002…), s'il n'en a pas encore.
 * db = pool ou connexion de transaction. Reprend avec le numéro suivant en cas de doublon.
 */
export async function attribuerCodeClient(db, id_client, id_utilisateur) {
    for (let essai = 1; essai <= 15; essai++) {
        const code = await prochainNumero({ table: 'clients', prefixe: 'CL-', id_utilisateur, db });
        try {
            const [r] = await db.query(
                'UPDATE clients SET code_client = ? WHERE id_client = ? AND code_client IS NULL',
                [code, id_client]
            );
            return r.affectedRows ? code : null;
        } catch (e) {
            if (!estDoublonNumero(e) || essai === 15) throw e;
        }
    }
    return null;
}
