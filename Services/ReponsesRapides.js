// Services/ReponsesRapides.js
//
// Réponses immédiates aux questions les plus fréquentes, SANS passer par l'IA :
// le serveur calcule et écrit la phrase lui-même (environ une seconde).
// Pour les gros boutons de l'assistant : « Mon argent du jour », « Ce qui manque »,
// « Qui me doit », « Ce qui marche le plus ».
// Phrases très courtes, lues à voix haute, pour des utilisateurs qui lisent peu.
import { pool } from '../config/db.js';
import RelanceClient from '../models/RelanceClient.js';
import { produits_en_rupture, produits_stock_bas, top_produits } from './toolss/StockTools.js';
import { aModule, permissionsDe } from '../utils/permissions.js';

const erreur = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (v) => Math.round(parseFloat(v) || 0);
// Montant écrit comme on le dit (l'application l'arrange pour la voix)
const francs = (v) => `${num(v).toLocaleString('fr-FR').replace(/ | /g, ' ')} francs`;

const aujourdHui = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const debutMois = () => `${aujourdHui().slice(0, 8)}01`;

/** « 15 Carton(s) » -> « 15 cartons » : quantité simple à dire */
const quantite = (q, unite) => {
    const n = parseFloat(q) || 0;
    const u = String(unite || 'unité').toLowerCase().replace(/\(s\)/g, n > 1 ? 's' : '');
    return `${Math.round(n * 100) / 100} ${n > 1 && !/s$/.test(u) ? `${u}s` : u}`;
};

/** « A », « A et B », « A, B et C » */
const enumerer = (noms) => (noms.length <= 1 ? noms.join('') : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`);

// intention -> pages qui permettent d'y répondre (une seule suffit)
const PAGES = {
    argent_jour: ['commandes-clients', 'caisse', 'rapport-ventes', 'factures'],
    manque: ['produits', 'alertes', 'inventaires', 'rapport-stocks'],
    dettes: ['relances', 'clients', 'factures'],
    meilleures_ventes: ['commandes-clients', 'rapport-ventes', 'produits'],
};

export const INTENTIONS = Object.keys(PAGES);

async function argentDuJour(id) {
    const jour = aujourdHui();
    const [[v]] = await pool.query(
        `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS total
         FROM commandes_vente
         WHERE id_utilisateur = ? AND date_commande = ? AND statut <> 'annulee'`,
        [id, jour]
    );
    const [[p]] = await pool.query(
        `SELECT COALESCE(SUM(p.montant), 0) AS encaisse
         FROM paiements p
         WHERE p.id_utilisateur = ? AND DATE(p.date_paiement) = ? AND p.mode_paiement <> 'avoir'`,
        [id, jour]
    );
    const nb = Number(v.nb) || 0;
    const total = num(v.total);
    const encaisse = num(p.encaisse);
    if (!nb) {
        return {
            reply: "Aujourd'hui, tu n'as encore rien vendu.",
            carte: { titre: "Ventes d'aujourd'hui", montant: 0, detail: 'Aucune vente pour le moment' },
        };
    }
    let reply = `Aujourd'hui, tu as vendu pour ${francs(total)}. ${nb === 1 ? 'Une seule vente.' : `${nb} ventes.`}`;
    if (encaisse < total) reply += ` Tu as reçu ${francs(encaisse)} en main.`;
    return {
        reply,
        carte: {
            titre: "Ventes d'aujourd'hui",
            montant: total,
            detail: `${nb} vente${nb > 1 ? 's' : ''} · ${francs(encaisse)} reçus`,
        },
    };
}

