// models/RelanceClient.js
//
// Relances clients : qui nous doit de l'argent, depuis quand, et quand on l'a relancé.
//   reste dû d'une facture = montant_total − paiements enregistrés
//   on ne compte ni les factures payées / annulées, ni celles d'une vente annulée.
// Le client est identifié par son téléphone (comme partout dans Miyo).
import { pool } from '../config/db.js';

const CANAUX = ['whatsapp', 'sms', 'appel', 'autre'];

const erreur = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

// Factures avec un reste à payer (sous-requête réutilisée)
const FACTURES_DUES = `
    SELECT fv.id_facture, fv.numero_facture, fv.date_facture, fv.date_echeance, fv.statut,
           fv.montant_total, cv.id_commande, cv.numero_commande, cv.nomclient,
           TRIM(cv.telephone) AS telephone,
           COALESCE(p.paye, 0) AS paye,
           fv.montant_total - COALESCE(p.paye, 0) AS reste
    FROM factures_vente fv
    JOIN commandes_vente cv ON cv.id_commande = fv.id_commande AND cv.id_utilisateur = fv.id_utilisateur
    LEFT JOIN (SELECT id_facture, SUM(montant) AS paye FROM paiements WHERE id_utilisateur = ? GROUP BY id_facture) p
           ON p.id_facture = fv.id_facture
    WHERE fv.id_utilisateur = ?
      AND fv.statut NOT IN ('payee', 'annulee')
      AND cv.statut <> 'annulee'
      AND fv.montant_total - COALESCE(p.paye, 0) > 0.009
`;

class RelanceClient {
    /** Liste des clients qui doivent de l'argent + totaux + infos du magasin pour le message. */
    static async liste(idUtilisateur) {
        const [clients] = await pool.query(
            `SELECT d.telephone,
                    MAX(d.nomclient) AS nomclient,
                    COUNT(*) AS nb_factures,
                    SUM(d.reste) AS total_du,
                    SUM(CASE WHEN d.date_echeance < CURDATE() THEN d.reste ELSE 0 END) AS du_en_retard,
                    MIN(d.date_echeance) AS plus_ancienne_echeance,
                    MIN(d.date_facture) AS plus_ancienne_facture,
                    GREATEST(DATEDIFF(CURDATE(), MIN(d.date_echeance)), 0) AS jours_retard,
                    r.derniere_relance, r.nb_relances, r.dernier_canal, r.dernier_par
             FROM (${FACTURES_DUES}) d
             LEFT JOIN (
                 SELECT rc.telephone, MAX(rc.date_relance) AS derniere_relance, COUNT(*) AS nb_relances,
                        SUBSTRING_INDEX(GROUP_CONCAT(rc.canal ORDER BY rc.date_relance DESC), ',', 1) AS dernier_canal,
                        SUBSTRING_INDEX(GROUP_CONCAT(rc.par_nom ORDER BY rc.date_relance DESC SEPARATOR '|'), '|', 1) AS dernier_par
                 FROM relances_clients rc
                 WHERE rc.id_utilisateur = ?
                 GROUP BY rc.telephone
             ) r ON r.telephone = d.telephone
             WHERE d.telephone IS NOT NULL AND d.telephone <> ''
             GROUP BY d.telephone, r.derniere_relance, r.nb_relances, r.dernier_canal, r.dernier_par
             ORDER BY du_en_retard DESC, total_du DESC`,
            [idUtilisateur, idUtilisateur, idUtilisateur]
        );

        // Factures dues sans téléphone : impossibles à relancer, mais on les signale
        const [[sansTel]] = await pool.query(
            `SELECT COUNT(*) AS nb, COALESCE(SUM(d.reste), 0) AS montant
             FROM (${FACTURES_DUES}) d WHERE d.telephone IS NULL OR d.telephone = ''`,
            [idUtilisateur, idUtilisateur]
        );

        const lignes = clients.map((c) => ({
            telephone: c.telephone,
            nomclient: c.nomclient,
            nb_factures: Number(c.nb_factures),
            total_du: num(c.total_du),
            du_en_retard: num(c.du_en_retard),
            plus_ancienne_echeance: c.plus_ancienne_echeance,
            plus_ancienne_facture: c.plus_ancienne_facture,
            jours_retard: Number(c.jours_retard) || 0,
            derniere_relance: c.derniere_relance,
            nb_relances: Number(c.nb_relances) || 0,
            dernier_canal: c.dernier_canal || null,
            dernier_par: c.dernier_par || null,
        }));

        const magasin = await RelanceClient.magasin(idUtilisateur);
        return {
            clients: lignes,
            totaux: {
                total_du: num(lignes.reduce((s, c) => s + c.total_du, 0)),
                du_en_retard: num(lignes.reduce((s, c) => s + c.du_en_retard, 0)),
                nb_clients: lignes.length,
                nb_en_retard: lignes.filter((c) => c.du_en_retard > 0.009).length,
                sans_telephone: { nb_factures: Number(sansTel.nb), montant: num(sansTel.montant) },
            },
            magasin,
        };
    }

