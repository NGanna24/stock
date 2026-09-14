// routes/ProduitRoutes.js
import express from 'express';
import ProduitController from '../controllers/ProduitController.js';
import { authenticateToken } from '../middleware/middleware.js';
import UniteVenteController from '../controllers/UniteVenteController.js';

const router = express.Router();

// ============================================================
// ⚠️ ORDRE IMPORTANT : STATIQUES → PARAMÉTRÉES → CRUD
// Les routes avec segment fixe DOIVENT être avant /:id
// ============================================================

// ==================== ROUTES STATIQUES ====================

router.get('/', authenticateToken, ProduitController.getAllProduits);
router.get('/search', authenticateToken, ProduitController.searchProduits);
router.get('/stats', authenticateToken, ProduitController.getProduitsStats);
router.get('/export', authenticateToken, ProduitController.exportProduits);
router.get('/filter', authenticateToken, ProduitController.filterProduits);

// Routes par statut
router.get('/rupture', authenticateToken, ProduitController.getProduitsRupture);
router.get('/stock-bas', authenticateToken, ProduitController.getProduitsStockBas);
router.get('/statut/:statut', authenticateToken, ProduitController.getProduitsByStatut);

// ==================== ROUTES PAR RELATION ====================

router.get(
    '/categorie/:idCategorie',
    authenticateToken,
    ProduitController.getProduitsByCategorie
);

router.get(
    '/marque/:idMarque',
    authenticateToken,
    ProduitController.getProduitsByMarque
);

router.get(
    '/fournisseur/:idFournisseur',
    authenticateToken,
    ProduitController.getProduitsByFournisseur
);

// ⚠️ TRÈS IMPORTANT : /modele-id AVANT /modele/:modele
// Sinon "modele-id" serait capturé comme :modele
router.get(
    '/modele-id/:id_modele',
    authenticateToken,
    ProduitController.getByModeleId
);

// ✅ Cette route utilise :modele (et non :idModele)
router.get(
    '/modele/:modele',
    authenticateToken,
    ProduitController.getProduitsByModele
);

// ==================== ROUTES PAR PLAGE ====================

router.get(
    '/prix/:prixMin/:prixMax',
    authenticateToken,
    ProduitController.getProduitsByPrixRange
);

router.get(
    '/stock/:stockMin/:stockMax',
    authenticateToken,
    ProduitController.getProduitsByStockRange
);

// ==================== ROUTES CRUD ====================

router.post(
    '/',
    authenticateToken,
    ProduitController.createProduit
);

router.put(
    '/:id',
    authenticateToken,
    ProduitController.updateProduit
);

router.patch(
    '/:id/stock',
    authenticateToken,
    ProduitController.updateProduitStock
);

router.patch(
    '/:id/status',
    authenticateToken,
    ProduitController.updateProduitStatus
);

router.delete(
    '/:id',
    authenticateToken,
    ProduitController.deleteProduit
);

// ============================================================
// ⚠️⚠️ ROUTE DYNAMIQUE GÉNÉRIQUE - TOUJOURS EN DERNIER ⚠️⚠️
// ============================================================
router.get(
    '/:id',
    authenticateToken,
    ProduitController.getProduitById
);

router.get(
    '/:id_produit/unites-vente',
    authenticateToken,
    UniteVenteController.getByProduit
);

export default router;