// models/Suivi.js
// Données des pages de suivi de la console Super Admin :
// Alertes, Activité, Revenus, Statistiques, Sécurité.
import { pool } from '../config/db.js';
import Abonnement from './Abonnement.js';

const num = (v) => Number(v) || 0;
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Les 12 derniers mois (du plus ancien au plus récent) : [{ cle: '2026-11', label: 'nov. 2026' }] */
function douzeMois() {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 11; i >= 0; i -= 1) {
        const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
        out.push({ cle: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, label: `${MOIS_COURTS[x.getMonth()]} ${String(x.getFullYear()).slice(2)}` });
    }
    return out;
}

/** Magasin principal de chaque patron (nom, ville) */
const MAGASIN_PRINCIPAL = `
    LEFT JOIN magasins m ON m.id_magasin = (
        SELECT MIN(m2.id_magasin) FROM magasins m2 WHERE m2.id_utilisateur = u.id_utilisateur
    )`;

class Suivi {
    // ============================================================
    // ALERTES : ce qui demande une action du Super Admin
    // ============================================================
    static async alertes() {
        const statuts = await Abonnement.statuts();
        const parId = new Map(statuts.map((s) => [s.id_utilisateur, s]));

        const expirent = statuts
            .filter((s) => s.compte_actif && s.jours_restants >= 0 && s.jours_restants <= 7)
            .sort((a, b) => a.jours_restants - b.jours_restants);
        const expires = statuts
            .filter((s) => s.compte_actif && s.statut === 'expire')
            .sort((a, b) => b.jours_restants - a.jours_restants);

        // Patrons qui ne se connectent plus (abonnement encore valable)
        const [inactifsBruts] = await pool.query(
            `SELECT u.id_utilisateur, u.fullname, u.telephone,
                    DATE_FORMAT(u.derniere_connexion, '%Y-%m-%d %H:%i') AS derniere_connexion,
                    DATEDIFF(NOW(), COALESCE(u.derniere_connexion, u.date_creation)) AS jours,
                    m.nom_commercial AS nom_magasin, m.ville
             FROM utilisateurs u ${MAGASIN_PRINCIPAL}
             WHERE u.actif = 1
               AND COALESCE(u.derniere_connexion, u.date_creation) < DATE_SUB(NOW(), INTERVAL 14 DAY)
             ORDER BY jours DESC`
        );
        const inactifs = inactifsBruts
            .filter((r) => parId.get(r.id_utilisateur)?.statut !== 'expire')
            .map((r) => ({ ...r, jours: num(r.jours), statut: parId.get(r.id_utilisateur)?.statut || null }));

        // Comptes bloqués après trop d'essais de code
        const [bloques] = await pool.query(
            `SELECT 'patron' AS type, u.id_utilisateur AS id, u.fullname, u.telephone,
                    m.nom_commercial AS nom_magasin,
                    DATE_FORMAT(u.bloque_jusqua, '%Y-%m-%d %H:%i') AS bloque_jusqua, u.tentatives_echouees
             FROM utilisateurs u ${MAGASIN_PRINCIPAL}
             WHERE u.bloque_jusqua > NOW()
             UNION ALL
             SELECT 'employe' AS type, e.id_employe AS id, e.fullname, e.telephone,
                    (SELECT m3.nom_commercial FROM magasins m3 WHERE m3.id_utilisateur = e.id_utilisateur ORDER BY m3.id_magasin LIMIT 1) AS nom_magasin,
                    DATE_FORMAT(e.bloque_jusqua, '%Y-%m-%d %H:%i') AS bloque_jusqua, e.tentatives_echouees
             FROM employes e
             WHERE e.bloque_jusqua > NOW()
             ORDER BY bloque_jusqua DESC`
        );

        // Magasins sans position sur la carte
        const [sansPosition] = await pool.query(
            `SELECT m.id_magasin, m.nom_commercial, m.ville, m.quartier, u.fullname, u.id_utilisateur
             FROM magasins m JOIN utilisateurs u ON u.id_utilisateur = m.id_utilisateur
             WHERE m.actif = 1 AND (m.latitude IS NULL OR m.longitude IS NULL)
             ORDER BY m.date_creation DESC`
        );

        const garder = (s) => ({
            id_utilisateur: s.id_utilisateur, fullname: s.fullname, telephone: s.telephone,
            nom_magasin: s.nom_magasin, statut: s.statut, en_essai: s.en_essai,
            date_fin: s.date_fin, jours_restants: s.jours_restants, montant_mensuel: s.montant_mensuel,
        });

        return {
            expirent: expirent.map(garder),
            expires: expires.map(garder),
            inactifs,
            bloques: bloques.map((b) => ({ ...b, tentatives_echouees: num(b.tentatives_echouees) })),
            sans_position: sansPosition,
            total: expirent.length + expires.length + inactifs.length + bloques.length,
        };
    }

