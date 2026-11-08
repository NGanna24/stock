// models/Abonnement.js
//
// Abonnements des patrons. Le paiement se fait hors du logiciel (Wave, Orange Money,
// MTN MoMo, banque) puis le super-admin prolonge l'abonnement à la main.
//
// - Le prix mensuel dépend du nombre de produits du patron (tarif réglable).
// - Un patron sans aucun paiement enregistré est en période d'essai.
// - date_fin = dernier jour couvert (inclus).
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const DOSSIER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'abonnement');
const FICHIER_REGLAGES = path.join(DOSSIER, 'reglages.json');

export const MOYENS = ['wave', 'orange', 'mtn', 'banque'];

const aujourdhui = () => new Date().toISOString().slice(0, 10);

const REGLAGES_DEFAUT = () => ({
    moyens: [
        { code: 'wave', nom: 'Wave', numero: '', titulaire: '', actif: true },
        { code: 'orange', nom: 'Orange Money', numero: '', titulaire: '', actif: true },
        { code: 'mtn', nom: 'MTN MoMo', numero: '', titulaire: '', actif: true },
        { code: 'banque', nom: 'Banque', numero: '', titulaire: '', banque: '', actif: true },
    ],
    tarif: { base: 10000, seuil: 100, palier: 50, supplement: 5000 },
    jours_essai: 30,
    // Abonnement expiré : la fenêtre de rappel revient toutes les X minutes (0 = seulement à l'ouverture)
    rappel_expire_minutes: 60,
    contact: '',
    // Jour où les abonnements ont été mis en service : les comptes déjà existants
    // ont leur période d'essai comptée à partir de ce jour, pas de leur inscription.
    date_lancement: aujourdhui(),
});

let cache = null;

const entier = (v, def, min = 0, max = 10000000) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(n, max));
};
const texte = (v, max = 100) => String(v ?? '').trim().slice(0, max);

class Abonnement {
    // ==================== RÉGLAGES (fichier sur le serveur) ====================
    static async reglages() {
        if (cache) return cache;
        try {
            const brut = JSON.parse(await fs.readFile(FICHIER_REGLAGES, 'utf8'));
            const def = REGLAGES_DEFAUT();
            cache = {
                ...def,
                ...brut,
                tarif: { ...def.tarif, ...(brut.tarif || {}) },
                moyens: def.moyens.map((m) => ({ ...m, ...((brut.moyens || []).find((x) => x.code === m.code) || {}) })),
            };
        } catch {
            cache = REGLAGES_DEFAUT();
            await Abonnement.ecrireReglages(cache);
        }
        return cache;
    }

    static async ecrireReglages(r) {
        await fs.mkdir(DOSSIER, { recursive: true });
        await fs.writeFile(FICHIER_REGLAGES, JSON.stringify(r, null, 2), 'utf8');
        cache = r;
    }

    static async modifierReglages(donnees = {}) {
        const actuel = await Abonnement.reglages();
        const suivant = { ...actuel };

        if (Array.isArray(donnees.moyens)) {
            suivant.moyens = actuel.moyens.map((m) => {
                const d = donnees.moyens.find((x) => x.code === m.code);
                if (!d) return m;
                return {
                    ...m,
                    numero: texte(d.numero, 60),
                    titulaire: texte(d.titulaire, 100),
                    ...(m.code === 'banque' ? { banque: texte(d.banque, 100) } : {}),
                    actif: d.actif !== false,
                };
            });
        }
        if (donnees.tarif) {
            const t = donnees.tarif;
            suivant.tarif = {
                base: entier(t.base, actuel.tarif.base),
                seuil: entier(t.seuil, actuel.tarif.seuil, 1),
                palier: entier(t.palier, actuel.tarif.palier, 1),
                supplement: entier(t.supplement, actuel.tarif.supplement),
            };
        }
        if (donnees.jours_essai !== undefined) suivant.jours_essai = entier(donnees.jours_essai, actuel.jours_essai, 0, 365);
        if (donnees.rappel_expire_minutes !== undefined) {
            suivant.rappel_expire_minutes = entier(donnees.rappel_expire_minutes, actuel.rappel_expire_minutes, 0, 1440);
        }
        if (donnees.contact !== undefined) suivant.contact = texte(donnees.contact, 60);

        await Abonnement.ecrireReglages(suivant);
        return suivant;
    }

    // Moyens visibles par les clients (seulement ceux actifs et renseignés)
    static moyensPublics(r) {
        return r.moyens
            .filter((m) => m.actif && m.numero)
            .map(({ code, nom, numero, titulaire, banque }) => ({ code, nom, numero, titulaire, banque: banque || undefined }));
    }

    // ==================== PRIX ====================
    // 10 000 F jusqu'à 100 produits, puis +5 000 F par tranche de 50 produits entamée.
    static prixMensuel(nbProduits, tarif) {
        const n = Math.max(0, Number(nbProduits) || 0);
        if (n <= tarif.seuil) return tarif.base;
        return tarif.base + Math.ceil((n - tarif.seuil) / tarif.palier) * tarif.supplement;
    }

