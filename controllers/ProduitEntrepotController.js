// controllers/ProduitEntrepotController.js
//
// Catalogue de l'ENTREPÔT : indépendant des produits du magasin.
// Pas d'import depuis le magasin : le seul pont est le transfert.
import ProduitEntrepot from '../models/ProduitEntrepot.js';
import Entrepot from '../models/Entrepot.js';
import CommandeAchat from '../models/CommandeAchat.js';

class ProduitEntrepotController {

    /* ============================================================
       HELPER — vérifie l'accès à l'entrepôt
       ============================================================ */
    static async _checkAccess(id_entrepot, id_utilisateur) {
        // Le propriétaire a toujours accès (même s'il n'a pas de ligne dans membres_entrepot)
        const estMembre = (await Entrepot.isMembre(id_entrepot, id_utilisateur))
            || (await CommandeAchat.estProprietaireEntrepot(id_entrepot, id_utilisateur));
        if (!estMembre) {
            const err = new Error("Accès refusé à cet entrepôt");
            err.statusCode = 403;
            throw err;
        }
    }

    /* ============================================================
       HELPER — réponse d'erreur uniforme
       ============================================================ */
    static _sendError(res, error, fallbackMessage = "Erreur serveur") {
        console.error("❌", error);

        if (error.isDuplicate) {
            return res.status(409).json({
                success: false,
                code: "DUPLICATE_PRODUIT_ENTREPOT",
                message: error.message,
                existing: { id_produit_entrepot: error.existingId || null },
            });
        }
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || fallbackMessage,
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }

    /* ============================================================
       HELPER — validation des unités de vente
       ============================================================ */
    static _validateUnites(unites_vente) {
        if (!Array.isArray(unites_vente)) return null;

        for (const unite of unites_vente) {
            if (!unite || !unite.nom || !unite.nom.trim()) {
                return "Toutes les unités de vente doivent avoir un nom";
            }
            if (!unite.quantite_base || parseFloat(unite.quantite_base) <= 0) {
                return `La quantité de base de "${unite.nom}" doit être supérieure à 0`;
            }
            if (!unite.prix_vente || parseFloat(unite.prix_vente) <= 0) {
                return `Le prix de vente de "${unite.nom}" doit être supérieur à 0`;
            }
        }
        return null;
    }

    /* ============================================================
       HELPER — id numérique valide ou 400
       ============================================================ */
    static _parseId(value, label) {
        const id = parseInt(value, 10);
        if (!Number.isInteger(id) || id <= 0) {
            const err = new Error(`${label} invalide`);
            err.statusCode = 400;
            throw err;
        }
        return id;
    }

    /* ============================================================
       LISTER tous les produits d'un entrepôt
       GET /entrepots/:id_entrepot/produits
       ============================================================ */
    static async getAllProduits(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            const produits = await ProduitEntrepot.getAll(id_entrepot);

            res.json({
                success: true,
                count: produits.length,
                produits,
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors du chargement des produits");
        }
    }

    /* ============================================================
       DÉTAIL d'un produit entrepôt
       GET /entrepots/:id_entrepot/produits/:id_produit_entrepot
       ============================================================ */
    static async getProduitById(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_produit_entrepot = ProduitEntrepotController._parseId(req.params.id_produit_entrepot, "Produit");
            const id_utilisateur = req.workspaceId;

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            const produit = await ProduitEntrepot.findById(id_produit_entrepot);

            if (!produit || produit.id_entrepot !== id_entrepot || !produit.actif) {
                return res.status(404).json({
                    success: false,
                    message: "Produit entrepôt introuvable",
                });
            }

            res.json({ success: true, data: produit });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors du chargement du produit");
        }
    }

