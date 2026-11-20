// Services/notificationsPush.js
//
// Notifications push vers l'application téléphone Miyo (service gratuit d'Expo).
//
// Ce qui est envoyé (au patron uniquement, sur chaque téléphone où il est connecté) :
//   1. Stock bas / rupture : dès qu'un produit passe sous son minimum (vérifié toutes les 10 min).
//      Un produit n'est signalé qu'une fois ; il le sera de nouveau après être remonté au-dessus du minimum.
//   2. Résumé du jour : chaque soir à partir de 20 h (heure d'Abidjan).
//   3. Abonnement : 3 jours avant la fin, la veille, le jour même et le lendemain de l'expiration.
//   4. Nouvelle vente : dès qu'une vente est enregistrée (ordinateur, téléphone d'un employé…).
//      Le téléphone qui a fait la vente n'est pas prévenu (il a déjà sa confirmation).
//
// Chaque envoi est noté dans push_envois (clé unique) : rien n'est envoyé deux fois,
// même si le serveur redémarre ou tourne en plusieurs exemplaires.
import https from 'https';
import { pool } from '../config/db.js';
import Abonnement from '../models/Abonnement.js';

const URL_EXPO = 'https://exp.host/--/api/v2/push/send';
const INTERVALLE_MS = 10 * 60 * 1000;   // 10 minutes
const HEURE_RESUME = 20;                // 20 h (Abidjan = UTC)
const HEURE_ABONNEMENT = 9;             // 9 h
const MAX_NOMS = 3;

