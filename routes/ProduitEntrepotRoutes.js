// routes/ProduitEntrepotRoutes.js
import express from 'express';
import ProduitEntrepotController from '../controllers/ProduitEntrepotController.js';
import UniteVenteEntrepotController from '../controllers/UniteVenteEntrepotController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ============================================================
// CATALOGUE DE L'ENTREPÔT
// Les produits d'entrepôt sont indépendants des produits du magasin :
// aucune route d'import depuis le magasin. Le seul pont entre les deux
// est le transfert (module transferts).
//
// ⚠️ ORDRE IMPORTANT : STATIQUES → PARAMÉTRÉES → CRUD
// Les routes avec segment fixe DOIVENT être avant /:id_produit_entrepot
// ============================================================

// ==================== ROUTES STATIQUES ====================

router.get(
    '/entrepots/:id_entrepot/produits',
    authenticateToken,
    ProduitEntrepotController.getAllProduits
);

router.get(
    '/entrepots/:id_entrepot/produits/search',
    authenticateToken,
    ProduitEntrepotController.searchProduits
);

router.get(
    '/entrepots/:id_entrepot/produits/stats',
    authenticateToken,
    ProduitEntrepotController.getProduitsStats
);

router.get(
    '/entrepots/:id_entrepot/produits/filter',
    authenticateToken,
    ProduitEntrepotController.filterProduits
);

// ==================== CRÉATION ====================

router.post(
    '/entrepots/:id_entrepot/produits',
    authenticateToken,
    ProduitEntrepotController.createProduit
);

// ==================== UNITÉS DE VENTE ENTREPÔT ====================
// ⚠️ AVANT la route générique /:id_produit_entrepot pour rester lisible

router.get(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente',
    authenticateToken,
    UniteVenteEntrepotController.getByProduitEntrepot
);

router.post(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente',
    authenticateToken,
    UniteVenteEntrepotController.create
);

router.put(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente/:id',
    authenticateToken,
    UniteVenteEntrepotController.update
);

router.delete(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot/unites-vente/:id',
    authenticateToken,
    UniteVenteEntrepotController.delete
);

// ==================== STOCK (PATCH rapide) ====================

router.patch(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot/stock',
    authenticateToken,
    ProduitEntrepotController.updateStock
);

// ==================== UPDATE / DELETE ====================

router.put(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot',
    authenticateToken,
    ProduitEntrepotController.updateProduit
);

router.delete(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot',
    authenticateToken,
    ProduitEntrepotController.deleteProduit
);

// ============================================================
// ⚠️⚠️ ROUTE DYNAMIQUE GÉNÉRIQUE - TOUJOURS EN DERNIER ⚠️⚠️
// ============================================================
router.get(
    '/entrepots/:id_entrepot/produits/:id_produit_entrepot',
    authenticateToken,
    ProduitEntrepotController.getProduitById
);

export default router;