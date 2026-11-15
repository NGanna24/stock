// middleware/journalSuperAdmin.js
// Note dans le journal chaque modification faite depuis la console Super Admin
// (une fois la réponse envoyée, et seulement si elle a réussi).
import { pool } from '../config/db.js';
import JournalSuperAdmin from '../models/JournalSuperAdmin.js';

const nomPatron = async (id) => {
    const [[r]] = await pool.query('SELECT fullname FROM utilisateurs WHERE id_utilisateur = ?', [id]);
    return r?.fullname || null;
};
const nomMagasin = async (id) => {
    const [[r]] = await pool.query('SELECT nom_commercial FROM magasins WHERE id_magasin = ?', [id]);
    return r?.nom_commercial || null;
};
const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`;

/** Traduit une requête en ligne de journal (null = rien à noter) */
async function decrire(req) {
    const url = req.originalUrl.split('?')[0];
    const b = req.body || {};
    let m;
    if ((m = url.match(/\/abonnements\/(\d+)\/prolonger$/)) && req.method === 'POST') {
        const id = Number(m[1]);
        return { action: 'abonnement', cible_type: 'patron', cible_id: id, cible_nom: await nomPatron(id),
                 libelle: `Abonnement prolongé de ${Number(b.nb_mois) || 1} mois${b.montant ? ` (${fcfa(b.montant)})` : ''}`,
                 details: { nb_mois: b.nb_mois, montant: b.montant, moyen_paiement: b.moyen_paiement, reference: b.reference } };
    }
    if ((m = url.match(/\/abonnements\/(\d+)\/paiements\/(\d+)$/)) && req.method === 'DELETE') {
        const id = Number(m[1]);
        return { action: 'abonnement', cible_type: 'patron', cible_id: id, cible_nom: await nomPatron(id),
                 libelle: "Paiement d'abonnement annulé", details: { id_abonnement: Number(m[2]) } };
    }
    if (/\/abonnements\/reglages$/.test(url) && req.method === 'PUT') {
        return { action: 'reglages', libelle: 'Réglages des abonnements modifiés', details: b };
    }
    if ((m = url.match(/\/utilisateurs\/(\d+)\/toggle$/))) {
        const id = Number(m[1]);
        return { action: 'patron', cible_type: 'patron', cible_id: id, cible_nom: await nomPatron(id),
                 libelle: b.actif === false ? 'Compte patron désactivé' : 'Compte patron activé' };
    }
    if ((m = url.match(/\/magasins\/(\d+)\/toggle$/))) {
        const id = Number(m[1]);
        return { action: 'magasin', cible_type: 'magasin', cible_id: id, cible_nom: await nomMagasin(id),
                 libelle: b.actif === false ? 'Magasin désactivé' : 'Magasin activé' };
    }
    if ((m = url.match(/\/magasins\/(\d+)\/geolocalisation$/))) {
        const id = Number(m[1]);
        return { action: 'magasin', cible_type: 'magasin', cible_id: id, cible_nom: await nomMagasin(id),
                 libelle: 'Position du magasin modifiée', details: { latitude: b.latitude, longitude: b.longitude } };
    }
    if ((m = url.match(/\/securite\/debloquer\/(patron|employe)\/(\d+)$/))) {
        const id = Number(m[2]);
        let nom = null;
        if (m[1] === 'patron') nom = await nomPatron(id);
        else { const [[r]] = await pool.query('SELECT fullname FROM employes WHERE id_employe = ?', [id]); nom = r?.fullname || null; }
        return { action: 'securite', cible_type: m[1], cible_id: id, cible_nom: nom,
                 libelle: m[1] === 'patron' ? 'Compte patron débloqué' : 'Compte employé débloqué' };
    }
    if (/\/super-admin\/plateforme\/?$/.test(url) && req.method === 'PUT') {
        const parts = [];
        if (b.maintenance?.active !== undefined) parts.push(b.maintenance.active ? 'maintenance activée' : 'maintenance arrêtée');
        if (b.annonce?.active !== undefined) parts.push(b.annonce.active ? 'annonce publiée' : 'annonce retirée');
        if (b.application?.version_min !== undefined) parts.push(`version minimale : ${b.application.version_min || 'aucune'}`);
        return { action: 'reglages', libelle: `Réglages de la plateforme modifiés${parts.length ? ` (${parts.join(', ')})` : ''}`, details: b };
    }
    if (/\/auth\/profil$/.test(url) && req.method === 'PUT') return { action: 'securite', libelle: 'Nom du compte de la console modifié', details: { fullname: b.fullname } };
    if (/\/auth\/change-password$/.test(url)) return { action: 'securite', libelle: 'Mot de passe de la console modifié' };
    if (/\/auth\/logout$/.test(url)) return { action: 'connexion', libelle: 'Déconnexion de la console' };
    return null;
}

export const journalSuperAdmin = (req, res, next) => {
    if (req.method === 'GET' || req.method === 'OPTIONS') return next();
    res.on('finish', () => {
        if (res.statusCode >= 400 || !req.superAdmin) return;
        decrire(req)
            .then((ligne) => ligne && JournalSuperAdmin.noter({
                ...ligne,
                id_super_admin: req.superAdmin.id_super_admin,
                acteur_nom: req.superAdmin.fullname,
                ip: req.ip,
                user_agent: req.headers['user-agent'],
            }))
            .catch((e) => console.error('⚠️ Journal super admin :', e.message));
    });
    next();
};