const jourISO = (d = new Date()) => d.toISOString().slice(0, 10);
const num = (v) => parseFloat(v) || 0;
const qte = (v) => {
    const n = num(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
};
const fcfa = (v) => `${Math.round(num(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const dateFr = (iso) => {
    const [a, m, j] = String(iso).split('-');
    return `${j}/${m}/${a}`;
};

/* ============================================================
   ENVOI VERS EXPO
   ============================================================ */
function posterExpo(messages) {
    return new Promise((resolve, reject) => {
        const corps = JSON.stringify(messages);
        const req = https.request(URL_EXPO, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'Accept-Encoding': 'identity',
                'Content-Length': Buffer.byteLength(corps),
            },
            timeout: 15000,
        }, (res) => {
            let txt = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { txt += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(txt)); } catch { reject(new Error(`Réponse Expo illisible (${res.statusCode})`)); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('Expo ne répond pas')));
        req.on('error', reject);
        req.write(corps);
        req.end();
    });
}

/** Envoie un message à une liste de jetons. Les jetons refusés par Expo sont désactivés. */
export async function envoyer(jetons, { titre, texte, donnees = {} }) {
    const liste = [...new Set(jetons)].filter((j) => /^(Exponent|Expo)PushToken\[.+\]$/.test(j));
    if (!liste.length) return { envoyes: 0 };
    let envoyes = 0;
    for (let i = 0; i < liste.length; i += 100) {
        const lot = liste.slice(i, i + 100);
        const messages = lot.map((to) => ({
            to, title: titre, body: texte, data: donnees,
            sound: 'default', priority: 'high', channelId: 'miyo',
        }));
        try {
            const rep = await posterExpo(messages);
            const tickets = Array.isArray(rep?.data) ? rep.data : [];
            const morts = [];
            tickets.forEach((t, k) => {
                if (t?.status === 'ok') envoyes += 1;
                else if (t?.details?.error === 'DeviceNotRegistered') morts.push(lot[k]);
            });
            if (morts.length) {
                await pool.query('UPDATE appareils_push SET actif = 0 WHERE jeton IN (?)', [morts]);
            }
            if (rep?.errors?.length) console.warn('⚠️ [Push] Expo :', rep.errors.map((e) => e.message).join(' | '));
        } catch (e) {
            console.warn('⚠️ [Push] envoi impossible :', e.message);
        }
    }
    return { envoyes };
}

/** Jetons actifs des téléphones du patron d'une boutique. */
async function jetonsPatron(id_utilisateur) {
    const [rows] = await pool.query(
        `SELECT jeton FROM appareils_push
          WHERE id_utilisateur = ? AND type_compte = 'utilisateur' AND actif = 1`,
        [id_utilisateur]
    );
    return rows.map((r) => r.jeton);
}

/** Envoie au patron ; renvoie le nombre de téléphones atteints. */
export async function envoyerAuPatron(id_utilisateur, message, jetonExclu = null) {
    const jetons = (await jetonsPatron(id_utilisateur)).filter((j) => j !== jetonExclu);
    if (!jetons.length) return 0;
    const { envoyes } = await envoyer(jetons, message);
    return envoyes;
}

/** Réserve une clé d'envoi ; vrai seulement la première fois (anti-doublon). */
async function reserver(id_utilisateur, cle) {
    const [r] = await pool.query('INSERT IGNORE INTO push_envois (id_utilisateur, cle) VALUES (?, ?)', [id_utilisateur, cle]);
    return r.affectedRows === 1;
}

/** Boutiques dont le patron a au moins un téléphone enregistré. */
async function boutiquesAvecTelephone() {
    const [rows] = await pool.query(
        `SELECT DISTINCT a.id_utilisateur
           FROM appareils_push a
           JOIN utilisateurs u ON u.id_utilisateur = a.id_utilisateur AND u.actif = 1
          WHERE a.type_compte = 'utilisateur' AND a.actif = 1`
    );
    return rows.map((r) => r.id_utilisateur);
}

/* ============================================================
   1. STOCK BAS / RUPTURE
   ============================================================ */
export async function verifierStock(id_utilisateur) {
    const [bas] = await pool.query(
        `SELECT id_produit, nom, quantite_stock, quantite_minimale,
                (quantite_stock <= 0 AND date_creation >= NOW() - INTERVAL 30 MINUTE) AS ne_a_zero
           FROM produits
          WHERE id_utilisateur = ?
            AND (quantite_stock <= 0 OR quantite_stock <= quantite_minimale)
          ORDER BY quantite_stock ASC, nom ASC`,
        [id_utilisateur]
    );
    const [dejaRows] = await pool.query(
        `SELECT cle FROM push_envois WHERE id_utilisateur = ? AND (cle LIKE 'stock:%' OR cle = 'stock_init')`,
        [id_utilisateur]
    );
    const deja = new Set(dejaRows.map((r) => r.cle));
    const cleDe = (p) => `stock:${p.id_produit}`;
    const actuels = new Set(bas.map(cleDe));

    // Produits remontés au-dessus du minimum : ils pourront être signalés de nouveau
    const remontes = [...deja].filter((c) => c.startsWith('stock:') && !actuels.has(c));
    if (remontes.length) {
        await pool.query('DELETE FROM push_envois WHERE id_utilisateur = ? AND cle IN (?)', [id_utilisateur, remontes]);
    }

    // Première vérification de cette boutique : on note l'état sans rien envoyer
    // (sinon le patron recevrait d'un coup tous les produits déjà en alerte)
    if (!deja.has('stock_init')) {
        const valeurs = [...bas.map((p) => [id_utilisateur, cleDe(p)]), [id_utilisateur, 'stock_init']];
        await pool.query('INSERT IGNORE INTO push_envois (id_utilisateur, cle) VALUES ?', [valeurs]);
        return 0;
    }

    const nouveaux = [];
    for (const p of bas) {
        if (deja.has(cleDe(p))) continue;
        // Produit tout juste créé sans stock : ce n'est pas une rupture, on le note sans prévenir
        if (Number(p.ne_a_zero)) { await reserver(id_utilisateur, cleDe(p)); continue; }
        if (await reserver(id_utilisateur, cleDe(p))) nouveaux.push(p);
    }
    if (!nouveaux.length) return 0;

    let titre;
    let texte;
    if (nouveaux.length === 1) {
        const p = nouveaux[0];
        if (num(p.quantite_stock) <= 0) {
            titre = 'Rupture de stock';
            texte = `${p.nom} : stock épuisé.`;
        } else {
            titre = 'Stock bas';
            texte = `${p.nom} : plus que ${qte(p.quantite_stock)} (minimum ${qte(p.quantite_minimale)}).`;
        }
    } else {
        const ruptures = nouveaux.filter((p) => num(p.quantite_stock) <= 0).length;
        const noms = nouveaux.slice(0, MAX_NOMS).map((p) => p.nom).join(', ');
        const reste = nouveaux.length - MAX_NOMS;
        titre = `${nouveaux.length} produits à commander`;
        texte = `${noms}${reste > 0 ? ` et ${reste} autre${reste > 1 ? 's' : ''}` : ''}.`
            + (ruptures ? ` Dont ${ruptures} en rupture.` : '');
    }
    return envoyerAuPatron(id_utilisateur, { titre, texte, donnees: { ecran: '/(tabs)/alertes', type: 'stock' } });
}

/* ============================================================
   2. RÉSUMÉ DU JOUR
   ============================================================ */
export async function calculerResume(id_utilisateur, jour = jourISO()) {
    const debut = `${jour} 00:00:00`;
    const [[v]] = await pool.query(
        `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS total
           FROM commandes_vente
          WHERE id_utilisateur = ? AND date_commande = ? AND statut <> 'annulee'`,
        [id_utilisateur, jour]
    );
    const [[p]] = await pool.query(
        `SELECT COALESCE(SUM(montant), 0) AS encaisse
           FROM paiements
          WHERE id_utilisateur = ? AND date_creation >= ? AND montant > 0 AND mode_paiement <> 'avoir'`,
        [id_utilisateur, debut]
    );
    const [[d]] = await pool.query(
        'SELECT COALESCE(SUM(montant), 0) AS total FROM depenses WHERE id_utilisateur = ? AND date_creation >= ?',
        [id_utilisateur, debut]
    );
    return { nb_ventes: Number(v.nb) || 0, total_ventes: num(v.total), encaisse: num(p.encaisse), depenses: num(d.total) };
}

export async function envoyerResume(id_utilisateur, jour = jourISO(), forcer = false) {
    if (!forcer && !(await reserver(id_utilisateur, `resume:${jour}`))) return 0;
    const r = await calculerResume(id_utilisateur, jour);
    let texte;
    if (!r.nb_ventes && !r.encaisse) {
        texte = "Aucune vente enregistrée aujourd'hui.";
    } else {
        texte = `${r.nb_ventes} vente${r.nb_ventes > 1 ? 's' : ''} pour ${fcfa(r.total_ventes)}. Encaissé : ${fcfa(r.encaisse)}.`;
    }
    if (r.depenses > 0) texte += ` Dépenses : ${fcfa(r.depenses)}.`;
    return envoyerAuPatron(id_utilisateur, { titre: 'Résumé du jour', texte, donnees: { ecran: '/(tabs)/rapports', type: 'resume' } });
}

/* ============================================================
   3. FIN D'ABONNEMENT
   ============================================================ */
export async function verifierAbonnement(id_utilisateur) {
    const [s] = await Abonnement.statuts(id_utilisateur);
    if (!s || !s.compte_actif) return 0;
    const j = s.jours_restants;
    if (![3, 1, 0, -1].includes(j)) return 0;
    if (!(await reserver(id_utilisateur, `abo:${s.date_fin}:${j}`))) return 0;

    const quoi = s.en_essai ? "Votre période d'essai Miyo" : 'Votre abonnement Miyo';
    let titre = s.en_essai ? "Fin de l'essai" : "Fin de l'abonnement";
    let texte;
    if (j === 3) texte = `${quoi} se termine dans 3 jours (le ${dateFr(s.date_fin)}). Pensez à le renouveler.`;
    else if (j === 1) texte = `${quoi} se termine demain. Pensez à le renouveler.`;
    else if (j === 0) texte = `${quoi} se termine aujourd'hui. Renouvelez-le pour continuer sans interruption.`;
    else {
        titre = s.en_essai ? 'Essai terminé' : 'Abonnement expiré';
        texte = `${quoi} a expiré hier. Renouvelez-le pour continuer à utiliser Miyo.`;
    }
    return envoyerAuPatron(id_utilisateur, { titre, texte, donnees: { ecran: '/abonnement', type: 'abonnement' } });
}