async function ceQuiManque(id) {
    const [finis, presque] = await Promise.all([produits_en_rupture({}, id), produits_stock_bas({}, id)]);
    const nbFinis = finis.count || 0;
    const nbPresque = presque.count || 0;
    if (!nbFinis && !nbPresque) {
        return {
            reply: 'Rien ne manque. Tout est en stock.',
            carte: { titre: 'Ce qui manque', chiffre: 0, detail: 'Tout est en stock' },
        };
    }
    const phrases = [];
    if (nbFinis) {
        const noms = finis.produits.slice(0, 3).map((p) => p.nom);
        phrases.push(
            nbFinis === 1
                ? `${noms[0]} est fini.`
                : `${nbFinis} produits sont finis${nbFinis > 3 ? ', par exemple' : ''} : ${enumerer(noms)}.`
        );
    }
    if (nbPresque) {
        const noms = presque.produits.slice(0, nbFinis ? 2 : 3).map((p) => p.nom);
        phrases.push(
            nbPresque === 1
                ? `${noms[0]} est presque fini.`
                : `${nbPresque} sont presque finis, comme ${enumerer(noms)}.`
        );
    }
    return {
        reply: phrases.join(' '),
        carte: {
            titre: 'Ce qui manque',
            chiffre: nbFinis + nbPresque,
            detail: `${nbFinis} fini${nbFinis > 1 ? 's' : ''} · ${nbPresque} presque fini${nbPresque > 1 ? 's' : ''}`,
            liste: [
                ...finis.produits.slice(0, 5).map((p) => ({ texte: p.nom, etat: 'Fini' })),
                ...presque.produits.slice(0, 5).map((p) => ({ texte: p.nom, etat: `Reste ${quantite(p.quantite_disponible, p.unite_affichage)}` })),
            ].slice(0, 6),
        },
    };
}

async function quiMeDoit(id) {
    const { clients: tous } = await RelanceClient.liste(id);
    const clients = (tous || []).filter((c) => c.total_du > 0);
    if (!clients.length) {
        return {
            reply: "Personne ne te doit de l'argent.",
            carte: { titre: 'Qui me doit', montant: 0, detail: 'Aucune dette client' },
        };
    }
    const total = clients.reduce((s, c) => s + c.total_du, 0);
    const tri = [...clients].sort((a, b) => b.total_du - a.total_du);
    const premiers = tri.slice(0, 3).map((c) => `${c.nomclient || 'un client'} ${francs(c.total_du)}`);
    const reply = clients.length === 1
        ? `${tri[0].nomclient || 'Un client'} te doit ${francs(total)}.`
        : `${clients.length} clients te doivent ${francs(total)} en tout. ${premiers.length > 1 ? 'Les plus gros' : 'Le plus gros'} : ${enumerer(premiers)}.`;
    return {
        reply,
        carte: {
            titre: 'Qui me doit',
            montant: total,
            detail: `${clients.length} client${clients.length > 1 ? 's' : ''}`,
            liste: tri.slice(0, 6).map((c) => ({ texte: c.nomclient || c.telephone, montant: c.total_du })),
        },
    };
}

async function meilleuresVentes(id) {
    const r = await top_produits({ limite: 3, date_debut: debutMois(), date_fin: aujourdHui() }, id);
    if (!r.count) {
        return {
            reply: "Ce mois, tu n'as encore rien vendu.",
            carte: { titre: 'Ce qui marche le plus', chiffre: 0, detail: 'Ce mois' },
        };
    }
    const morceaux = r.produits.map((p) => `${p.nom}, ${quantite(p.quantite_vendue, p.unite_affichage)}`);
    return {
        reply: `Ce mois, ce qui marche le plus : ${enumerer(morceaux)}.`,
        carte: {
            titre: 'Ce qui marche le plus',
            detail: 'Ce mois',
            liste: r.produits.map((p) => ({ texte: p.nom, etat: quantite(p.quantite_vendue, p.unite_affichage), montant: p.chiffre_affaires })),
        },
    };
}

const CALCULS = {
    argent_jour: argentDuJour,
    manque: ceQuiManque,
    dettes: quiMeDoit,
    meilleures_ventes: meilleuresVentes,
};

/** Réponse immédiate ; respecte les permissions du rôle (Rôles et permissions) */
export async function reponseRapide(req, intention) {
    if (!CALCULS[intention]) throw erreur('Question inconnue');
    await permissionsDe(req);
    if (!PAGES[intention].some((p) => aModule(req, p))) {
        return { reply: "Ton compte n'a pas accès à cette information. Demande au patron.", carte: null };
    }
    return CALCULS[intention](req.workspaceId);
}
