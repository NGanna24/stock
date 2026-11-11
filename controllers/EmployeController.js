// controllers/EmployeController.js
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import Employe, { CHAMPS_FICHE } from '../models/Employe.js';
import { urlPhoto, supprimerPhoto } from '../middleware/uploadPhotoProfil.js';
import Magasin from '../models/Magasin.js';
import Utilisateur from '../models/Utilisateur.js';

// ============================================================
// Numéro d'un employé : même contrôle qu'à la connexion.
// Sans ce contrôle, un numéro mal formé (ex. un numéro du Burkina
// enregistré avec l'indicatif de la Côte d'Ivoire) était accepté
// à la création, mais l'employé ne pouvait jamais se connecter.
// ============================================================
function verifierTelephoneEmploye(brut) {
    const texte = String(brut || '').replace(/[\s\-().]/g, '');
    if (!texte) return { ok: false, message: 'Numéro de téléphone requis' };
    const avecPlus = texte.startsWith('00') ? `+${texte.slice(2)}` : texte;
    const numero = parsePhoneNumberFromString(avecPlus.startsWith('+') ? avecPlus : `+${avecPlus}`);
    if (!numero || !numero.isValid()) {
        return {
            ok: false,
            message: "Ce numéro n'est pas valide pour le pays choisi. Vérifiez le pays (indicatif) puis le numéro, sans le 0 du début si le pays n'en utilise pas.",
        };
    }
    return { ok: true, telephone: numero.number }; // forme +22670123456
}

// Un numéro sert à se connecter : il doit être unique dans tout Miyo.
// Renvoie null si le numéro est libre, sinon un message qui dit À QUI il appartient.
async function numeroDejaPris(telephone, idPatron, idEmployeExclu = null) {
    const lisible = parsePhoneNumberFromString(telephone)?.formatInternational() || telephone;
    const patron = await Utilisateur.findOnly(telephone);
    if (patron) {
        return Number(patron.id_utilisateur) === Number(idPatron)
            ? `${lisible} est votre propre numéro (celui de votre compte patron). Chaque employé doit avoir son propre numéro.`
            : `${lisible} est déjà le numéro d'un compte patron Miyo (une autre boutique). Utilisez un autre numéro.`;
    }
    const emp = await Employe.findByTelephone(telephone);
    if (!emp || Number(emp.id_employe) === Number(idEmployeExclu)) return null;
    return Number(emp.id_utilisateur) === Number(idPatron)
        ? `${lisible} est déjà le numéro de votre employé ${emp.fullname}.`
        : `${lisible} est déjà le numéro d'un employé d'une autre boutique Miyo. Utilisez un autre numéro.`;
}

// ==================== FICHE EMPLOYÉ ====================
export const PIECES = ['cni', 'passeport', 'permis', 'attestation', 'carte_consulaire', 'autre'];
const LONGUEURS = { adresse: 255, quartier: 100, piece_numero: 60, contact_urgence_nom: 120, contact_urgence_tel: 30, notes: 2000 };
const estPatron = (req) => req.user?.type !== 'employe';

/** Lit et vérifie les champs de fiche envoyés. Le salaire n'est accepté que du patron. */
function lireFiche(body = {}, patron) {
    const fiche = {};
    for (const champ of CHAMPS_FICHE) {
        if (body[champ] === undefined) continue;
        if (champ === 'salaire' && !patron) continue;
        let v = body[champ] === null ? '' : String(body[champ]).trim();
        if (v === '') { fiche[champ] = ''; continue; }
        if (champ === 'date_naissance' || champ === 'date_embauche') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v + 'T00:00:00').getTime())) {
                return { erreur: champ === 'date_naissance' ? 'Date de naissance invalide' : "Date d'embauche invalide" };
            }
            const d = new Date(v + 'T00:00:00');
            if (d > new Date()) {
                if (champ === 'date_naissance') return { erreur: 'La date de naissance ne peut pas être dans le futur' };
                if (d - new Date() > 366 * 86400000) return { erreur: "Date d'embauche trop éloignée" };
            }
            if (champ === 'date_naissance' && d.getFullYear() < 1920) return { erreur: 'Date de naissance invalide' };
        } else if (champ === 'salaire') {
            const n = Number(v.replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(n) || n < 0 || n > 1e12) return { erreur: 'Salaire invalide' };
            v = Math.round(n * 100) / 100;
        } else if (champ === 'piece_type') {
            if (!PIECES.includes(v)) return { erreur: "Type de pièce d'identité inconnu" };
        } else if (champ === 'contact_urgence_tel') {
            if (!/^\+?[\d\s.-]{6,20}$/.test(v)) return { erreur: "Numéro du contact d'urgence invalide" };
        }
        if (typeof v === 'string' && LONGUEURS[champ] && v.length > LONGUEURS[champ]) {
            return { erreur: `Texte trop long (${LONGUEURS[champ]} caractères maximum)` };
        }
        fiche[champ] = v;
    }
    return { fiche };
}

