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
                    telephone: req.user.telephone || null,
                    position_source: 'manuel'
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
                // 🆕 GÉOLOCALISATION
                latitude,
                longitude,
                adresse_complete,
                position_source,
                precision_gps,
                // Infos légales
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

            // 🆕 VALIDATION GÉOLOCALISATION
            let lat = (latitude !== undefined && latitude !== '' && latitude !== null)
                ? parseFloat(latitude) : null;
            let lon = (longitude !== undefined && longitude !== '' && longitude !== null)
                ? parseFloat(longitude) : null;

            if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) {
                return res.status(400).json({
                    success: false,
                    message: 'Latitude invalide (doit être entre -90 et 90)'
                });
            }

            if (lon !== null && (isNaN(lon) || lon < -180 || lon > 180)) {
                return res.status(400).json({
                    success: false,
                    message: 'Longitude invalide (doit être entre -180 et 180)'
                });
            }

            const SOURCES_VALIDES = ['gps', 'ip', 'manuel'];
            const source = (position_source && SOURCES_VALIDES.includes(position_source))
                ? position_source
                : 'manuel';

            const precision = (precision_gps !== undefined && precision_gps !== '' && precision_gps !== null)
                ? parseFloat(precision_gps)
                : null;

            const existe = await Magasin.findByUtilisateur(id_utilisateur);

            // Si pas de magasin, le créer avec les données
            if (!existe) {
                const id = await Magasin.create(id_utilisateur, {
                    nom_commercial, slogan, logo_url, description,
                    quartier, ville, pays, telephone, telephone2, whatsapp, email,
                    latitude: lat, longitude: lon,
                    adresse_complete, position_source: source, precision_gps: precision,
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
                latitude: lat,
                longitude: lon,
                adresse_complete,
                position_source: source,
                precision_gps: precision,
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
     * ============================================================
     */
    static async uploadLogo(req, res) {
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

                const magasin = await Magasin.findByUtilisateur(id_utilisateur);

                if (!magasin) {
                    deleteFile(req.file.path);
                    return res.status(404).json({
                        success: false,
                        message: 'Magasin non trouvé'
                    });
                }

                if (magasin.logo_url) {
                    const ancienPath = getFilePathFromUrl(magasin.logo_url);
                    if (ancienPath) deleteFile(ancienPath);
                }

                const logo_url = `/uploads/magasins/${req.file.filename}`;

                await Magasin.update(id_utilisateur, { logo_url });

                const magasinMaj = await Magasin.findByUtilisateur(id_utilisateur);

                return res.status(200).json({
                    success: true,
                    message: 'Logo mis à jour avec succès',
                    logo_url,
                    magasin: magasinMaj
                });

            } catch (error) {
                console.error('❌ UploadLogo error:', error);
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

            if (magasin.logo_url) {
                const path = getFilePathFromUrl(magasin.logo_url);
                if (path) deleteFile(path);
            }

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

    /**
     * ============================================================
     * 🆕 GÉOCODER une adresse → lat/lon (Nominatim OSM)
     * POST /api/magasin/geocoder
     * Body: { adresse, ville, pays }
     * ============================================================
     */
    static async geocoder(req, res) {
        try {
            const { adresse, ville, pays } = req.body;

            if (!adresse && !ville) {
                return res.status(400).json({
                    success: false,
                    message: 'Renseignez au moins une ville ou une adresse'
                });
            }

            const q = [adresse, ville, pays].filter(Boolean).join(', ');
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;

            const r = await fetch(url, {
                headers: {
                    'User-Agent': 'StockApp/1.0 (contact@tonapp.com)',
                    'Accept-Language': 'fr'
                }
            });

            if (!r.ok) {
                return res.status(502).json({
                    success: false,
                    message: 'Service de géocodage indisponible'
                });
            }

            const data = await r.json();

            if (!data || !data[0]) {
                return res.status(404).json({
                    success: false,
                    message: 'Adresse introuvable'
                });
            }

            return res.status(200).json({
                success: true,
                latitude: parseFloat(data[0].lat),
                longitude: parseFloat(data[0].lon),
                adresse_complete: data[0].display_name,
                position_source: 'manuel'
            });

        } catch (error) {
            console.error('❌ Geocoder error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du géocodage'
            });
        }
    }

    /**
     * ============================================================
     * 🆕 TROUVER les magasins proches d'un point GPS
     * GET /api/magasin/proches?lat=5.35&lon=-4.00&rayon=10
     * ============================================================
     */
    static async getProches(req, res) {
        try {
            const { lat, lon, rayon } = req.query;

            if (!lat || !lon) {
                return res.status(400).json({
                    success: false,
                    message: 'Paramètres lat et lon requis'
                });
            }

            const latitude = parseFloat(lat);
            const longitude = parseFloat(lon);
            const rayonKm = rayon ? parseFloat(rayon) : 10;

            if (isNaN(latitude) || latitude < -90 || latitude > 90) {
                return res.status(400).json({
                    success: false,
                    message: 'Latitude invalide'
                });
            }

            if (isNaN(longitude) || longitude < -180 || longitude > 180) {
                return res.status(400).json({
                    success: false,
                    message: 'Longitude invalide'
                });
            }

            const magasins = await Magasin.findProches(latitude, longitude, rayonKm);

            return res.status(200).json({
                success: true,
                count: magasins.length,
                rayon_km: rayonKm,
                magasins
            });

        } catch (error) {
            console.error('❌ GetProches error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche des magasins proches'
            });
        }
    }
}

export default MagasinController;