    // ==================== STATUT D'UN OU PLUSIEURS PATRONS ====================
    static async statuts(idUtilisateur = null) {
        const r = await Abonnement.reglages();
        const [lignes] = await pool.query(
            `SELECT u.id_utilisateur, u.fullname, u.telephone, u.slug, u.actif,
                    DATE_FORMAT(u.date_creation, '%Y-%m-%d') AS date_inscription,
                    (SELECT COUNT(*) FROM produits p WHERE p.id_utilisateur = u.id_utilisateur) AS nb_produits,
                    (SELECT DATE_FORMAT(MAX(a.date_fin), '%Y-%m-%d') FROM abonnements a WHERE a.id_utilisateur = u.id_utilisateur) AS fin_payee,
                    (SELECT COUNT(*) FROM abonnements a WHERE a.id_utilisateur = u.id_utilisateur) AS nb_paiements,
                    (SELECT m.nom_commercial FROM magasins m WHERE m.id_utilisateur = u.id_utilisateur ORDER BY m.id_magasin LIMIT 1) AS nom_magasin
             FROM utilisateurs u
             ${idUtilisateur ? 'WHERE u.id_utilisateur = ?' : ''}
             ORDER BY u.fullname`,
            idUtilisateur ? [idUtilisateur] : []
        );

        const jour = aujourdhui();
        return lignes.map((l) => Abonnement.calculer(l, r, jour));
    }

    static calculer(l, r, jour) {
        let dateFin;
        let statut;
        if (l.fin_payee) {
            dateFin = l.fin_payee;
        } else {
            const depart = [l.date_inscription, r.date_lancement].filter(Boolean).sort().pop() || jour;
            dateFin = ajouterJours(depart, Math.max(0, r.jours_essai - 1));
        }
        const joursRestants = ecartJours(jour, dateFin);
        if (joursRestants < 0) statut = 'expire';
        else statut = l.fin_payee ? 'actif' : 'essai';

        const nbProduits = Number(l.nb_produits) || 0;
        return {
            id_utilisateur: l.id_utilisateur,
            fullname: l.fullname,
            telephone: l.telephone,
            slug: l.slug,
            nom_magasin: l.nom_magasin || null,
            compte_actif: !!l.actif,
            statut,
            en_essai: !l.fin_payee,
            date_fin: dateFin,
            jours_restants: joursRestants,
            nb_produits: nbProduits,
            nb_paiements: Number(l.nb_paiements) || 0,
            montant_mensuel: Abonnement.prixMensuel(nbProduits, r.tarif),
        };
    }

    // ==================== HISTORIQUE ====================
    static async historique(idUtilisateur) {
        const [rows] = await pool.query(
            `SELECT id_abonnement,
                    DATE_FORMAT(date_debut, '%Y-%m-%d') AS date_debut,
                    DATE_FORMAT(date_fin, '%Y-%m-%d') AS date_fin,
                    nb_mois, montant, moyen_paiement, reference, note, date_creation
             FROM abonnements WHERE id_utilisateur = ?
             ORDER BY date_fin DESC, id_abonnement DESC`,
            [idUtilisateur]
        );
        return rows.map((x) => ({ ...x, montant: Number(x.montant) }));
    }

    // ==================== PROLONGER (paiement reçu) ====================
    static async prolonger(idUtilisateur, { nb_mois, montant, moyen_paiement, reference, note }, idSuperAdmin) {
        const [statut] = await Abonnement.statuts(idUtilisateur);
        if (!statut) return null;

        const mois = entier(nb_mois, 1, 1, 24);
        const jour = aujourdhui();
        // Si l'abonnement (ou l'essai) court encore, la nouvelle période commence juste après.
        const debut = statut.jours_restants >= 0 ? ajouterJours(statut.date_fin, 1) : jour;
        const fin = ajouterJours(ajouterMois(debut, mois), -1);
        const somme = montant === undefined || montant === null || montant === ''
            ? statut.montant_mensuel * mois
            : Math.max(0, Number(montant) || 0);

        await pool.query(
            `INSERT INTO abonnements
                (id_utilisateur, date_debut, date_fin, nb_mois, montant, moyen_paiement, reference, note, id_super_admin)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                idUtilisateur, debut, fin, mois, somme,
                MOYENS.includes(moyen_paiement) ? moyen_paiement : null,
                texte(reference, 100) || null,
                texte(note, 255) || null,
                idSuperAdmin || null,
            ]
        );
        const [apres] = await Abonnement.statuts(idUtilisateur);
        return apres;
    }

    // Annuler un paiement saisi par erreur
    static async supprimer(idUtilisateur, idAbonnement) {
        const [r] = await pool.query(
            'DELETE FROM abonnements WHERE id_abonnement = ? AND id_utilisateur = ?',
            [idAbonnement, idUtilisateur]
        );
        return r.affectedRows > 0;
    }
}

// ==================== DATES (chaînes AAAA-MM-JJ, en UTC = heure d'Abidjan) ====================
function versDate(s) {
    const [a, m, j] = s.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, j));
}
function versTexte(d) {
    return d.toISOString().slice(0, 10);
}
function ajouterJours(s, n) {
    const d = versDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return versTexte(d);
}
function ajouterMois(s, n) {
    const d = versDate(s);
    const jour = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(jour, dernier));
    return versTexte(d);
}
function ecartJours(de, a) {
    return Math.round((versDate(a) - versDate(de)) / 86400000);
}

export default Abonnement;
