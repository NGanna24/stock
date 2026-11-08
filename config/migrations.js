// config/migrations.js
//
// Ajouts à la base faits AU DÉMARRAGE, sans risque et sans perte :
//   - on n'ajoute une colonne / un index / une clé que s'il manque (vérifié dans information_schema) ;
//   - rien n'est supprimé ni modifié dans les données existantes.
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

export async function executerMigrations(pool) {
    const conn = await pool.getConnection();
    try {
        await conn.query(TABLE_ABONNEMENTS);
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
