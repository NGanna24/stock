// routes/AlerteRoutes.js
import express from 'express';
import AlerteController from '../controllers/AlerteController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ⚠️ ORDRE IMPORTANT : routes spécifiques AVANT paramétrées
router.get('/', authenticateToken, AlerteController.getAllAlertes);
router.get('/stats', authenticateToken, AlerteController.getStats);
router.get('/ruptures', authenticateToken, AlerteController.getRuptures);
router.get('/stock-bas', authenticateToken, AlerteController.getStockBas);
router.get('/export', authenticateToken, AlerteController.exportAlertes);

export default router; 