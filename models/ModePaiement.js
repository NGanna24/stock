// models/ModePaiement.js — modes de paiement acceptés par une boutique
import { pool } from '../config/db.js';
import { MODES_PAIEMENT, MODES_PAR_DEFAUT } from '../utils/modesPaiement.js';

const CODES_PROPOSES = MODES_PAIEMENT.map((m) => m.code);

class ModePaiement {
    // Codes actifs de la boutique, dans l'ordre choisi (défaut si rien n'est réglé)
    static async actifs(idUtilisateur) {
        const [rows] = await pool.query(
            'SELECT code FROM modes_paiement_magasin WHERE id_utilisateur = ? ORDER BY position, code',
            [idUtilisateur]
        );
        const codes = rows.map((r) => r.code).filter((c) => CODES_PROPOSES.includes(c));
        return codes.length ? codes : [...MODES_PAR_DEFAUT];
    }

    // Remplace la sélection (au moins un mode)
    static async enregistrer(idUtilisateur, codes) {
        const propres = [...new Set((codes || []).filter((c) => CODES_PROPOSES.includes(c)))];
        if (!propres.length) {
            const err = new Error('Choisissez au moins un mode de paiement');
            err.statusCode = 400;
            throw err;
        }
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM modes_paiement_magasin WHERE id_utilisateur = ?', [idUtilisateur]);
            await conn.query(
                'INSERT INTO modes_paiement_magasin (id_utilisateur, code, position) VALUES ?',
                [propres.map((c, i) => [idUtilisateur, c, i])]
            );
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        return propres;
    }
}

export default ModePaiement;
