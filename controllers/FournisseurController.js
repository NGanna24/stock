// controllers/FournisseurController.js
import Fournisseur from '../models/Fournisseur.js';

class FournisseurController {
    /**
     * ============================================================
     * CRÉER un nouveau fournisseur
     * ============================================================
     */
    static async create(req, res) {
        try {
            const { nom, telephone, email, ville, pays, numero_tva, actif } = req.body;

            // Validation
            if (!nom || nom.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Le nom du fournisseur est obligatoire'
                });
            }

            // ✅ Vérifier email dans le workspace
            if (email) {
                const existingFournisseur = await Fournisseur.findByEmail(email, req.workspaceId);
                if (existingFournisseur) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un fournisseur avec cet email existe déjà'
                    });
                }
            }

            // ✅ Vérifier téléphone dans le workspace
            if (telephone) {
                const existingFournisseur = await Fournisseur.findByPhone(telephone, req.workspaceId);
                if (existingFournisseur) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un fournisseur avec ce numéro de téléphone existe déjà'
                    });
                }
            }

            // ✅ Vérifier TVA dans le workspace
            if (numero_tva) {
                const existingFournisseur = await Fournisseur.findByTva(numero_tva, req.workspaceId);
                if (existingFournisseur) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un fournisseur avec ce numéro de TVA existe déjà'
                    });
                }
            }

            // ✅ create(data, id_utilisateur)
            const fournisseur = await Fournisseur.create({
                nom: nom.trim(),
                telephone: telephone?.trim() || null,
                email: email?.trim() || null,
                ville: ville?.trim() || null,
                pays: pays?.trim() || null,
                numero_tva: numero_tva?.trim() || null,
                actif: actif !== undefined ? actif : true
            }, req.workspaceId);

            return res.status(201).json({
                success: true,
                message: 'Fournisseur créé avec succès',
                data: fournisseur
            });

        } catch (error) {
            console.error('❌ Create fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du fournisseur',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER tous les fournisseurs (workspace)
     * ============================================================
     */
    static async getAll(req, res) {
        try {
            const {
                search,
                nom,
                telephone,
                email,
                ville,
                pays,
                actif,
                page,
                limit
            } = req.query;

            const filters = { search, nom, telephone, email, ville, pays };

            if (actif !== undefined) {
                filters.actif = actif === 'true';
            }

            // ✅ Pagination avec workspace
            if (page && limit) {
                const result = await Fournisseur.findWithPagination(
                    parseInt(page),
                    parseInt(limit),
                    filters,
                    req.workspaceId
                );
                return res.status(200).json({
                    success: true,
                    ...result
                });
            }

            // ✅ findAll(filters, id_utilisateur)
            const fournisseurs = await Fournisseur.findAll(filters, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: fournisseurs.length,
                data: fournisseurs
            });

        } catch (error) {
            console.error('❌ Get all fournisseurs error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des fournisseurs'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER un fournisseur par ID (workspace)
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;

            // ✅ findById(id, id_utilisateur)
            const fournisseur = await Fournisseur.findById(id, req.workspaceId);

            if (!fournisseur) {
                return res.status(404).json({
                    success: false,
                    message: 'Fournisseur non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                data: fournisseur
            });

        } catch (error) {
            console.error('❌ Get fournisseur by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du fournisseur'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER les fournisseurs actifs (workspace)
     * ============================================================
     */
    static async getActive(req, res) {
        try {
            // ✅ findActive(id_utilisateur)
            const fournisseurs = await Fournisseur.findActive(req.workspaceId);

            return res.status(200).json({
                success: true,
                count: fournisseurs.length,
                data: fournisseurs
            });

        } catch (error) {
            console.error('❌ Get active fournisseurs error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des fournisseurs actifs'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER les fournisseurs par pays (workspace)
     * ============================================================
     */
    static async getByCountry(req, res) {
        try {
            const { pays } = req.params;

            // ✅ findByCountry(pays, id_utilisateur)
            const fournisseurs = await Fournisseur.findByCountry(pays, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: fournisseurs.length,
                data: fournisseurs
            });

        } catch (error) {
            console.error('❌ Get fournisseurs by country error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des fournisseurs'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER les fournisseurs par ville (workspace)
     * ============================================================
     */
    static async getByCity(req, res) {
        try {
            const { ville } = req.params;

            // ✅ findByCity(ville, id_utilisateur)
            const fournisseurs = await Fournisseur.findByCity(ville, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: fournisseurs.length,
                data: fournisseurs
            });

        } catch (error) {
            console.error('❌ Get fournisseurs by city error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des fournisseurs'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER les pays distincts (workspace)
     * ============================================================
     */
    static async getDistinctCountries(req, res) {
        try {
            // ✅ getDistinctCountries(id_utilisateur)
            const pays = await Fournisseur.getDistinctCountries(req.workspaceId);

            return res.status(200).json({
                success: true,
                count: pays.length,
                data: pays
            });

        } catch (error) {
            console.error('❌ Get distinct countries error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des pays'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER les villes distinctes (workspace)
     * ============================================================
     */
    static async getDistinctCities(req, res) {
        try {
            // ✅ getDistinctCities(id_utilisateur)
            const villes = await Fournisseur.getDistinctCities(req.workspaceId);

            return res.status(200).json({
                success: true,
                count: villes.length,
                data: villes
            });

        } catch (error) {
            console.error('❌ Get distinct cities error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des villes'
            });
        }
    }

    /**
     * ============================================================
     * METTRE À JOUR un fournisseur (workspace)
     * ============================================================
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const { nom, telephone, email, ville, pays, numero_tva, actif } = req.body;

            // ✅ Vérifier existence dans le workspace
            const existingFournisseur = await Fournisseur.findById(id, req.workspaceId);
            if (!existingFournisseur) {
                return res.status(404).json({
                    success: false,
                    message: 'Fournisseur non trouvé'
                });
            }

            // ✅ Vérifier email dans le workspace
            if (email && email !== existingFournisseur.email) {
                const emailExists = await Fournisseur.findByEmail(email, req.workspaceId);
                if (emailExists) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un fournisseur avec cet email existe déjà'
                    });
                }
            }

            // ✅ Vérifier téléphone dans le workspace
            if (telephone && telephone !== existingFournisseur.telephone) {
                const phoneExists = await Fournisseur.findByPhone(telephone, req.workspaceId);
                if (phoneExists) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un fournisseur avec ce numéro de téléphone existe déjà'
                    });
                }
            }

            // ✅ Vérifier TVA dans le workspace
            if (numero_tva && numero_tva !== existingFournisseur.numero_tva) {
                const tvaExists = await Fournisseur.findByTva(numero_tva, req.workspaceId);
                if (tvaExists) {
                    return res.status(409).json({
                        success: false,
                        message: 'Un fournisseur avec ce numéro de TVA existe déjà'
                    });
                }
            }

            // ✅ update(id, data, id_utilisateur)
            const updatedFournisseur = await Fournisseur.update(id, {
                nom: nom?.trim(),
                telephone: telephone?.trim() || null,
                email: email?.trim() || null,
                ville: ville?.trim() || null,
                pays: pays?.trim() || null,
                numero_tva: numero_tva?.trim() || null,
                actif
            }, req.workspaceId);

            return res.status(200).json({
                success: true,
                message: 'Fournisseur mis à jour avec succès',
                data: updatedFournisseur
            });

        } catch (error) {
            console.error('❌ Update fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du fournisseur'
            });
        }
    }

    /**
     * ============================================================
     * ACTIVER un fournisseur (workspace)
     * ============================================================
     */
    static async activate(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier existence dans le workspace
            const fournisseur = await Fournisseur.findById(id, req.workspaceId);
            if (!fournisseur) {
                return res.status(404).json({
                    success: false,
                    message: 'Fournisseur non trouvé'
                });
            }

            if (fournisseur.actif) {
                return res.status(400).json({
                    success: false,
                    message: 'Le fournisseur est déjà actif'
                });
            }

            // ✅ activate(id, id_utilisateur)
            const activated = await Fournisseur.activate(id, req.workspaceId);

            if (!activated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de l\'activation du fournisseur'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Fournisseur activé avec succès'
            });

        } catch (error) {
            console.error('❌ Activate fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'activation du fournisseur'
            });
        }
    }

    /**
     * ============================================================
     * DÉSACTIVER un fournisseur (workspace)
     * ============================================================
     */
    static async deactivate(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier existence dans le workspace
            const fournisseur = await Fournisseur.findById(id, req.workspaceId);
            if (!fournisseur) {
                return res.status(404).json({
                    success: false,
                    message: 'Fournisseur non trouvé'
                });
            }

            if (!fournisseur.actif) {
                return res.status(400).json({
                    success: false,
                    message: 'Le fournisseur est déjà inactif'
                });
            }

            // ✅ deactivate(id, id_utilisateur)
            const deactivated = await Fournisseur.deactivate(id, req.workspaceId);

            if (!deactivated) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la désactivation du fournisseur'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Fournisseur désactivé avec succès'
            });

        } catch (error) {
            console.error('❌ Deactivate fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la désactivation du fournisseur'
            });
        }
    }

    /**
     * ============================================================
     * SUPPRIMER définitivement un fournisseur (workspace)
     * ============================================================
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;

            // ✅ Vérifier existence dans le workspace
            const fournisseur = await Fournisseur.findById(id, req.workspaceId);
            if (!fournisseur) {
                return res.status(404).json({
                    success: false,
                    message: 'Fournisseur non trouvé'
                });
            }

            // ✅ delete(id, id_utilisateur)
            const deleted = await Fournisseur.delete(id, req.workspaceId);

            if (!deleted) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la suppression du fournisseur'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Fournisseur supprimé avec succès'
            });

        } catch (error) {
            console.error('❌ Delete fournisseur error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du fournisseur'
            });
        }
    }

    /**
     * ============================================================
     * RECHERCHER des fournisseurs (workspace)
     * ============================================================
     */
    static async search(req, res) {
        try {
            const { keyword } = req.query;

            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Le terme de recherche doit contenir au moins 2 caractères'
                });
            }

            // ✅ search(keyword, id_utilisateur)
            const fournisseurs = await Fournisseur.search(keyword, req.workspaceId);

            return res.status(200).json({
                success: true,
                count: fournisseurs.length,
                data: fournisseurs
            });

        } catch (error) {
            console.error('❌ Search fournisseurs error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche des fournisseurs'
            });
        }
    }

    /**
     * ============================================================
     * STATISTIQUES des fournisseurs (workspace)
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ getStats(id_utilisateur)
            const stats = await Fournisseur.getStats(req.workspaceId);

            return res.status(200).json({
                success: true,
                data: stats
            });

        } catch (error) {
            console.error('❌ Get fournisseur stats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }
    }

    /**
     * ============================================================
     * EXPORTER les fournisseurs du workspace
     * ============================================================
     */
    static async export(req, res) {
        try {
            // ✅ findAll(filters, id_utilisateur)
            const fournisseurs = await Fournisseur.findAll({ actif: true }, req.workspaceId);

            const exportData = fournisseurs.map(f => ({
                id: f.id_fournisseur,
                nom: f.nom,
                telephone: f.telephone,
                email: f.email,
                ville: f.ville,
                pays: f.pays,
                numero_tva: f.numero_tva
            }));

            return res.status(200).json({
                success: true,
                count: exportData.length,
                data: exportData
            });

        } catch (error) {
            console.error('❌ Export fournisseurs error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'export des fournisseurs'
            });
        }
    }
}

export default FournisseurController;