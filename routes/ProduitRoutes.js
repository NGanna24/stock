// routes/ProduitRoutes.js
import express from 'express';
import ProduitController from '../controllers/ProduitController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { exigeAction } from '../utils/permissions.js';

// Créer, modifier, supprimer un produit : action réglée par le propriétaire
const modifierProduits = exigeAction('produits.modifier');
import UniteVenteController from '../controllers/UniteVenteController.js';
import ImportProduitController from '../controllers/ImportProduitController.js';
import { uploadExcel } from '../middleware/uploadExcel.js';

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

// Import depuis Excel : fiche à remplir, vérification (rien n'est enregistré), puis import
router.get('/import/modele', authenticateToken, modifierProduits, ImportProduitController.modele);
router.post('/import/apercu', authenticateToken, modifierProduits, uploadExcel, ImportProduitController.apercu);
router.post('/import', authenticateToken, modifierProduits, uploadExcel, ImportProduitController.importer);

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
    modifierProduits,
    ProduitController.createProduit
);

router.put(
    '/:id',
    authenticateToken,
    modifierProduits,
    ProduitController.updateProduit
);

router.patch(
    '/:id/stock',
    authenticateToken,
    modifierProduits,
    ProduitController.updateProduitStock
);

router.patch(
    '/:id/status',
    authenticateToken,
    modifierProduits,
    ProduitController.updateProduitStatus
);

router.delete(
    '/:id',
    authenticateToken,
    modifierProduits,
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