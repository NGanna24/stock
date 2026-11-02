// routes/categories.js
import express from 'express';
import CategorieController from '../controllers/CategorieController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

// Mêmes profils que ceux qui voient la page Catégories dans le menu
const peutModifier = requireRole('admin', 'manager', 'magasinier');

const router = express.Router();

// ✅ Middleware d'authentification pour TOUTES les routes
router.use(authenticateToken);

// =============================================================================
// ROUTES PUBLIQUES (authentification requise)
// =============================================================================

router.get('/', CategorieController.getAllCategories);
router.get('/search', CategorieController.searchCategories);
router.get('/stats', CategorieController.getCategoryStats);
router.get('/export', CategorieController.exportCategories);
router.get('/:id', CategorieController.getCategoryById);

// =============================================================================
// ROUTES PROTÉGÉES (admin, manager, magasinier)
// =============================================================================

// ✅ Une seule route POST (au lieu de 2)
router.post(
    '/',
    peutModifier,
    CategorieController.createCategory
);

router.put(
    '/:id',
    peutModifier,
    CategorieController.updateCategory
);

router.patch(
    '/:id/status',
    peutModifier,
    CategorieController.updateCategoryStatus
);

router.delete(
    '/:id',
    peutModifier,
    CategorieController.deleteCategory
);

export default router;