    /** Factures dues + historique des relances d'un client. */
    static async detail(idUtilisateur, telephone) {
        const tel = String(telephone || '').trim();
        if (!tel) throw erreur('Téléphone du client manquant');
        const [factures] = await pool.query(
            `SELECT d.*, GREATEST(DATEDIFF(CURDATE(), d.date_echeance), 0) AS jours_retard
             FROM (${FACTURES_DUES}) d WHERE d.telephone = ?
             ORDER BY d.date_echeance ASC, d.id_facture ASC`,
            [idUtilisateur, idUtilisateur, tel]
        );
        const [relances] = await pool.query(
            `SELECT id_relance, canal, montant_du, nb_factures, factures, message, note, par_type, par_id, par_nom, date_relance
             FROM relances_clients WHERE id_utilisateur = ? AND telephone = ?
             ORDER BY date_relance DESC, id_relance DESC LIMIT 100`,
            [idUtilisateur, tel]
        );
        return {
            telephone: tel,
            nomclient: factures[0]?.nomclient || relances[0]?.nomclient || null,
            factures: factures.map((f) => ({
                id_facture: f.id_facture,
                numero_facture: f.numero_facture,
                numero_commande: f.numero_commande,
                id_commande: f.id_commande,
                date_facture: f.date_facture,
                date_echeance: f.date_echeance,
                statut: f.statut,
                montant_total: num(f.montant_total),
                paye: num(f.paye),
                reste: num(f.reste),
                jours_retard: Number(f.jours_retard) || 0,
            })),
            total_du: num(factures.reduce((s, f) => s + Number(f.reste), 0)),
            relances: relances.map((r) => ({ ...r, montant_du: num(r.montant_du) })),
            magasin: await RelanceClient.magasin(idUtilisateur),
        };
    }

    /**
     * Enregistre une relance (au moment où l'utilisateur ouvre WhatsApp / SMS ou note un appel).
     * Le montant et les factures sont recalculés côté serveur (on ne fait pas confiance au navigateur).
     */
    static async enregistrer(idUtilisateur, data, par) {
        const tel = String(data.telephone || '').trim();
        if (!tel) throw erreur('Téléphone du client manquant');
        const canal = CANAUX.includes(data.canal) ? data.canal : null;
        if (!canal) throw erreur('Canal de relance invalide');

        const { factures, total_du, nomclient } = await RelanceClient.detail(idUtilisateur, tel);
        if (!factures.length) throw erreur('Ce client ne doit plus rien : aucune relance à faire', 409);

        const message = data.message ? String(data.message).slice(0, 2000) : null;
        const note = data.note ? String(data.note).trim().slice(0, 255) : null;
        const numeros = factures.map((f) => f.numero_facture).join(', ').slice(0, 500);

        const [r] = await pool.execute(
            `INSERT INTO relances_clients
                (id_utilisateur, telephone, nomclient, canal, montant_du, nb_factures, factures, message, note, par_type, par_id, par_nom)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [idUtilisateur, tel, nomclient, canal, total_du, factures.length, numeros, message, note,
             par.type, par.id, par.nom]
        );
        return {
            id_relance: r.insertId,
            telephone: tel,
            nomclient,
            canal,
            montant_du: total_du,
            nb_factures: factures.length,
            factures: numeros,
        };
    }

    /** Nom et contact du magasin (pour signer le message). */
    static async magasin(idUtilisateur) {
        try {
            const [rows] = await pool.query(
                `SELECT m.nom_commercial, m.telephone, m.whatsapp, m.ville, u.fullname
                 FROM utilisateurs u LEFT JOIN magasins m ON m.id_utilisateur = u.id_utilisateur
                 WHERE u.id_utilisateur = ? LIMIT 1`,
                [idUtilisateur]
            );
            const m = rows[0] || {};
            return {
                nom: m.nom_commercial || m.fullname || null,
                telephone: m.telephone || m.whatsapp || null,
                whatsapp: m.whatsapp || null,
                ville: m.ville || null,
            };
        } catch {
            return { nom: null, telephone: null, whatsapp: null, ville: null };
        }
    }
}

export default RelanceClient;
