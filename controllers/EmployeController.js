// controllers/EmployeController.js
import Employe from '../models/Employe.js';
import Magasin from '../models/Magasin.js';

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

            const cleanedTelephone = telephone.replace(/\s/g, '');

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
                employes
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

            return res.status(200).json({ success: true, employe });

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
            const { fullname, telephone, roleName, id_magasin, actif } = req.body;

            if (roleName === 'admin') {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible d\'attribuer le rôle admin à un employé'
                });
            }

            // ✅ Vérifier téléphone unique si modifié (délégué au model)
            if (telephone) {
                const cleanedTelephone = telephone.replace(/\s/g, '');
                const telExiste = await Employe.telephoneExists(
                    cleanedTelephone,
                    id_utilisateur,
                    id // excludeId : on exclut l'employé en cours de modification
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
                telephone: telephone ? telephone.replace(/\s/g, '') : undefined,
                roleName,
                id_magasin,
                actif
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
                employe
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