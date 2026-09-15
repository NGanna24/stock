// controllers/MagasinController.js
import Magasin from '../models/Magasin.js';
import { uploadLogo, deleteFile, getFilePathFromUrl } from '../config/upload.js';

class MagasinController {
    /**
     * ============================================================
     * RÉCUPÉRER le magasin de l'utilisateur connecté
     * GET /api/magasin/mon-magasin
     * ============================================================
     */
    static async getMonMagasin(req, res) {
        try {
            const id_utilisateur = req.user.id_utilisateur;

            let magasin = await Magasin.findByUtilisateur(id_utilisateur);

            // Création à la volée si absent
            if (!magasin) {
                console.log(`⚠️ Aucun magasin trouvé pour ${id_utilisateur}, création à la volée...`);

                const id = await Magasin.create(id_utilisateur, {
                    telephone: req.user.telephone || null
                });

                magasin = await Magasin.findById(id, id_utilisateur);
            }

            return res.status(200).json({
                success: true,
                magasin
            });

        } catch (error) {
            console.error('❌ GetMonMagasin error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du magasin'
            });
        }
    }

    /**
     * ============================================================
     * METTRE À JOUR le magasin de l'utilisateur connecté
     * PUT /api/magasin/mon-magasin
     * ============================================================
     */
    static async updateMonMagasin(req, res) {
        try {
            const id_utilisateur = req.user.id_utilisateur;
            const {
                nom_commercial,
                slogan,
                logo_url,
                description,
                quartier,
                ville,
                pays,
                telephone,
                telephone2,
                whatsapp,
                email,
                numero_rccm,
                numero_nif,
                numero_contribuable,
                regime_fiscal
            } = req.body;

            // === Validations optionnelles ===
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Format d\'email invalide'
                });
            }

            if (telephone && !/^[0-9 +\-()]{6,20}$/.test(telephone)) {
                return res.status(400).json({
                    success: false,
                    message: 'Format de téléphone invalide'
                });
            }

            if (telephone2 && !/^[0-9 +\-()]{6,20}$/.test(telephone2)) {
                return res.status(400).json({
                    success: false,
                    message: 'Format de téléphone 2 invalide'
                });
            }

            if (whatsapp && !/^[0-9 +\-()]{6,20}$/.test(whatsapp)) {
                return res.status(400).json({
                    success: false,
                    message: 'Format WhatsApp invalide'
                });
            }

            if (nom_commercial && nom_commercial.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'Nom commercial trop long (max 200 caractères)'
                });
            }

            const existe = await Magasin.findByUtilisateur(id_utilisateur);

            // Si pas de magasin, le créer avec les données
            if (!existe) {
                const id = await Magasin.create(id_utilisateur, {
                    nom_commercial, slogan, logo_url, description,
                    quartier, ville, pays, telephone, telephone2, whatsapp, email,
                    numero_rccm, numero_nif, numero_contribuable, regime_fiscal
                });

                const nouveau = await Magasin.findById(id, id_utilisateur);

                return res.status(201).json({
                    success: true,
                    message: 'Magasin créé avec succès',
                    magasin: nouveau
                });
            }

            // Sinon mettre à jour
            const updated = await Magasin.update(id_utilisateur, {
                nom_commercial,
                slogan,
                logo_url,
                description,
                quartier,
                ville,
                pays,
                telephone,
                telephone2,
                whatsapp,
                email,
                numero_rccm,
                numero_nif,
                numero_contribuable,
                regime_fiscal
            });

            if (!updated) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucune modification effectuée'
                });
            }

            const magasin = await Magasin.findByUtilisateur(id_utilisateur);

            return res.status(200).json({
                success: true,
                message: 'Magasin mis à jour avec succès',
                magasin
            });

        } catch (error) {
            console.error('❌ UpdateMonMagasin error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du magasin'
            });
        }
    }

    /**
     * ============================================================
     * RÉCUPÉRER un magasin par ID
     * GET /api/magasin/:id
     * ============================================================
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const id_utilisateur = req.user.id_utilisateur;

            const magasin = await Magasin.findById(id, id_utilisateur);

            if (!magasin) {
                return res.status(404).json({
                    success: false,
                    message: 'Magasin non trouvé'
                });
            }

            return res.status(200).json({
                success: true,
                magasin
            });

        } catch (error) {
            console.error('❌ GetMagasinById error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du magasin'
            });
        }
    }

    /**
 * ============================================================
 * UPLOADER / REMPLACER le logo du magasin
 * POST /api/magasin/upload-logo
 * Content-Type: multipart/form-data
 * Body: { logo: <fichier> }
 * ============================================================
 */
static async uploadLogo(req, res) {
    // Exécuter multer manuellement pour attraper ses erreurs
    uploadLogo(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    message: 'Le fichier est trop volumineux (max 2 Mo)'
                });
            }
            return res.status(400).json({
                success: false,
                message: err.message || 'Erreur lors de l\'upload'
            });
        }

        try {
            const id_utilisateur = req.user.id_utilisateur;

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucun fichier fourni'
                });
            }

            // Récupérer le magasin actuel pour supprimer l'ancien logo
            const magasin = await Magasin.findByUtilisateur(id_utilisateur);

            if (!magasin) {
                // Supprimer le fichier uploadé (magasin n'existe pas)
                deleteFile(req.file.path);
                return res.status(404).json({
                    success: false,
                    message: 'Magasin non trouvé'
                });
            }

            // Supprimer l'ancien logo si existant
            if (magasin.logo_url) {
                const ancienPath = getFilePathFromUrl(magasin.logo_url);
                if (ancienPath) deleteFile(ancienPath);
            }

            // Construire l'URL publique
            const logo_url = `/uploads/magasins/${req.file.filename}`;

            // Mettre à jour le magasin
            await Magasin.update(id_utilisateur, { logo_url });

            // Récupérer le magasin mis à jour
            const magasinMaj = await Magasin.findByUtilisateur(id_utilisateur);

            return res.status(200).json({
                success: true,
                message: 'Logo mis à jour avec succès',
                logo_url,
                magasin: magasinMaj
            });

        } catch (error) {
            console.error('❌ UploadLogo error:', error);
            // Nettoyer le fichier en cas d'erreur
            if (req.file?.path) deleteFile(req.file.path);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'upload du logo'
            });
        }
    });
}

/**
 * ============================================================
 * SUPPRIMER le logo du magasin
 * DELETE /api/magasin/logo
 * ============================================================
 */
static async deleteLogo(req, res) {
    try {
        const id_utilisateur = req.user.id_utilisateur;

        const magasin = await Magasin.findByUtilisateur(id_utilisateur);
        if (!magasin) {
            return res.status(404).json({
                success: false,
                message: 'Magasin non trouvé'
            });
        }

        // Supprimer le fichier
        if (magasin.logo_url) {
            const path = getFilePathFromUrl(magasin.logo_url);
            if (path) deleteFile(path);
        }

        // Mettre à jour le magasin (logo_url = null)
        await Magasin.update(id_utilisateur, { logo_url: null });

        return res.status(200).json({
            success: true,
            message: 'Logo supprimé avec succès'
        });

    } catch (error) {
        console.error('❌ DeleteLogo error:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression du logo'
        });
    }
}
}

export default MagasinController;