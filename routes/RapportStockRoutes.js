// routes/RapportStockRoutes.js
import express from 'express';
import RapportStockController from '../controllers/RapportStockController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ⚠️ ORDRE IMPORTANT : routes spécifiques AVANT paramétrées
router.get('/stocks', authenticateToken, RapportStockController.getRapportStocks);
router.get('/stocks/export', authenticateToken, RapportStockController.exportRapportStocks);

export default router;