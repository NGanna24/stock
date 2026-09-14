// routes/RetourClientRoutes.js
import express from 'express';
import RetourClientController from '../controllers/RetourClientController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES DE RECHERCHE ====================
// ⚠️ IMPORTANT : doit être AVANT /:id
router.get('/search-commande', authenticateToken, RetourClientController.searchCommandeByNumero);

// ==================== ROUTES STATISTIQUES ====================
router.get('/stats', authenticateToken, RetourClientController.getStats);

// ==================== ROUTES D'EXPORT ====================
router.get('/export', authenticateToken, RetourClientController.export);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get('/', authenticateToken, RetourClientController.getAll);
router.get('/:id', authenticateToken, RetourClientController.getById);
router.post('/', authenticateToken, RetourClientController.create);
router.patch('/:id/statut', authenticateToken, RetourClientController.updateStatut);
router.delete('/:id', authenticateToken, RetourClientController.delete);

export default router;