    /* ============================================================
       CRÉER un produit entrepôt + ses unités de vente
       POST /entrepots/:id_entrepot/produits
       (la transaction est gérée par ProduitEntrepot.create)
       ============================================================ */
    static async createProduit(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;
            const data = req.body || {};
            const unites_vente = data.unites_vente || [];

            // 1) Accès
            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            // 2) Validations de base
            if (!data.nom || data.nom.trim() === "") {
                return res.status(400).json({
                    success: false,
                    message: "Le nom du produit est requis",
                });
            }

            if (!data.id_fournisseur) {
                return res.status(400).json({
                    success: false,
                    message: "Le fournisseur est requis",
                });
            }

            const unitesError = ProduitEntrepotController._validateUnites(unites_vente);
            if (unitesError) {
                return res.status(400).json({
                    success: false,
                    message: unitesError,
                });
            }

            // 3) Anti-doublon (message enrichi)
            const nomNormalise = data.nom.trim();
            const idModele = data.id_modele ? parseInt(data.id_modele, 10) : null;
            const idMarque = data.id_marque ? parseInt(data.id_marque, 10) : null;

            const doublon = await ProduitEntrepot.findDuplicate({
                id_entrepot,
                nom: nomNormalise,
                id_marque: idMarque,
                id_modele: idModele,
            });

            if (doublon) {
                const details = [];
                if (idModele) details.push(`modèle #${idModele}`);
                if (idMarque) details.push(`marque #${idMarque}`);
                const detailsStr = details.length > 0 ? ` (${details.join(", ")})` : "";

                return res.status(409).json({
                    success: false,
                    code: "DUPLICATE_PRODUIT_ENTREPOT",
                    message: `Un produit nommé "${nomNormalise}"${detailsStr} existe déjà dans cet entrepôt.`,
                    existing: {
                        id_produit_entrepot: doublon.id_produit_entrepot,
                        nom: doublon.nom,
                    },
                });
            }

            // 4) Création
            const id_produit_entrepot = await ProduitEntrepot.create({
                id_entrepot,
                id_utilisateur,
                nom: nomNormalise,
                description: data.description || null,
                id_categorie: data.id_categorie || null,
                id_marque: idMarque,
                id_modele: idModele,
                id_unite: data.id_unite || null,
                id_fournisseur: data.id_fournisseur || null,
                prix_achat: data.prix_achat || 0,
                prix_vente: data.prix_vente || 0,
                quantite_stock: data.quantite_stock || 0,
                quantite_minimale: data.quantite_minimale || 0,
                quantite_maximale: data.quantite_maximale || 0,
                emplacement: data.emplacement || null,
                rayon: data.rayon || null,
                etagere: data.etagere || null,
                unites_vente,
            });

            const newProduit = await ProduitEntrepot.findById(id_produit_entrepot);

            res.status(201).json({
                success: true,
                message: "Produit entrepôt créé avec succès",
                data: newProduit,
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors de la création du produit");
        }
    }

    /* ============================================================
       METTRE À JOUR un produit entrepôt
       PUT /entrepots/:id_entrepot/produits/:id_produit_entrepot
       ============================================================ */
    static async updateProduit(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_produit_entrepot = ProduitEntrepotController._parseId(req.params.id_produit_entrepot, "Produit");
            const id_utilisateur = req.workspaceId;
            const data = req.body || {};

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            if (data.nom !== undefined && String(data.nom).trim() === "") {
                return res.status(400).json({
                    success: false,
                    message: "Le nom du produit est requis",
                });
            }

            if (Array.isArray(data.unites_vente)) {
                const unitesError = ProduitEntrepotController._validateUnites(data.unites_vente);
                if (unitesError) {
                    return res.status(400).json({
                        success: false,
                        message: unitesError,
                    });
                }
            }

            await ProduitEntrepot.update(id_produit_entrepot, id_entrepot, data, req.workspaceId);

            const produit = await ProduitEntrepot.findById(id_produit_entrepot);

            res.json({
                success: true,
                message: "Produit entrepôt mis à jour",
                data: produit,
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors de la mise à jour du produit");
        }
    }

    /* ============================================================
       METTRE À JOUR le stock (PATCH rapide)
       PATCH /entrepots/:id_entrepot/produits/:id_produit_entrepot/stock
       ============================================================ */
    static async updateStock(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_produit_entrepot = ProduitEntrepotController._parseId(req.params.id_produit_entrepot, "Produit");
            const id_utilisateur = req.workspaceId;
            const { quantite } = req.body || {};

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            if (quantite === undefined || isNaN(parseFloat(quantite))) {
                return res.status(400).json({
                    success: false,
                    message: "La quantité est requise et doit être un nombre",
                });
            }
            if (parseFloat(quantite) < 0) {
                return res.status(400).json({
                    success: false,
                    message: "La quantité ne peut pas être négative",
                });
            }

            await ProduitEntrepot.updateStock(
                id_produit_entrepot,
                id_entrepot,
                parseFloat(quantite),
                req.workspaceId
            );

            const produit = await ProduitEntrepot.findById(id_produit_entrepot);

            res.json({
                success: true,
                message: "Stock mis à jour",
                data: produit,
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors de la mise à jour du stock");
        }
    }

    /* ============================================================
       SUPPRIMER un produit entrepôt (soft delete)
       DELETE /entrepots/:id_entrepot/produits/:id_produit_entrepot
       ============================================================ */
    static async deleteProduit(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_produit_entrepot = ProduitEntrepotController._parseId(req.params.id_produit_entrepot, "Produit");
            const id_utilisateur = req.workspaceId;

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            await ProduitEntrepot.delete(id_produit_entrepot, id_entrepot);

            res.json({
                success: true,
                message: "Produit entrepôt supprimé",
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors de la suppression du produit");
        }
    }

    /* ============================================================
       RECHERCHER des produits entrepôt
       GET /entrepots/:id_entrepot/produits/search?q=...
       ============================================================ */
    static async searchProduits(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;
            const keyword = (req.query.q || "").trim();

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            if (!keyword) {
                return res.status(400).json({
                    success: false,
                    message: "Le paramètre de recherche est requis",
                });
            }

            const produits = await ProduitEntrepot.getAll(id_entrepot);
            const q = keyword.toLowerCase();
            const resultats = produits.filter((p) => {
                const haystack = [
                    p.nom,
                    p.description,
                    p.categorie_nom,
                    p.marque_nom,
                    p.modele_nom,
                    p.fournisseur_nom,
                    p.emplacement,
                    p.rayon,
                    p.etagere,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(q);
            });

            res.json({
                success: true,
                count: resultats.length,
                produits: resultats,
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors de la recherche");
        }
    }

    /* ============================================================
       STATISTIQUES des produits entrepôt
       GET /entrepots/:id_entrepot/produits/stats
       ============================================================ */
    static async getProduitsStats(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            const stats = await ProduitEntrepot.getStats(id_entrepot);

            res.json({ success: true, data: stats });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors du calcul des statistiques");
        }
    }

    /* ============================================================
       FILTRER les produits entrepôt
       GET /entrepots/:id_entrepot/produits/filter?...
       Le statut (disponible / stock bas / rupture) se déduit du stock :
       filtre `statut` = 'rupture' | 'stock_bas' | 'disponible'.
       ============================================================ */
    static async filterProduits(req, res) {
        try {
            const id_entrepot = ProduitEntrepotController._parseId(req.params.id_entrepot, "Entrepôt");
            const id_utilisateur = req.workspaceId;

            await ProduitEntrepotController._checkAccess(id_entrepot, id_utilisateur);

            const produits = await ProduitEntrepot.getAll(id_entrepot);
            const f = req.query;

            const etatStock = (p) => {
                const stock = Number(p.quantite_stock);
                const min = Number(p.quantite_minimale);
                if (stock <= 0) return "rupture";
                if (min > 0 && stock <= min) return "stock_bas";
                return "disponible";
            };

            const resultats = produits.filter((p) => {
                if (f.categorie   && String(p.id_categorie)   !== String(f.categorie))   return false;
                if (f.marque      && String(p.id_marque)      !== String(f.marque))      return false;
                if (f.modele      && String(p.id_modele)      !== String(f.modele))      return false;
                if (f.fournisseur && String(p.id_fournisseur) !== String(f.fournisseur)) return false;
                if (f.statut      && etatStock(p) !== f.statut) return false;
                if (f.stockMin !== undefined && f.stockMin !== "" && Number(p.quantite_stock) < Number(f.stockMin)) return false;
                if (f.stockMax !== undefined && f.stockMax !== "" && Number(p.quantite_stock) > Number(f.stockMax)) return false;
                if (f.prixMin  !== undefined && f.prixMin  !== "" && Number(p.prix_vente)     < Number(f.prixMin))  return false;
                if (f.prixMax  !== undefined && f.prixMax  !== "" && Number(p.prix_vente)     > Number(f.prixMax))  return false;
                return true;
            });

            res.json({
                success: true,
                count: resultats.length,
                produits: resultats,
            });
        } catch (error) {
            ProduitEntrepotController._sendError(res, error, "Erreur lors du filtrage");
        }
    }
}

export default ProduitEntrepotController;