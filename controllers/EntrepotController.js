// controllers/EntrepotController.js
import Entrepot from '../models/Entrepot.js';
import ProduitEntrepot from '../models/ProduitEntrepot.js';
import StockEntrepot from '../models/StockEntrepot.js';
import Magasin from '../models/Magasin.js';

class EntrepotController {
    /* ============================================================
       Créer un entrepôt
       POST /api/entrepots
       ============================================================ */
    static async create(req, res) {
        try {
            const { nom, adresse, ville, pays, code_postal } = req.body;
            if (!nom || !nom.trim()) {
                return res.status(400).json({ success: false, message: 'Le nom de l\'entrepôt est requis' });
            }
            const entrepot = await Entrepot.create(
                { nom, adresse, ville, pays, code_postal },
                req.workspaceId
            );
            return res.status(201).json({ success: true, message: 'Entrepôt créé avec succès', data: entrepot });
        } catch (error) {
            console.error('❌ Create entrepot error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Erreur lors de la création de l\'entrepôt' });
        }
    }

    /* ============================================================
       Rejoindre un entrepôt via son code d'accès
       POST /api/entrepots/rejoindre
       ============================================================ */
    static async rejoindre(req, res) {
        try {
            const { code_acces } = req.body;
            if (!code_acces || !code_acces.trim()) {
                return res.status(400).json({ success: false, message: 'Le code d\'accès est requis' });
            }
            const entrepot = await Entrepot.joinByCode(code_acces, req.workspaceId);
            return res.status(200).json({
                success: true,
                message: `Vous avez rejoint l'entrepôt "${entrepot.nom}"`,
                data: entrepot,
            });
        } catch (error) {
            console.error('❌ Join entrepot error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors de l\'adhésion à l\'entrepôt' });
        }
    }

    /* ============================================================
       Lister mes entrepôts
       GET /api/entrepots
       ============================================================ */
    static async getMesEntrepots(req, res) {
        try {
            const entrepots = await Entrepot.findAllByUser(req.workspaceId);
            return res.status(200).json({ success: true, count: entrepots.length, data: entrepots });
        } catch (error) {
            console.error('❌ Get mes entrepots error:', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des entrepôts' });
        }
    }

    /* ============================================================
       Récupérer un entrepôt par ID
       GET /api/entrepots/:id
       ============================================================ */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const entrepot = await Entrepot.findById(id, req.workspaceId);
            if (!entrepot) {
                return res.status(404).json({ success: false, message: 'Entrepôt introuvable ou accès refusé' });
            }
            return res.status(200).json({ success: true, data: entrepot });
        } catch (error) {
            console.error('❌ Get entrepot error:', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération de l\'entrepôt' });
        }
    }

    /* ============================================================
       Mettre à jour un entrepôt (propriétaire)
       PUT /api/entrepots/:id
       ============================================================ */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const entrepot = await Entrepot.update(id, req.body, req.workspaceId);
            return res.status(200).json({ success: true, message: 'Entrepôt mis à jour', data: entrepot });
        } catch (error) {
            console.error('❌ Update entrepot error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors de la mise à jour' });
        }
    }

    /* ============================================================
       Régénérer le code d'accès
       POST /api/entrepots/:id/regenerer-code
       ============================================================ */
    static async regenererCode(req, res) {
        try {
            const { id } = req.params;
            const nouveauCode = await Entrepot.regenererCodeAcces(id, req.workspaceId);
            return res.status(200).json({
                success: true,
                message: 'Code d\'accès régénéré',
                data: { code_acces: nouveauCode },
            });
        } catch (error) {
            console.error('❌ Regenerer code error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors de la régénération du code' });
        }
    }

    /* ============================================================
       Lister les membres d'un entrepôt
       GET /api/entrepots/:id/membres
       ============================================================ */
    static async getMembres(req, res) {
        try {
            const { id } = req.params;
            const membres = await Entrepot.findMembres(id, req.workspaceId);
            return res.status(200).json({ success: true, count: membres.length, data: membres });
        } catch (error) {
            console.error('❌ Get membres error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors de la récupération des membres' });
        }
    }

    /* ============================================================
       Retirer un membre
       DELETE /api/entrepots/:id/membres/:idMembre
       ============================================================ */
    static async retirerMembre(req, res) {
        try {
            const { id, idMembre } = req.params;
            await Entrepot.retirerMembre(id, idMembre, req.workspaceId);
            return res.status(200).json({ success: true, message: 'Membre retiré de l\'entrepôt' });
        } catch (error) {
            console.error('❌ Retirer membre error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors du retrait du membre' });
        }
    }

    /* ============================================================
       Partager un produit dans l'entrepôt
       POST /api/entrepots/:id/produits
       ============================================================ */
    static async partagerProduit(req, res) {
        try {
            const { id } = req.params;
            const { id_produit } = req.body;

            if (!id_produit) {
                return res.status(400).json({ success: false, message: 'id_produit est requis' });
            }

            const partage = await ProduitEntrepot.partager(
                parseInt(id_produit),
                parseInt(id),
                req.workspaceId
            );

            return res.status(201).json({
                success: true,
                message: 'Produit partagé avec succès',
                data: partage,
            });
        } catch (error) {
            console.error('❌ Partager produit error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors du partage du produit' });
        }
    }

    /* ============================================================
       Lister les produits partagés d'un entrepôt
       GET /api/entrepots/:id/produits
       ============================================================ */
    static async getProduits(req, res) {
        try {
            const { id } = req.params;
            const estMembre = await Entrepot.isMembre(id, req.workspaceId);
            if (!estMembre) {
                return res.status(403).json({ success: false, message: 'Accès refusé à cet entrepôt' });
            }
            const produits = await ProduitEntrepot.findByEntrepot(id);
            return res.status(200).json({ success: true, count: produits.length, data: produits });
        } catch (error) {
            console.error('❌ Get produits entrepot error:', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des produits' });
        }
    }

    /* ============================================================
       Retirer un produit du partage
       DELETE /api/entrepots/:id/produits/:idProduit
       ============================================================ */
    static async retirerProduit(req, res) {
        try {
            const { id, idProduit } = req.params;
            await ProduitEntrepot.retirerPartage(idProduit, id, req.workspaceId);
            return res.status(200).json({ success: true, message: 'Produit retiré du partage' });
        } catch (error) {
            console.error('❌ Retirer produit error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors du retrait du produit' });
        }
    }

    /* ============================================================
       Voir le stock d'un entrepôt
       GET /api/entrepots/:id/stock
       ============================================================ */
    static async getStock(req, res) {
        try {
            const { id } = req.params;
            const estMembre = await Entrepot.isMembre(id, req.workspaceId);
            if (!estMembre) {
                return res.status(403).json({ success: false, message: 'Accès refusé' });
            }
            const stock = await StockEntrepot.findByEntrepot(id);
            return res.status(200).json({ success: true, count: stock.length, data: stock });
        } catch (error) {
            console.error('❌ Get stock entrepot error:', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération du stock' });
        }
    }

    /* ============================================================
       Ajouter du stock manuellement dans un entrepôt
       POST /api/entrepots/:id/stock
       Réservé au propriétaire
       Corps : {
         id_produit, quantite,
         id_unite_vente?, nom_unite_vente?, quantite_base?,
         num_lot?, date_peremption?, notes?,
         emplacement?, rayon?, etagere?
       }
       ============================================================ */
    static async ajouterStock(req, res) {
        try {
            const { id } = req.params;
            const {
                id_produit,
                quantite,
                id_unite_vente = null,
                nom_unite_vente = 'Unité',
                quantite_base = 1,
                num_lot = null,
                date_peremption = null,
                notes = null,
                emplacement = null,
                rayon = null,
                etagere = null,
            } = req.body;

            /* -------- Validations -------- */
            if (!id_produit) {
                return res.status(400).json({ success: false, message: 'id_produit est requis' });
            }
            const qte = parseFloat(quantite);
            if (!qte || qte <= 0) {
                return res.status(400).json({ success: false, message: 'La quantité doit être strictement positive' });
            }

            const qteBaseUnite = parseFloat(quantite_base) || 1;
            if (qteBaseUnite <= 0) {
                return res.status(400).json({ success: false, message: 'quantite_base doit être > 0' });
            }
            const quantiteTotaleBase = qte * qteBaseUnite;

            /* -------- Sécurité : seul le propriétaire peut ajouter -------- */
            const isProprio = await Entrepot.isProprietaire(id, req.workspaceId);
            if (!isProprio) {
                return res.status(403).json({ success: false, message: 'Seul le propriétaire de l\'entrepôt peut ajouter du stock' });
            }

            /* -------- Le produit doit être partagé -------- */
            const partages = await ProduitEntrepot.findByEntrepot(id);
            const partage = partages.find(
                (p) => p.id_produit === parseInt(id_produit)
            );
            if (!partage) {
                return res.status(400).json({
                    success: false,
                    message: 'Ce produit n\'est pas partagé dans cet entrepôt. Partagez-le d\'abord.',
                });
            }

            /* -------- Si id_unite_vente fourni, valider + récupérer quantite_base -------- */
            let nomUniteFinal = nom_unite_vente;
            let qteBaseFinale = qteBaseUnite;
            let idUniteFinal = null;

            if (id_unite_vente) {
                const unite = (partage.unites_vente || []).find(
                    (u) => u.id_unite_vente === parseInt(id_unite_vente)
                );
                if (!unite) {
                    return res.status(400).json({ success: false, message: 'Unité de vente invalide pour ce produit' });
                }
                idUniteFinal = unite.id_unite_vente;
                nomUniteFinal = unite.nom;
                qteBaseFinale = parseFloat(unite.quantite_base) || 1;
            }

            /* -------- Entrée de stock (transaction) -------- */
            const result = await StockEntrepot.entreeManuelle({
                id_entrepot: parseInt(id),
                id_produit: parseInt(id_produit),
                id_utilisateur: req.workspaceId,
                quantite_base: qte * qteBaseFinale,
                id_unite_vente: idUniteFinal,
                nom_unite_vente: nomUniteFinal,
                quantite_saisie: qte,
                quantite_base_unite: qteBaseFinale,
                num_lot,
                date_peremption,
                notes,
                emplacement,
                rayon,
                etagere,
            });

            return res.status(201).json({ success: true, message: 'Stock ajouté avec succès', data: result });
        } catch (error) {
            console.error('❌ Ajouter stock entrepot error:', error);
            return res.status(400).json({ success: false, message: error.message || 'Erreur lors de l\'ajout du stock' });
        }
    }
}

export default EntrepotController;