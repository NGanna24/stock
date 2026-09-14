// routes/RecetteRoutes.js
import express from 'express';
import RecetteController from '../controllers/RecetteController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ⚠️ ORDRE IMPORTANT : routes spécifiques AVANT paramétrées
router.get('/', authenticateToken, RecetteController.getAllRecettes);
router.get('/stats', authenticateToken, RecetteController.getStats);
router.get('/factures-impayees', authenticateToken, RecetteController.getFacturesImpayees);
router.get('/export', authenticateToken, RecetteController.exportRecettes);

// CRUD
router.post('/', authenticateToken, RecetteController.createRecette);
router.delete('/:id', authenticateToken, RecetteController.deleteRecette);

export default router;