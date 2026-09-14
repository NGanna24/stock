// routes/categories.js
import express from 'express';
import CategorieController from '../controllers/CategorieController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';

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
// ROUTES PROTÉGÉES (admin uniquement)
// ⚠️ IMPORTANT : authenticateToken D'ABORD, puis isAdmin
// =============================================================================

// ✅ Une seule route POST (au lieu de 2)
router.post(
    '/',
    isAdmin,                          // ← après authenticateToken (déjà global)
    CategorieController.createCategory
);

router.put(
    '/:id',
    isAdmin,
    CategorieController.updateCategory
);

router.patch(
    '/:id/status',
    isAdmin,
    CategorieController.updateCategoryStatus
);

router.delete(
    '/:id',
    isAdmin,
    CategorieController.deleteCategory
);

export default router;