// controllers/ProduitController.js
import Produit from '../models/Produit.js';
import Modele from '../models/Modele.js';
import UniteVente from '../models/UniteVente.js';
import { pool } from '../config/db.js';

class ProduitController {
/**
 * ============================================================
 * Récupérer tous les produits du workspace (AVEC unités de vente)
 * ============================================================
 */
static async getAllProduits(req, res) {
try {
    const produits = await Produit.findAll(req.workspaceId);

    // ✅ Charger les unités de vente pour chaque produit
    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch (err) {
                console.error(`Erreur unités produit ${produit.id_produit}:`, err.message);
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getAllProduits:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer un produit par ID (AVEC unités de vente)
 * ============================================================
 */
static async getProduitById(req, res) {
try {
    const { id } = req.params;
    const produit = await Produit.findById(id, req.workspaceId);

    if (!produit) {
        return res.status(404).json({
            success: false,
            message: 'Produit non trouvé'
        });
    }

    // ✅ Charger les unités de vente
    const unites = await UniteVente.findByProduit(id, req.workspaceId);

    res.status(200).json({
        success: true,
        data: {
            ...produit,
            unites_vente: unites
        }
    });
} catch (error) {
    console.error('❌ Erreur getProduitById:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du produit',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par catégorie
 * ============================================================
 */
static async getProduitsByCategorie(req, res) {
try {
    const { idCategorie } = req.params;
    const produits = await Produit.findByCategorie(idCategorie, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByCategorie:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par catégorie',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par marque
 * ============================================================
 */
static async getProduitsByMarque(req, res) {
try {
    const { idMarque } = req.params;
    const produits = await Produit.findByMarque(idMarque, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByMarque:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par marque',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par fournisseur
 * ============================================================
 */
static async getProduitsByFournisseur(req, res) {
try {
    const { idFournisseur } = req.params;
    const produits = await Produit.findByFournisseur(idFournisseur, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByFournisseur:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par fournisseur',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits en rupture
 * ============================================================
 */
static async getProduitsRupture(req, res) {
try {
    const produits = await Produit.findRupture(req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsRupture:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits en rupture',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits avec stock bas
 * ============================================================
 */
static async getProduitsStockBas(req, res) {
try {
    const produits = await Produit.findStockBas(req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsStockBas:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits avec stock bas',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * ✅ Créer un nouveau produit + ses unités de vente
 *    + Vérification anti-doublon (nom + modèle + marque)
 * ============================================================
 */
static async createProduit(req, res) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const data = req.body;
        const { unites_vente = [] } = data;

        // ============================================================
        // 1. VALIDATIONS DE BASE
        // ============================================================
        if (!data.nom || data.nom.trim() === '') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Le nom du produit est requis'
            });
        }

        if (!data.id_fournisseur) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Le fournisseur est requis'
            });
        }

        // Validation des unités de vente
        for (const unite of unites_vente) {
            if (!unite.nom || !unite.nom.trim()) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Toutes les unités de vente doivent avoir un nom'
                });
            }
            if (!unite.quantite_base || parseFloat(unite.quantite_base) <= 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `La quantité de base de "${unite.nom}" doit être supérieure à 0`
                });
            }
            if (!unite.prix_vente || parseFloat(unite.prix_vente) <= 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Le prix de vente de "${unite.nom}" doit être supérieur à 0`
                });
            }
        }

        // ============================================================
        // 2. ✅ VÉRIFICATION ANTI-DOUBLON (nom + modèle + marque)
        // ============================================================
        const nomNormalise = data.nom.trim();
        const idModele = data.id_modele ? parseInt(data.id_modele) : null;
        const idMarque = data.id_marque ? parseInt(data.id_marque) : null;

        const doublon = await Produit.findDuplicate({
            nom: nomNormalise,
            idModele,
            idMarque,
            id_utilisateur: req.workspaceId
        });

        if (doublon) {
            await connection.rollback();

            // ✅ Construction d'un message clair et précis
            const details = [];
            if (doublon.modele_nom) details.push(`modèle "${doublon.modele_nom}"`);
            if (doublon.marque_nom) details.push(`marque "${doublon.marque_nom}"`);

            const detailsStr = details.length > 0
                ? ` (${details.join(', ')})`
                : '';

            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_PRODUIT',
                message: `Un produit nommé "${nomNormalise}"${detailsStr} existe déjà.`,
                existing: {
                    id: doublon.id_produit,
                    nom: doublon.nom,
                    modele_nom: doublon.modele_nom || null,
                    marque_nom: doublon.marque_nom || null
                }
            });
        }

        // ============================================================
        // 3. CRÉER LE PRODUIT
        // ============================================================
        const id = await Produit.create(data, req.workspaceId);

        // ============================================================
        // 4. CRÉER LES UNITÉS DE VENTE
        // ============================================================
        for (const unite of unites_vente) {
            await UniteVente.create(
                {
                    id_produit: id,
                    nom: unite.nom,
                    quantite_base: unite.quantite_base,
                    prix_vente: unite.prix_vente,
                    prix_achat: unite.prix_achat || 0,
                    est_principal: unite.est_principal || false
                },
                req.workspaceId,
                connection
            );
        }

        await connection.commit();

        // ============================================================
        // 5. RÉCUPÉRER LE PRODUIT COMPLET
        // ============================================================
        const newProduit = await Produit.findById(id, req.workspaceId);
        const unitesCreees = await UniteVente.findByProduit(id, req.workspaceId);

        res.status(201).json({
            success: true,
            message: 'Produit créé avec succès',
            data: {
                ...newProduit,
                unites_vente: unitesCreees
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur createProduit:', error);

        res.status(500).json({
            success: false,
            message: error.message || 'Erreur lors de la création du produit',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
}

/**
 * ============================================================
 * ✅ Mettre à jour un produit + ses unités de vente
 * ============================================================
 */
/**
 * ============================================================
 * ✅ Mettre à jour un produit + ses unités de vente
 *    + Vérification anti-doublon (nom + modèle)
 * ============================================================
 */
static async updateProduit(req, res) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const data = req.body;
        const {
            unites_vente = [],
            unites_vente_deleted = []
        } = data;

        // ========== VALIDATIONS ==========
        if (!data.nom || data.nom.trim() === '') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Le nom du produit est requis'
            });
        }

        if (!data.id_fournisseur) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Le fournisseur est requis'
            });
        }

        // ✅ Vérifier que le produit existe
        const exists = await Produit.exists(id, req.workspaceId);
        if (!exists) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Produit non trouvé'
            });
        }

        // ══════════════════════════════════════════════════════
        // ✅ AJOUT : VÉRIFICATION ANTI-DOUBLON (exclure soi-même)
        // ══════════════════════════════════════════════════════
        const nomNormalise = data.nom.trim();
        const idModele = data.id_modele ? parseInt(data.id_modele) : null;

        const doublon = await Produit.findDuplicate({
            nom: nomNormalise,
            idModele,
            id_utilisateur: req.workspaceId,
            excludeId: parseInt(id) // ← on s'exclut soi-même
        });

        if (doublon) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_PRODUIT',
                message: idModele
                    ? `Un autre produit nommé "${nomNormalise}" avec ce modèle existe déjà (ID #${doublon.id_produit}).`
                    : `Un autre produit nommé "${nomNormalise}" (sans modèle) existe déjà (ID #${doublon.id_produit}).`,
                existing_id: doublon.id_produit
            });
        }
        // ══════════════════════════════════════════════════════

        // ✅ Vérifier les unités de vente
        if (unites_vente && unites_vente.length > 0) {
            for (const unite of unites_vente) {
                if (!unite.nom || !unite.nom.trim()) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Toutes les unités de vente doivent avoir un nom'
                    });
                }
                if (!unite.quantite_base || parseFloat(unite.quantite_base) <= 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: `La quantité de base de "${unite.nom}" doit être supérieure à 0`
                    });
                }
                if (!unite.prix_vente || parseFloat(unite.prix_vente) <= 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: `Le prix de vente de "${unite.nom}" doit être supérieur à 0`
                    });
                }
            }
        }

        // ========== 1. METTRE À JOUR LE PRODUIT ==========
        const updated = await Produit.update(id, data, req.workspaceId);

        if (!updated) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Aucune modification effectuée'
            });
        }

