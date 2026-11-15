// models/Plateforme.js
//
// Réglages de toute la plateforme Miyo, gérés depuis la console Super Admin :
// - maintenance (les patrons et employés ne peuvent plus travailler, avec un message)
// - annonce affichée en haut de l'application des patrons
// - version minimale de l'application mobile et lien de téléchargement
// Stockés dans un fichier sur le serveur (aucune table dans la base).
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const DOSSIER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'plateforme');
const FICHIER = path.join(DOSSIER, 'reglages.json');

const DEFAUT = () => ({
    maintenance: { active: false, message: 'Nous faisons une mise à jour pour améliorer Miyo. Nous revenons très vite.', fin_prevue: '' },
    annonce: { active: false, id: 0, titre: '', message: '', niveau: 'info', fin: '' },
    application: { version_min: '', lien: '', message: 'Une nouvelle version de Miyo est disponible. Installe-la pour continuer.' },
    date_modification: null,
});

const texte = (v, max) => String(v ?? '').trim().slice(0, max);
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const dateOuVide = (v) => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(v || '')) ? String(v) : '');
const version = (v) => (/^\d+(\.\d+){0,2}$/.test(String(v || '').trim()) ? String(v).trim() : '');
const lien = (v) => { const s = texte(v, 300); return /^https?:\/\//i.test(s) ? s : ''; };

let cache = null;

class Plateforme {
    static async reglages() {
        if (cache) return cache;
        const def = DEFAUT();
        try {
            const brut = JSON.parse(await fs.readFile(FICHIER, 'utf8'));
            cache = {
                ...def, ...brut,
                maintenance: { ...def.maintenance, ...(brut.maintenance || {}) },
                annonce: { ...def.annonce, ...(brut.annonce || {}) },
                application: { ...def.application, ...(brut.application || {}) },
            };
        } catch {
            cache = def;
        }
        return cache;
    }

    static async modifier(d = {}) {
        const a = await Plateforme.reglages();
        const m = d.maintenance || {};
        const an = d.annonce || {};
        const ap = d.application || {};
        const annonceTexte = texte(an.message ?? a.annonce.message, 500);
        const annonceTitre = texte(an.titre ?? a.annonce.titre, 120);
        const changeAnnonce = annonceTexte !== a.annonce.message || annonceTitre !== a.annonce.titre;
        const suivant = {
            maintenance: {
                active: m.active === undefined ? a.maintenance.active : bool(m.active),
                message: texte(m.message ?? a.maintenance.message, 300) || DEFAUT().maintenance.message,
                fin_prevue: m.fin_prevue === undefined ? a.maintenance.fin_prevue : dateOuVide(m.fin_prevue),
            },
            annonce: {
                active: an.active === undefined ? a.annonce.active : bool(an.active),
                // Nouvel identifiant quand le texte change : l'annonce réapparaît même chez ceux qui l'avaient fermée
                id: changeAnnonce ? Date.now() : (a.annonce.id || Date.now()),
                titre: annonceTitre,
                message: annonceTexte,
                niveau: ['info', 'important'].includes(an.niveau) ? an.niveau : a.annonce.niveau,
                fin: an.fin === undefined ? a.annonce.fin : dateOuVide(an.fin),
            },
            application: {
                version_min: ap.version_min === undefined ? a.application.version_min : version(ap.version_min),
                lien: ap.lien === undefined ? a.application.lien : lien(ap.lien),
                message: texte(ap.message ?? a.application.message, 300) || DEFAUT().application.message,
            },
            date_modification: new Date().toISOString(),
        };
        if (suivant.annonce.active && !suivant.annonce.message) suivant.annonce.active = false;
        await fs.mkdir(DOSSIER, { recursive: true });
        await fs.writeFile(FICHIER, JSON.stringify(suivant, null, 2), 'utf8');
        cache = suivant;
        return suivant;
    }

    /** Ce que voient les applications des patrons (sans authentification) */
    static async etatPublic() {
        const r = await Plateforme.reglages();
        const aujourd = new Date().toISOString().slice(0, 10);
        const annonceVisible = r.annonce.active && r.annonce.message && (!r.annonce.fin || r.annonce.fin.slice(0, 10) >= aujourd);
        return {
            maintenance: r.maintenance.active ? { active: true, message: r.maintenance.message, fin_prevue: r.maintenance.fin_prevue } : { active: false },
            annonce: annonceVisible
                ? { id: r.annonce.id, titre: r.annonce.titre, message: r.annonce.message, niveau: r.annonce.niveau }
                : null,
            application: { version_min: r.application.version_min, lien: r.application.lien, message: r.application.message },
        };
    }

    static async enMaintenance() {
        const r = await Plateforme.reglages();
        return r.maintenance.active ? r.maintenance : null;
    }
}

export default Plateforme;
