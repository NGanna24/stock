// models/ReglagesDocuments.js
// ============================================================
// Cachets (images PNG) et signature des documents, quel cachet sur quel
// document, et modèle de facture choisi. Les images sont rangées hors du
// dossier public : elles sont renvoyées en « data URL » aux comptes connectés.
// ============================================================
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { DOSSIER_IMAGES_DOCUMENTS } from '../middleware/uploadImageDocument.js';

export const TYPES_DOCUMENTS = [
    'facture', 'ticket', 'bon_commande', 'bon_transfert',
    'retour_fournisseur', 'retour_client', 'releve_client', 'rapport_caisse',
];
// Documents dont le cachet dépend du paiement
const SELON_PAIEMENT = ['facture', 'ticket'];
export const MODELES_FACTURE = ['classique', 'moderne', 'epure', 'compact'];
const MAX_CACHETS = 20;

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const versDataUrl = (fichier) => {
    if (!fichier) return null;
    try {
        const chemin = path.join(DOSSIER_IMAGES_DOCUMENTS, path.basename(fichier));
        const ext = path.extname(fichier).toLowerCase();
        const type = ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        return `data:${type};base64,${fs.readFileSync(chemin).toString('base64')}`;
    } catch {
        return null; // fichier absent : on n'affiche rien
    }
};

export const supprimerImage = (fichier) => {
    try { if (fichier) fs.unlinkSync(path.join(DOSSIER_IMAGES_DOCUMENTS, path.basename(fichier))); } catch { /* déjà absent */ }
};

// Garde uniquement des règles valides, avec des cachets qui existent
function nettoyerRegles(brut, idsValides) {
    const regles = {};
    const id = (v) => (v && idsValides.has(Number(v)) ? Number(v) : null);
    for (const t of TYPES_DOCUMENTS) {
        const r = (brut && typeof brut === 'object' ? brut[t] : null) || {};
        regles[t] = SELON_PAIEMENT.includes(t)
            ? { payee: id(r.payee), partielle: id(r.partielle), non_payee: id(r.non_payee), signature: !!r.signature }
            : { cachet: id(r.cachet), signature: !!r.signature };
    }
    return regles;
}

class ReglagesDocuments {
    static async _ligne(idUtilisateur) {
        const [r] = await pool.query('SELECT * FROM reglages_documents WHERE id_utilisateur = ?', [idUtilisateur]);
        return r[0] || null;
    }

    static async _cachets(idUtilisateur) {
        const [r] = await pool.query('SELECT * FROM cachets_magasin WHERE id_utilisateur = ? ORDER BY position, id_cachet', [idUtilisateur]);
        return r;
    }

    /** Tout ce qu'il faut pour imprimer (lu par tous les comptes du magasin) */
    static async lire(idUtilisateur) {
        const ligne = await this._ligne(idUtilisateur);
        const cachets = await this._cachets(idUtilisateur);
        let regles = null;
        try { regles = typeof ligne?.regles === 'string' ? JSON.parse(ligne.regles) : ligne?.regles; } catch { regles = null; }
        return {
            cachets: cachets.map((c) => ({ id_cachet: c.id_cachet, nom: c.nom, image: versDataUrl(c.fichier) })),
            signature: versDataUrl(ligne?.signature_fichier),
            regles: nettoyerRegles(regles, new Set(cachets.map((c) => c.id_cachet))),
            modele_facture: MODELES_FACTURE.includes(ligne?.modele_facture) ? ligne.modele_facture : 'classique',
        };
    }

    static async ajouterCachet(idUtilisateur, nom, fichier) {
        const propre = String(nom || '').trim().slice(0, 80);
        if (!propre) throw fail('Donnez un nom au cachet (ex : Payé, Livré, Cachet du magasin)');
        const cachets = await this._cachets(idUtilisateur);
        if (cachets.length >= MAX_CACHETS) throw fail(`${MAX_CACHETS} cachets au maximum`);
        if (cachets.some((c) => c.nom.toLowerCase() === propre.toLowerCase())) throw fail(`Un cachet « ${propre} » existe déjà`, 409);
        const [ins] = await pool.query(
            'INSERT INTO cachets_magasin (id_utilisateur, nom, fichier, position) VALUES (?, ?, ?, ?)',
            [idUtilisateur, propre, fichier, cachets.length]
        );
        return ins.insertId;
    }

    static async modifierCachet(idUtilisateur, idCachet, { nom }, fichier) {
        const [r] = await pool.query('SELECT * FROM cachets_magasin WHERE id_cachet = ? AND id_utilisateur = ?', [idCachet, idUtilisateur]);
        const c = r[0];
        if (!c) throw fail('Cachet introuvable', 404);
        const sets = []; const params = [];
        if (nom !== undefined) {
            const propre = String(nom || '').trim().slice(0, 80);
            if (!propre) throw fail('Donnez un nom au cachet');
            const [dup] = await pool.query('SELECT id_cachet FROM cachets_magasin WHERE id_utilisateur = ? AND LOWER(nom) = LOWER(?) AND id_cachet <> ?', [idUtilisateur, propre, idCachet]);
            if (dup.length) throw fail(`Un cachet « ${propre} » existe déjà`, 409);
            sets.push('nom = ?'); params.push(propre);
        }
        if (fichier) { sets.push('fichier = ?'); params.push(fichier); }
        if (!sets.length) return;
        await pool.query(`UPDATE cachets_magasin SET ${sets.join(', ')} WHERE id_cachet = ?`, [...params, idCachet]);
        if (fichier) supprimerImage(c.fichier);
    }

    static async supprimerCachet(idUtilisateur, idCachet) {
        const [r] = await pool.query('SELECT fichier FROM cachets_magasin WHERE id_cachet = ? AND id_utilisateur = ?', [idCachet, idUtilisateur]);
        if (!r[0]) throw fail('Cachet introuvable', 404);
        await pool.query('DELETE FROM cachets_magasin WHERE id_cachet = ?', [idCachet]);
        supprimerImage(r[0].fichier);
        // Les règles qui l'utilisaient retombent à « aucun » (nettoyées à la lecture)
    }

    static async definirSignature(idUtilisateur, fichier) {
        const ligne = await this._ligne(idUtilisateur);
        await pool.query(
            `INSERT INTO reglages_documents (id_utilisateur, signature_fichier) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE signature_fichier = VALUES(signature_fichier)`,
            [idUtilisateur, fichier]
        );
        if (ligne?.signature_fichier && ligne.signature_fichier !== fichier) supprimerImage(ligne.signature_fichier);
    }

    static async enregistrerReglages(idUtilisateur, { regles, modele_facture }) {
        const cachets = await this._cachets(idUtilisateur);
        const propres = regles !== undefined ? JSON.stringify(nettoyerRegles(regles, new Set(cachets.map((c) => c.id_cachet)))) : undefined;
        if (modele_facture !== undefined && !MODELES_FACTURE.includes(modele_facture)) throw fail('Modèle de facture inconnu');
        await pool.query(
            `INSERT INTO reglages_documents (id_utilisateur, regles, modele_facture) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE regles = COALESCE(?, regles), modele_facture = COALESCE(?, modele_facture)`,
            [idUtilisateur, propres ?? null, modele_facture || 'classique', propres ?? null, modele_facture ?? null]
        );
    }
}

export default ReglagesDocuments;