/* ============================================================
   4. NOUVELLE VENTE
   ============================================================ */
/** Appelé après la création d'une vente ; ne bloque jamais la vente. */
export function notifierVente(id_utilisateur, vente, { vendeur = null, jetonExclu = null } = {}) {
    if (!vente) return;
    const montant = num(vente.montant_total ?? vente.montant_facture);
    const client = vente.nomclient ? ` · ${vente.nomclient}` : '';
    const par = vendeur ? ` · par ${vendeur}` : '';
    envoyerAuPatron(
        id_utilisateur,
        {
            titre: 'Nouvelle vente',
            texte: `${vente.numero_commande || 'Vente'} : ${fcfa(montant)}${client}${par}.`,
            donnees: { ecran: vente.id_commande ? `/(tabs)/ventes?vente=${vente.id_commande}` : '/(tabs)/ventes', type: 'vente' },
        },
        jetonExclu
    ).catch((e) => console.warn('⚠️ [Push] vente :', e.message));
}

/* ============================================================
   PLANIFICATION
   ============================================================ */
let enCours = false;

export async function tourDeVerification(maintenant = new Date()) {
    if (enCours) return;
    enCours = true;
    try {
        const boutiques = await boutiquesAvecTelephone();
        const heure = maintenant.getUTCHours();
        const jour = jourISO(maintenant);
        for (const id of boutiques) {
            try {
                await verifierStock(id);
                if (heure >= HEURE_RESUME) await envoyerResume(id, jour);
                if (heure >= HEURE_ABONNEMENT) await verifierAbonnement(id);
            } catch (e) {
                console.warn(`⚠️ [Push] boutique ${id} :`, e.message);
            }
        }
        // Ménage : les anciennes clés « résumé » et « abonnement » ne servent plus
        await pool.query(
            `DELETE FROM push_envois
              WHERE (cle LIKE 'resume:%' OR cle LIKE 'abo:%') AND date_envoi < NOW() - INTERVAL 60 DAY`
        );
    } catch (e) {
        console.warn('⚠️ [Push] vérification :', e.message);
    } finally {
        enCours = false;
    }
}

let minuterie = null;

/** À appeler une fois au démarrage du serveur. */
export function demarrerNotificationsPush() {
    if (minuterie || process.env.PUSH_DESACTIVE === '1') return;
    setTimeout(() => tourDeVerification(), 60 * 1000);
    minuterie = setInterval(() => tourDeVerification(), INTERVALLE_MS);
    console.log(' [Push] Notifications push actives (vérification toutes les 10 min)');
}

export default { envoyer, envoyerAuPatron, verifierStock, envoyerResume, verifierAbonnement, notifierVente, demarrerNotificationsPush };