        // ========== 2. SYNCHRONISER LES UNITÉS DE VENTE ==========
        await UniteVente.syncForProduit(
            parseInt(id),
            unites_vente,
            unites_vente_deleted,
            req.workspaceId,
            connection
        );

        await connection.commit();

        // ========== 3. RÉCUPÉRER LE PRODUIT COMPLET ==========
        const produit = await Produit.findById(id, req.workspaceId);
        const unites = await UniteVente.findByProduit(id, req.workspaceId);

        res.status(200).json({
            success: true,
            message: 'Produit mis à jour avec succès',
            data: {
                ...produit,
                unites_vente: unites
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur updateProduit:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur lors de la mise à jour du produit',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
}
/**
 * ============================================================
 * Mettre à jour le stock d'un produit
 * ============================================================
 */
static async updateProduitStock(req, res) {
try {
    const { id } = req.params;
    const { quantite } = req.body;

    if (quantite === undefined || quantite < 0) {
        return res.status(400).json({
            success: false,
            message: 'La quantité doit être un nombre positif'
        });
    }

    const exists = await Produit.exists(id, req.workspaceId);
    if (!exists) {
        return res.status(404).json({
            success: false,
            message: 'Produit non trouvé'
        });
    }

    const updated = await Produit.updateStock(id, quantite, req.workspaceId);

    if (updated) {
        const produit = await Produit.findById(id, req.workspaceId);
        const unites = await UniteVente.findByProduit(id, req.workspaceId);

        res.status(200).json({
            success: true,
            message: 'Stock mis à jour avec succès',
            data: {
                ...produit,
                unites_vente: unites
            }
        });
    } else {
        res.status(400).json({
            success: false,
            message: 'Erreur lors de la mise à jour du stock'
        });
    }
} catch (error) {
    console.error('❌ Erreur updateProduitStock:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la mise à jour du stock',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Mettre à jour le statut d'un produit
 * ============================================================
 */
static async updateProduitStatus(req, res) {
try {
    const { id } = req.params;
    const { statut } = req.body;

    if (!statut || !['disponible', 'rupture'].includes(statut)) {
        return res.status(400).json({
            success: false,
            message: 'Le statut doit être "disponible" ou "rupture"'
        });
    }

    const exists = await Produit.exists(id, req.workspaceId);
    if (!exists) {
        return res.status(404).json({
            success: false,
            message: 'Produit non trouvé'
        });
    }

    const updated = await Produit.updateStatus(id, statut, req.workspaceId);

    if (updated) {
        const produit = await Produit.findById(id, req.workspaceId);
        res.status(200).json({
            success: true,
            message: 'Statut du produit mis à jour avec succès',
            data: produit
        });
    } else {
        res.status(400).json({
            success: false,
            message: 'Erreur lors de la mise à jour du statut'
        });
    }
} catch (error) {
    console.error('❌ Erreur updateProduitStatus:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la mise à jour du statut',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * ✅ Supprimer un produit + ses unités de vente (cascade BDD)
 * ============================================================
 */
static async deleteProduit(req, res) {
try {
    const { id } = req.params;

    const exists = await Produit.exists(id, req.workspaceId);
    if (!exists) {
        return res.status(404).json({
            success: false,
            message: 'Produit non trouvé'
        });
    }

    // ✅ Les unités de vente sont supprimées automatiquement
    // grâce à ON DELETE CASCADE dans la BDD
    const deleted = await Produit.delete(id, req.workspaceId);

    if (deleted) {
        res.status(200).json({
            success: true,
            message: 'Produit supprimé avec succès'
        });
    } else {
        res.status(400).json({
            success: false,
            message: 'Erreur lors de la suppression du produit'
        });
    }
} catch (error) {
    console.error('❌ Erreur deleteProduit:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression du produit',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Rechercher des produits (par mot-clé)
 * ============================================================
 */
static async searchProduits(req, res) {
try {
    const { keyword, q } = req.query;
    const searchTerm = (keyword || q || '').trim();

    if (!searchTerm) {
        const produits = await Produit.findAll(req.workspaceId);
        return res.status(200).json({
            success: true,
            count: produits.length,
            data: produits
        });
    }

    const produits = await Produit.search(searchTerm, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur searchProduits:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la recherche des produits',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Statistiques des produits (workspace)
 * ============================================================
 */
static async getProduitsStats(req, res) {
try {
    const stats = await Produit.getStats(req.workspaceId);
    res.status(200).json({
        success: true,
        data: stats
    });
} catch (error) {
    console.error('❌ Erreur getProduitsStats:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Exporter les produits du workspace en CSV
 * ============================================================
 */
static async exportProduits(req, res) {
try {
    const produits = await Produit.findAll(req.workspaceId);

    const headers = [
        'ID', 'Nom', 'Description', 'Fournisseur', 'Catégorie',
        'Marque', 'Modèle', 'Unité', "Prix d'achat", 'Prix de vente',
        'Stock', 'Stock Min', 'Stock Max', 'Emplacement', 'Rayon',
        'Étagère', 'Statut', 'Date de création'
    ];

    const rows = produits.map(p => [
        p.id_produit,
        p.nom,
        p.description || '',
        p.fournisseur_nom || '',
        p.categorie_nom || '',
        p.marque_nom || '',
        p.modele_nom || '',
        p.unite_nom || '',
        p.prix_achat || 0,
        p.prix_vente || 0,
        p.quantite_stock || 0,
        p.quantite_minimale || 0,
        p.quantite_maximale || 0,
        p.emplacement || '',
        p.rayon || '',
        p.etagere || '',
        p.statut || '',
        p.date_creation ? new Date(p.date_creation).toLocaleDateString('fr-FR') : ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv;charset=utf-8');
    res.setHeader(
        'Content-Disposition',
        `attachment; filename=produits_${new Date().toISOString().split('T')[0]}.csv`
    );
    res.status(200).send(csvContent);
} catch (error) {
    console.error('❌ Erreur exportProduits:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'exportation des produits',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Filtrer les produits avec des critères avancés
 * ============================================================
 */
static async filterProduits(req, res) {
try {
    const produits = await Produit.filter(req.query, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites,
        filters: req.query
    });
} catch (error) {
    console.error('❌ Erreur filterProduits:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors du filtrage des produits',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par nom de modèle
 * ============================================================
 */
static async getProduitsByModele(req, res) {
try {
    const { modele } = req.params;

    if (!modele || modele.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Le nom du modèle est obligatoire'
        });
    }

    const produits = await Produit.findByModele(modele, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    return res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByModele:', error);
    return res.status(500).json({
        success: false,
        message: 'Erreur lors de la recherche des produits par modèle',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par ID de modèle
 * ============================================================
 */
static async getByModeleId(req, res) {
try {
    const { id_modele } = req.params;

    if (!id_modele || isNaN(id_modele)) {
        return res.status(400).json({
            success: false,
            message: 'ID de modèle invalide'
        });
    }

    const modele = await Modele.findById(id_modele, req.workspaceId);
    if (!modele) {
        return res.status(404).json({
            success: false,
            message: 'Modèle non trouvé'
        });
    }

    const produits = await Produit.findByModeleId(parseInt(id_modele), req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    return res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        modele: modele.nom,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getByModeleId:', error);
    return res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par modèle',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par statut
 * ============================================================
 */
static async getProduitsByStatut(req, res) {
try {
    const { statut } = req.params;
    const produits = await Produit.findByStatut(statut, req.workspaceId);

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByStatut:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par statut',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par plage de prix
 * ============================================================
 */
static async getProduitsByPrixRange(req, res) {
try {
    const { prixMin, prixMax } = req.params;
    const produits = await Produit.findByPrixRange(
        parseFloat(prixMin),
        parseFloat(prixMax),
        req.workspaceId
    );

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByPrixRange:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par plage de prix',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}

/**
 * ============================================================
 * Récupérer les produits par plage de stock
 * ============================================================
 */
static async getProduitsByStockRange(req, res) {
try {
    const { stockMin, stockMax } = req.params;
    const produits = await Produit.findByStockRange(
        parseFloat(stockMin),
        parseFloat(stockMax),
        req.workspaceId
    );

    const produitsAvecUnites = await Promise.all(
        produits.map(async (produit) => {
            try {
                const unites = await UniteVente.findByProduit(
                    produit.id_produit,
                    req.workspaceId
                );
                return { ...produit, unites_vente: unites };
            } catch {
                return { ...produit, unites_vente: [] };
            }
        })
    );

    res.status(200).json({
        success: true,
        count: produitsAvecUnites.length,
        data: produitsAvecUnites
    });
} catch (error) {
    console.error('❌ Erreur getProduitsByStockRange:', error);
    res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des produits par plage de stock',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
}
}

export default ProduitController;