const dateISO = (d) => {
    if (!d) return null;
    if (d instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    return String(d).slice(0, 10);
};

/** Ce qu'on renvoie d'un employé : jamais le code ni les infos de sécurité ; salaire au patron seulement. */
function presenter(emp, req) {
    if (!emp) return emp;
    const { password, session_version, tentatives_echouees, bloque_jusqua, ...reste } = emp;
    if (!estPatron(req)) delete reste.salaire;
    else if (reste.salaire != null) reste.salaire = Number(reste.salaire);
    if ('date_naissance' in reste) reste.date_naissance = dateISO(reste.date_naissance);
    if ('date_embauche' in reste) reste.date_embauche = dateISO(reste.date_embauche);
    return reste;
}

class EmployeController {
    /**
     * ============================================================
     * CRÉER un employé (admin uniquement)
     * POST /api/employes
     * Body: { fullname, telephone, password, roleName, id_magasin? }
     * ============================================================
     */
    static async create(req, res) {
        try { 
            const id_utilisateur = req.user.id_utilisateur;
            const { fullname, telephone, password, roleName, id_magasin } = req.body;
            const { fiche, erreur: erreurFiche } = lireFiche(req.body, estPatron(req));
            if (erreurFiche) return res.status(400).json({ success: false, message: erreurFiche });

            // === Validations HTTP ===
            if (!fullname || !telephone || !password || !roleName) {
                return res.status(400).json({
                    success: false,
                    message: 'Nom, téléphone, mot de passe et rôle sont obligatoires'
                });
            }

            if (!/^\d{4}$/.test(password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Le mot de passe doit contenir exactement 4 chiffres'
                });
            }

            if (roleName === 'admin') {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible de créer un employé avec le rôle admin'
                });
            }

            const tel = verifierTelephoneEmploye(telephone);
            if (!tel.ok) {
                return res.status(400).json({ success: false, message: tel.message });
            }
            const cleanedTelephone = tel.telephone;

            // ✅ Vérifier que le rôle existe
            const roleId = await Employe.getRoleId(roleName);
            if (!roleId) {
                return res.status(400).json({
                    success: false,
                    message: `Le rôle '${roleName}' n'existe pas ou est inactif`
                });
            }

            // ✅ Vérifier téléphone unique (délégué au model)
            const telephoneDejaUtilise = await Employe.telephoneExists(
                cleanedTelephone,
                id_utilisateur
            );
            if (telephoneDejaUtilise) {
                return res.status(400).json({
                    success: false,
                    message: 'Un employé avec ce numéro existe déjà dans votre magasin'
                });
            }
            const dejaPris = await numeroDejaPris(cleanedTelephone, id_utilisateur);
            if (dejaPris) {
                return res.status(400).json({ success: false, message: dejaPris });
            }

            // ✅ Déterminer le magasin
            let magasinId = id_magasin;
            if (!magasinId) {
                const magasin = await Magasin.findByUtilisateur(id_utilisateur);
                if (!magasin) {
                    return res.status(400).json({
                        success: false,
                        message: 'Aucun magasin trouvé. Complétez d\'abord les informations de votre magasin.'
                    });
                }
                magasinId = magasin.id_magasin;
            } else {
                const magasin = await Magasin.findById(magasinId, id_utilisateur);
                if (!magasin) {
                    return res.status(403).json({
                        success: false,
                        message: 'Ce magasin ne vous appartient pas'
                    });
                }
            }

            // ✅ Créer l'employé (le model hash le mot de passe + slug)
            const employeId = await Employe.create({
                id_utilisateur,
                id_magasin: magasinId,
                fullname,
                telephone: cleanedTelephone,
                password,
                roleName
            });

            if (Object.keys(fiche).length) await Employe.update(employeId, id_utilisateur, fiche);

            const newEmploye = await Employe.findByIdAndPatron(employeId, id_utilisateur);

            return res.status(201).json({
                success: true,
                message: 'Employé créé avec succès',
                employe: {
                    id:            newEmploye.id_employe,
                    fullname:      newEmploye.fullname,
                    slug:          newEmploye.slug,
                    telephone:     newEmploye.telephone,
                    role:          newEmploye.role_nom,
                    id_magasin:    newEmploye.id_magasin,
                    actif:         newEmploye.actif,
                    date_creation: newEmploye.date_creation
                }
            });

        } catch (error) {
            console.error('❌ CreateEmploye error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Erreur lors de la création de l\'employé'
            });
        }
    }

    /**
     * ============================================================
     * LISTER les employés de l'utilisateur connecté
     * GET /api/employes
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const id_utilisateur = req.user.id_utilisateur;
            const employes = await Employe.findAllByPatron(id_utilisateur);

            return res.status(200).json({
                success: true,
                count: employes.length,
                employes: employes.map((e) => presenter(e, req))
            });

        } catch (error) {
            console.error('❌ GetAllEmployes error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des employés'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER un employé par ID (workspace vérifié)
     * GET /api/employes/:id
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const id_utilisateur = req.user.id_utilisateur;

            const employe = await Employe.findByIdAndPatron(id, id_utilisateur);

            if (!employe) {
                return res.status(404).json({
                    success: false,
                    message: 'Employé non trouvé'
                });
            }

            return res.status(200).json({ success: true, employe: presenter(employe, req) });

        } catch (error) {
            console.error('❌ GetEmployeById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération'
            });
        }
    }

    /**
     * ============================================================
     * METTRE À JOUR un employé
     * PUT /api/employes/:id
     * ============================================================
     */