    /** Nombre affiché sur le menu « Alertes » */
    static async nombreAlertes() {
        const a = await Suivi.alertes();
        return a.total;
    }

    // ============================================================
    // ACTIVITÉ : fil des événements de tous les magasins
    // ============================================================
    static async activite({ type = '', q = '', jours = 7, limite = 50, page = 1, id_utilisateur = null } = {}) {
        const j = Math.min(Math.max(parseInt(jours, 10) || 7, 1), 365);
        const lim = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200);
        const off = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
        const like = q ? `%${q}%` : null;
        // Un seul patron (fiche patron)
        const idp = parseInt(id_utilisateur, 10) > 0 ? parseInt(id_utilisateur, 10) : null;
        const sur = (col) => (idp ? ` AND ${col} = ${idp}` : '');

        // 1. Journal des magasins (ventes, paiements, créations, suppressions, connexions…)
        // 2. Inscriptions de patrons   3. Paiements d'abonnement
        const morceaux = [];
        const params = [];
        const veut = (t) => !type || type === t;
        const filtreJournal = {
            ventes: "j.module IN ('ventes','factures','caisse','paiements','reglements') OR j.action IN ('paiement','cloture','ouverture')",
            connexions: "j.action = 'connexion'",
            suppressions: "j.action IN ('suppression','annulation')",
            stock: "j.module IN ('produits','stock','entrees','sorties','inventaires','transferts','entrepot','achats','receptions')",
        };
        // Même encodage pour les trois sources (sinon la base refuse de les combiner)
        const T = (x) => `CONVERT(${x} USING utf8mb4) COLLATE utf8mb4_general_ci`;
        const colonnes = (c) => `
            ${T(c.source)} AS source, ${T(c.action)} AS action, ${T(c.module)} AS module, ${T(c.libelle)} AS libelle,
            ${T(c.reference)} AS reference, ${T(c.acteur_nom)} AS acteur_nom, ${T(c.acteur_role)} AS acteur_role,
            ${T(c.acteur_type)} AS acteur_type, u.id_utilisateur, ${T('u.fullname')} AS patron,
            ${T('m.nom_commercial')} AS nom_magasin, ${T('m.ville')} AS ville, ${c.montant} AS montant, ${c.date} AS date_action`;
        if (!type || filtreJournal[type] || type === 'autres') {
            const cond = filtreJournal[type] ? `AND (${filtreJournal[type]})` : '';
            morceaux.push(`
                SELECT ${colonnes({ source: "'journal'", action: 'j.action', module: 'j.module', libelle: 'j.libelle', reference: 'j.reference',
                                    acteur_nom: 'j.acteur_nom', acteur_role: 'j.acteur_role', acteur_type: 'j.acteur_type', montant: 'NULL', date: 'j.date_action' })}
                FROM journal_activite j
                JOIN utilisateurs u ON u.id_utilisateur = j.id_utilisateur ${MAGASIN_PRINCIPAL}
                WHERE j.date_action >= DATE_SUB(NOW(), INTERVAL ? DAY) ${cond}${sur('j.id_utilisateur')}
                ${like ? 'AND (j.libelle LIKE ? OR u.fullname LIKE ? OR m.nom_commercial LIKE ? OR j.acteur_nom LIKE ?)' : ''}`);
            params.push(j);
            if (like) params.push(like, like, like, like);
        }
        if (veut('inscriptions')) {
            morceaux.push(`
                SELECT ${colonnes({ source: "'inscription'", action: "'inscription'", module: "'comptes'", libelle: "'Nouveau patron inscrit'", reference: 'NULL',
                                    acteur_nom: 'u.fullname', acteur_role: "'patron'", acteur_type: "'utilisateur'", montant: 'NULL', date: 'u.date_creation' })}
                FROM utilisateurs u ${MAGASIN_PRINCIPAL}
                WHERE u.date_creation >= DATE_SUB(NOW(), INTERVAL ? DAY)${sur('u.id_utilisateur')}
                ${like ? 'AND (u.fullname LIKE ? OR m.nom_commercial LIKE ?)' : ''}`);
            params.push(j);
            if (like) params.push(like, like);
        }
        if (veut('abonnements')) {
            morceaux.push(`
                SELECT ${colonnes({ source: "'abonnement'", action: "'abonnement'", module: "'abonnements'",
                                    libelle: "CONCAT('Abonnement payé : ', a.nb_mois, ' mois')", reference: 'a.reference',
                                    acteur_nom: "COALESCE(sa.fullname, 'Super Admin')", acteur_role: "'super admin'", acteur_type: "'super_admin'",
                                    montant: 'a.montant', date: 'a.date_creation' })}
                FROM abonnements a
                JOIN utilisateurs u ON u.id_utilisateur = a.id_utilisateur ${MAGASIN_PRINCIPAL}
                LEFT JOIN super_admins sa ON sa.id_super_admin = a.id_super_admin
                WHERE a.date_creation >= DATE_SUB(NOW(), INTERVAL ? DAY)${sur('a.id_utilisateur')}
                ${like ? 'AND (u.fullname LIKE ? OR m.nom_commercial LIKE ?)' : ''}`);
            params.push(j);
            if (like) params.push(like, like);
        }
        if (morceaux.length === 0) return { total: 0, evenements: [], resume: {} };

        const union = morceaux.join(' UNION ALL ');
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${union}) t`, params);
        const [evenements] = await pool.query(
            `SELECT t.*, DATE_FORMAT(t.date_action, '%Y-%m-%d %H:%i:%s') AS date_action
             FROM (${union}) t ORDER BY t.date_action DESC LIMIT ${lim} OFFSET ${off}`,
            params
        );

        // Résumé de la période (sans recherche ni filtre de type)
        const [[resume]] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM journal_activite WHERE date_action >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS actions,
                (SELECT COUNT(DISTINCT id_utilisateur) FROM journal_activite WHERE date_action >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS magasins_actifs,
                (SELECT COUNT(*) FROM utilisateurs WHERE date_creation >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS inscriptions,
                (SELECT COUNT(*) FROM abonnements WHERE date_creation >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS paiements`,
            [j, j, j, j]
        );
        return {
            total: num(total),
            evenements: evenements.map((e) => ({ ...e, montant: e.montant == null ? null : num(e.montant) })),
            resume: Object.fromEntries(Object.entries(resume).map(([k, v]) => [k, num(v)])),
        };
    }

    // ============================================================
    // REVENUS : argent des abonnements
    // ============================================================
    static async revenus() {
        const mois = douzeMois();
        const [parMois] = await pool.query(
            `SELECT DATE_FORMAT(date_creation, '%Y-%m') AS cle, SUM(montant) AS total, COUNT(*) AS nb
             FROM abonnements
             WHERE date_creation >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)
             GROUP BY cle`
        );
        const idx = new Map(parMois.map((r) => [r.cle, r]));
        const serie = mois.map((m) => ({ ...m, total: num(idx.get(m.cle)?.total), nb: num(idx.get(m.cle)?.nb) }));

        const [[t]] = await pool.query(
            `SELECT
                SUM(CASE WHEN DATE_FORMAT(date_creation, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') THEN montant ELSE 0 END) AS ce_mois,
                SUM(CASE WHEN DATE_FORMAT(date_creation, '%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m') THEN montant ELSE 0 END) AS mois_dernier,
                SUM(CASE WHEN YEAR(date_creation) = YEAR(NOW()) THEN montant ELSE 0 END) AS cette_annee,
                SUM(montant) AS depuis_debut,
                COUNT(*) AS nb_paiements
             FROM abonnements`
        );

        const [parMoyen] = await pool.query(
            `SELECT COALESCE(NULLIF(moyen_paiement, ''), 'autre') AS moyen, SUM(montant) AS total, COUNT(*) AS nb
             FROM abonnements WHERE YEAR(date_creation) = YEAR(NOW())
             GROUP BY moyen ORDER BY total DESC`
        );

        const [derniers] = await pool.query(
            `SELECT a.id_abonnement, a.montant, a.nb_mois, a.moyen_paiement, a.reference,
                    DATE_FORMAT(a.date_creation, '%Y-%m-%d %H:%i') AS date_paiement,
                    DATE_FORMAT(a.date_debut, '%Y-%m-%d') AS date_debut, DATE_FORMAT(a.date_fin, '%Y-%m-%d') AS date_fin,
                    u.id_utilisateur, u.fullname, m.nom_commercial AS nom_magasin,
                    sa.fullname AS enregistre_par
             FROM abonnements a
             JOIN utilisateurs u ON u.id_utilisateur = a.id_utilisateur ${MAGASIN_PRINCIPAL}
             LEFT JOIN super_admins sa ON sa.id_super_admin = a.id_super_admin
             ORDER BY a.date_creation DESC, a.id_abonnement DESC LIMIT 25`
        );

        // Revenu mensuel attendu (abonnés payants) et renouvellements des 30 prochains jours
        const statuts = await Abonnement.statuts();
        const payants = statuts.filter((s) => s.statut === 'actif');
        const aRenouveler = statuts.filter((s) => s.compte_actif && s.jours_restants >= 0 && s.jours_restants <= 30);
        const essais = statuts.filter((s) => s.statut === 'essai');

        return {
            serie,
            totaux: {
                ce_mois: num(t.ce_mois),
                mois_dernier: num(t.mois_dernier),
                cette_annee: num(t.cette_annee),
                depuis_debut: num(t.depuis_debut),
                nb_paiements: num(t.nb_paiements),
                revenu_mensuel: payants.reduce((s, a) => s + num(a.montant_mensuel), 0),
                nb_payants: payants.length,
                a_renouveler: aRenouveler.reduce((s, a) => s + num(a.montant_mensuel), 0),
                nb_a_renouveler: aRenouveler.length,
                potentiel_essais: essais.reduce((s, a) => s + num(a.montant_mensuel), 0),
                nb_essais: essais.length,
            },
            par_moyen: parMoyen.map((r) => ({ moyen: r.moyen, total: num(r.total), nb: num(r.nb) })),
            derniers: derniers.map((d) => ({ ...d, montant: num(d.montant) })),
        };
    }

    // ============================================================
    // APERÇU : activité des 30 derniers jours (vue d'ensemble)
    // ============================================================
    static async apercu() {
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const cases = [];
        for (let i = 29; i >= 0; i -= 1) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            cases.push({ cle: iso(d), label: `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}` });
        }
        const [act] = await pool.query(
            `SELECT DATE_FORMAT(date_action, '%Y-%m-%d') AS cle, COUNT(*) AS actions, COUNT(DISTINCT id_utilisateur) AS magasins
             FROM journal_activite WHERE date_action >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) GROUP BY cle`);
        const [ven] = await pool.query(
            `SELECT DATE_FORMAT(date_commande, '%Y-%m-%d') AS cle, COUNT(*) AS ventes, COALESCE(SUM(montant_total), 0) AS chiffre
             FROM commandes_vente WHERE date_commande >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
               AND (statut IS NULL OR statut NOT IN ('annulee', 'annulée')) GROUP BY cle`);
        const [heures] = await pool.query(
            `SELECT HOUR(date_creation) AS h, COUNT(*) AS n FROM commandes_vente
             WHERE date_creation >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND (statut IS NULL OR statut NOT IN ('annulee', 'annulée'))
             GROUP BY h`);
        const [[gps]] = await pool.query(
            `SELECT COUNT(*) AS total, SUM(latitude IS NOT NULL AND longitude IS NOT NULL) AS geo FROM magasins WHERE actif = 1`);
        const iA = new Map(act.map((r) => [r.cle, r]));
        const iV = new Map(ven.map((r) => [r.cle, r]));
        const iH = new Map(heures.map((r) => [num(r.h), num(r.n)]));
        const a = await Suivi.alertes();
        return {
            jours: cases.map((k) => ({
                ...k,
                actions: num(iA.get(k.cle)?.actions),
                magasins: num(iA.get(k.cle)?.magasins),
                ventes: num(iV.get(k.cle)?.ventes),
                chiffre: num(iV.get(k.cle)?.chiffre),
            })),
            heures: Array.from({ length: 24 }, (_, h) => ({ cle: h, label: `${h} h`, ventes: iH.get(h) || 0 })),
            gps: { total: num(gps.total), geo: num(gps.geo) },
            alertes: {
                expirent: a.expirent.length, expires: a.expires.length, inactifs: a.inactifs.length,
                bloques: a.bloques.length, sans_position: a.sans_position.length, total: a.total,
            },
        };
    }

    // ============================================================
    // RAPPORT : tout ce qui s'est passé entre deux dates
    // ============================================================
    static async rapport({ du, au } = {}) {
        const jour = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const auj = new Date();
        let fin = jour(au) || iso(auj);
        let debut = jour(du) || `${fin.slice(0, 8)}01`;
        if (debut > fin) [debut, fin] = [fin, debut];
        const dDebut = new Date(`${debut}T00:00:00`);
        const dFin = new Date(`${fin}T00:00:00`);
        const nbJours = Math.round((dFin - dDebut) / 86400000) + 1;
        if (nbJours > 731) { dDebut.setTime(dFin.getTime() - 730 * 86400000); debut = iso(dDebut); }
        const jours = Math.round((dFin - dDebut) / 86400000) + 1;
        const pas = jours <= 62 ? 'jour' : 'mois';
        const fmtCle = pas === 'jour' ? '%Y-%m-%d' : '%Y-%m';
        const borne = 'BETWEEN ? AND ?';
        const bornes = [`${debut} 00:00:00`, `${fin} 23:59:59`];

        // Cases de la courbe
        const cases = [];
        const c = new Date(dDebut);
        if (pas === 'mois') c.setDate(1);
        while (c <= dFin) {
            if (pas === 'jour') {
                cases.push({ cle: iso(c), label: `${c.getDate()} ${MOIS_COURTS[c.getMonth()]}` });
                c.setDate(c.getDate() + 1);
            } else {
                cases.push({ cle: iso(c).slice(0, 7), label: `${MOIS_COURTS[c.getMonth()]} ${String(c.getFullYear()).slice(2)}` });
                c.setMonth(c.getMonth() + 1);
            }
        }

        const [enc] = await pool.query(
            `SELECT DATE_FORMAT(date_creation, '${fmtCle}') AS cle, SUM(montant) AS total, COUNT(*) AS nb
             FROM abonnements WHERE date_creation ${borne} GROUP BY cle`, bornes);
        const [ins] = await pool.query(
            `SELECT DATE_FORMAT(date_creation, '${fmtCle}') AS cle, COUNT(*) AS nb
             FROM utilisateurs WHERE date_creation ${borne} GROUP BY cle`, bornes);
        const [ven] = await pool.query(
            `SELECT DATE_FORMAT(date_commande, '${fmtCle}') AS cle, COUNT(*) AS nb, SUM(montant_total) AS chiffre
             FROM commandes_vente WHERE date_commande ${borne} AND (statut IS NULL OR statut NOT IN ('annulee', 'annulée'))
             GROUP BY cle`, bornes);
        const idx = (rows) => new Map(rows.map((r) => [r.cle, r]));
        const iE = idx(enc), iI = idx(ins), iV = idx(ven);
        const serie = cases.map((k) => ({
            ...k,
            encaisse: num(iE.get(k.cle)?.total),
            paiements: num(iE.get(k.cle)?.nb),
            inscriptions: num(iI.get(k.cle)?.nb),
            ventes: num(iV.get(k.cle)?.nb),
            chiffre: num(iV.get(k.cle)?.chiffre),
        }));

        // Même durée juste avant, pour comparer
        const pFin = new Date(dDebut.getTime() - 86400000);
        const pDebut = new Date(pFin.getTime() - (jours - 1) * 86400000);
        const avant = [`${iso(pDebut)} 00:00:00`, `${iso(pFin)} 23:59:59`];
        const [[prec]] = await pool.query(
            `SELECT
                (SELECT COALESCE(SUM(montant), 0) FROM abonnements WHERE date_creation ${borne}) AS encaisse,
                (SELECT COUNT(*) FROM utilisateurs WHERE date_creation ${borne}) AS inscriptions,
                (SELECT COUNT(*) FROM commandes_vente WHERE date_commande ${borne} AND (statut IS NULL OR statut NOT IN ('annulee', 'annulée'))) AS ventes`,
            [...avant, ...avant, ...avant]);
        const [[actifs]] = await pool.query(
            `SELECT COUNT(DISTINCT id_utilisateur) AS n FROM journal_activite WHERE date_action ${borne}`, bornes);

        const [parMoyen] = await pool.query(
            `SELECT COALESCE(NULLIF(moyen_paiement, ''), 'autre') AS moyen, SUM(montant) AS total, COUNT(*) AS nb
             FROM abonnements WHERE date_creation ${borne} GROUP BY moyen ORDER BY total DESC`, bornes);

        const [paiements] = await pool.query(
            `SELECT a.id_abonnement, u.id_utilisateur, u.fullname, u.telephone, m.nom_commercial AS nom_magasin, m.ville,
                    a.montant, a.nb_mois, a.moyen_paiement, a.reference,
                    DATE_FORMAT(a.date_debut, '%Y-%m-%d') AS date_debut, DATE_FORMAT(a.date_fin, '%Y-%m-%d') AS date_fin,
                    DATE_FORMAT(a.date_creation, '%Y-%m-%d %H:%i:%s') AS date_creation
             FROM abonnements a JOIN utilisateurs u ON u.id_utilisateur = a.id_utilisateur ${MAGASIN_PRINCIPAL}
             WHERE a.date_creation ${borne} ORDER BY a.date_creation DESC LIMIT 1000`, bornes);
        const [inscrits] = await pool.query(
            `SELECT u.id_utilisateur, u.fullname, u.email, u.telephone, u.actif, m.nom_commercial AS nom_magasin, m.ville, m.pays,
                    DATE_FORMAT(u.date_creation, '%Y-%m-%d %H:%i:%s') AS date_creation,
                    DATE_FORMAT(u.derniere_connexion, '%Y-%m-%d %H:%i:%s') AS derniere_connexion
             FROM utilisateurs u ${MAGASIN_PRINCIPAL}
             WHERE u.date_creation ${borne} ORDER BY u.date_creation DESC LIMIT 1000`, bornes);

        const somme = (k) => serie.reduce((t, x) => t + x[k], 0);
        return {
            periode: { du: debut, au: fin, jours, pas, precedente: { du: iso(pDebut), au: iso(pFin) } },
            resume: {
                encaisse: somme('encaisse'),
                nb_paiements: somme('paiements'),
                inscriptions: somme('inscriptions'),
                ventes: somme('ventes'),
                chiffre_magasins: somme('chiffre'),
                magasins_actifs: num(actifs.n),
                precedent: { encaisse: num(prec.encaisse), inscriptions: num(prec.inscriptions), ventes: num(prec.ventes) },
            },
            serie,
            par_moyen: parMoyen.map((r) => ({ moyen: r.moyen, total: num(r.total), nb: num(r.nb) })),
            paiements: paiements.map((r) => ({ ...r, montant: num(r.montant), nb_mois: num(r.nb_mois) })),
            inscrits: inscrits.map((r) => ({ ...r, actif: !!r.actif })),
        };
    }

    // ============================================================
    // STATISTIQUES : croissance et usage de Miyo
    // ============================================================
    static async statistiques() {
        const mois = douzeMois();
        const depuis = "DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)";
        const serieDe = (rows, champs) => {
            const idx = new Map(rows.map((r) => [r.cle, r]));
            return mois.map((m) => ({ ...m, ...Object.fromEntries(champs.map((c) => [c, num(idx.get(m.cle)?.[c])])) }));
        };

        const [inscr] = await pool.query(
            `SELECT DATE_FORMAT(date_creation, '%Y-%m') AS cle, COUNT(*) AS patrons FROM utilisateurs
             WHERE date_creation >= ${depuis} GROUP BY cle`
        );
        const [ventes] = await pool.query(
            `SELECT DATE_FORMAT(date_commande, '%Y-%m') AS cle, COUNT(*) AS ventes, SUM(montant_total) AS chiffre,
                    COUNT(DISTINCT id_utilisateur) AS magasins
             FROM commandes_vente
             WHERE date_commande >= ${depuis} AND (statut IS NULL OR statut NOT IN ('annulee', 'annulée'))
             GROUP BY cle`
        );

        const [[totaux]] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM utilisateurs) AS patrons,
                (SELECT COUNT(*) FROM utilisateurs WHERE actif = 1) AS patrons_actifs,
                (SELECT COUNT(*) FROM magasins) AS magasins,
                (SELECT COUNT(*) FROM employes) AS employes,
                (SELECT COUNT(*) FROM produits) AS produits,
                (SELECT COUNT(*) FROM entrepots) AS entrepots,
                (SELECT COUNT(*) FROM commandes_vente) AS ventes,
                (SELECT COUNT(DISTINCT id_utilisateur) FROM journal_activite WHERE date_action >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS actifs_7j,
                (SELECT COUNT(DISTINCT id_utilisateur) FROM journal_activite WHERE date_action >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS actifs_30j`
        );

        const [villes] = await pool.query(
            `SELECT COALESCE(NULLIF(TRIM(ville), ''), 'Non renseignée') AS ville, COUNT(*) AS n
             FROM magasins GROUP BY ville ORDER BY n DESC LIMIT 10`
        );

        const statuts = await Abonnement.statuts();
        const compte = (f) => statuts.filter(f).length;
        const avecPaiement = compte((s) => s.nb_paiements > 0);

        const [topMagasins] = await pool.query(
            `SELECT u.id_utilisateur, u.fullname, m.nom_commercial AS nom_magasin, m.ville,
                    COUNT(cv.id_commande) AS ventes, COALESCE(SUM(cv.montant_total), 0) AS chiffre
             FROM utilisateurs u ${MAGASIN_PRINCIPAL}
             JOIN commandes_vente cv ON cv.id_utilisateur = u.id_utilisateur
                 AND cv.date_commande >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY u.id_utilisateur, u.fullname, m.nom_commercial, m.ville
             ORDER BY ventes DESC LIMIT 10`
        );

        return {
            totaux: Object.fromEntries(Object.entries(totaux).map(([k, v]) => [k, num(v)])),
            abonnements: {
                actifs: compte((s) => s.statut === 'actif'),
                essai: compte((s) => s.statut === 'essai'),
                expires: compte((s) => s.statut === 'expire'),
                taux_conversion: statuts.length ? Math.round((avecPaiement / statuts.length) * 100) : 0,
                avec_paiement: avecPaiement,
            },
            inscriptions: serieDe(inscr, ['patrons']),
            ventes: serieDe(ventes, ['ventes', 'chiffre', 'magasins']),
            villes: villes.map((v) => ({ ville: v.ville, n: num(v.n) })),
            top_magasins: topMagasins.map((t) => ({ ...t, ventes: num(t.ventes), chiffre: num(t.chiffre) })),
        };
    }

    // ============================================================
    // SÉCURITÉ
    // ============================================================
    static async securite() {
        const [admins] = await pool.query(
            `SELECT id_super_admin, fullname, email, telephone, actif, tentatives_echouees,
                    DATE_FORMAT(bloque_jusqua, '%Y-%m-%d %H:%i') AS bloque_jusqua,
                    DATE_FORMAT(derniere_connexion, '%Y-%m-%d %H:%i') AS derniere_connexion, derniere_ip
             FROM super_admins ORDER BY fullname`
        );
        const [risques] = await pool.query(
            `SELECT 'patron' AS type, u.id_utilisateur AS id, u.fullname, u.telephone,
                    m.nom_commercial AS nom_magasin, u.tentatives_echouees,
                    DATE_FORMAT(u.bloque_jusqua, '%Y-%m-%d %H:%i') AS bloque_jusqua, (u.bloque_jusqua > NOW()) AS bloque
             FROM utilisateurs u ${MAGASIN_PRINCIPAL}
             WHERE u.tentatives_echouees > 0 OR u.bloque_jusqua > NOW()
             UNION ALL
             SELECT 'employe' AS type, e.id_employe AS id, e.fullname, e.telephone,
                    (SELECT m3.nom_commercial FROM magasins m3 WHERE m3.id_utilisateur = e.id_utilisateur ORDER BY m3.id_magasin LIMIT 1) AS nom_magasin,
                    e.tentatives_echouees,
                    DATE_FORMAT(e.bloque_jusqua, '%Y-%m-%d %H:%i') AS bloque_jusqua, (e.bloque_jusqua > NOW()) AS bloque
             FROM employes e
             WHERE e.tentatives_echouees > 0 OR e.bloque_jusqua > NOW()
             ORDER BY bloque DESC, tentatives_echouees DESC`
        );
        const [connexionsConsole] = await pool.query(
            `SELECT action, libelle, acteur_nom, ip, user_agent, DATE_FORMAT(date_action, '%Y-%m-%d %H:%i:%s') AS date_action
             FROM journal_super_admin
             WHERE action IN ('connexion', 'echec_connexion', 'blocage')
             ORDER BY date_action DESC LIMIT 30`
        );
        const [[echecs]] = await pool.query(
            `SELECT COUNT(*) AS n FROM journal_super_admin
             WHERE action IN ('echec_connexion', 'blocage') AND date_action >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );
        const [connexionsMagasins] = await pool.query(
            `SELECT j.acteur_nom, j.acteur_role, j.ip, u.fullname AS patron, m.nom_commercial AS nom_magasin,
                    DATE_FORMAT(j.date_action, '%Y-%m-%d %H:%i:%s') AS date_action
             FROM journal_activite j
             JOIN utilisateurs u ON u.id_utilisateur = j.id_utilisateur ${MAGASIN_PRINCIPAL}
             WHERE j.action = 'connexion'
             ORDER BY j.date_action DESC LIMIT 30`
        );
        return {
            admins: admins.map((a) => ({ ...a, actif: !!a.actif, tentatives_echouees: num(a.tentatives_echouees) })),
            risques: risques.map((r) => ({ ...r, bloque: !!r.bloque, tentatives_echouees: num(r.tentatives_echouees) })),
            connexions_console: connexionsConsole,
            echecs_7j: num(echecs.n),
            connexions_magasins: connexionsMagasins,
        };
    }

    /** Débloque un compte (patron ou employé) : remet les essais à zéro */
    static async debloquer(type, id) {
        const table = type === 'employe' ? 'employes' : 'utilisateurs';
        const cle = type === 'employe' ? 'id_employe' : 'id_utilisateur';
        const [r] = await pool.query(`UPDATE ${table} SET tentatives_echouees = 0, bloque_jusqua = NULL WHERE ${cle} = ?`, [id]);
        return r.affectedRows > 0;
    }
}

export default Suivi;