static async update(req, res) {
    try {
        const { id } = req.params;
        const id_utilisateur = req.user.id_utilisateur;
        const { fullname, telephone, roleName, id_magasin, actif, password } = req.body;
        const { fiche, erreur: erreurFiche } = lireFiche(req.body, estPatron(req));
        if (erreurFiche) return res.status(400).json({ success: false, message: erreurFiche });
        //                                                                   ^^^^^^^^ AJOUT

        if (roleName === 'admin') {
            return res.status(400).json({
                success: false,
                message: 'Impossible d\'attribuer le rôle admin à un employé'
            });
        }

        // ✅ Validation du mot de passe s'il est fourni
        if (password && !/^\d{4}$/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Le mot de passe doit contenir exactement 4 chiffres'
            });
        }

        let telephoneNormalise;
        if (telephone) {
            const tel = verifierTelephoneEmploye(telephone);
            if (!tel.ok) {
                return res.status(400).json({ success: false, message: tel.message });
            }
            const cleanedTelephone = telephoneNormalise = tel.telephone;
            const dejaPris = await numeroDejaPris(cleanedTelephone, id_utilisateur, id);
            if (dejaPris) {
                return res.status(400).json({ success: false, message: dejaPris });
            }
            const telExiste = await Employe.telephoneExists(
                cleanedTelephone,
                id_utilisateur,
                id
            );
            if (telExiste) {
                return res.status(400).json({
                    success: false,
                    message: 'Ce numéro est déjà utilisé par un autre employé'
                });
            }
        }

        const updated = await Employe.update(id, id_utilisateur, {
            fullname,
            telephone: telephoneNormalise,
            roleName,
            id_magasin,
            actif,
            password: password || undefined,  // ✅ AJOUT
            ...fiche,
        });

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: 'Employé non trouvé ou aucune modification'
            });
        }

        const employe = await Employe.findByIdAndPatron(id, id_utilisateur);

        return res.status(200).json({
            success: true,
            message: 'Employé mis à jour avec succès',
            employe: presenter(employe, req)
        });

    } catch (error) {
        console.error('❌ UpdateEmploye error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Erreur lors de la mise à jour'
        });
    }
}

    /**
     * ============================================================
     * ACTIVER / DÉSACTIVER un employé
     * PATCH /api/employes/:id/actif
     * Body: { actif: true|false }
     * ============================================================
     */
    static async toggleActivation(req, res) {
        try {
            const { id } = req.params;
            const { actif } = req.body;
            const id_utilisateur = req.user.id_utilisateur;

            if (actif === undefined || actif === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Le statut actif est obligatoire'
                });
            }

            const updated = await Employe.toggleActivation(id, id_utilisateur, actif);

            if (!updated) {
                return res.status(404).json({
                    success: false,
                    message: 'Employé non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: `Employé ${actif ? 'activé' : 'désactivé'} avec succès`
            });

        } catch (error) {
            console.error('❌ ToggleActivation error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la modification du statut'
            });
        }
    }

    /**
     * ============================================================
     * SUPPRIMER un employé
     * DELETE /api/employes/:id
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const id_utilisateur = req.user.id_utilisateur;

            const deleted = await Employe.delete(id, id_utilisateur);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Employé non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Employé supprimé avec succès'
            });

        } catch (error) {
            console.error('❌ DeleteEmploye error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression'
            });
        }
    }

    /**
     * ============================================================
     * STATISTIQUES des employés
     * GET /api/employes/stats
     * ============================================================
     */
    /**
     * PHOTO d'un employé (patron ou gérant)
     * POST /api/employes/:id/photo   (champ « photo »)
     * DELETE /api/employes/:id/photo
     */
    static async definirPhoto(req, res) {
        const url = req.file ? urlPhoto(req.file.filename) : null;
        try {
            if (req.method === 'POST' && !req.file) {
                return res.status(400).json({ success: false, message: 'Aucune photo reçue' });
            }
            const r = await Employe.definirPhoto(req.params.id, req.user.id_utilisateur, url);
            if (!r.trouve) {
                if (url) supprimerPhoto(url);
                return res.status(404).json({ success: false, message: 'Employé non trouvé' });
            }
            if (r.ancienne && r.ancienne !== url) supprimerPhoto(r.ancienne);
            return res.json({ success: true, photo_url: url, message: url ? 'Photo enregistrée' : 'Photo retirée' });
        } catch (error) {
            if (url) supprimerPhoto(url);
            console.error('❌ PhotoEmploye error:', error);
            return res.status(500).json({ success: false, message: "Impossible d'enregistrer la photo" });
        }
    }

    static async getStats(req, res) {
        try {
            const id_utilisateur = req.user.id_utilisateur;
            const stats = await Employe.getStats(id_utilisateur);
            return res.status(200).json({ success: true, stats });
        } catch (error) {
            console.error('❌ GetStats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }
    }
}

export default EmployeController;