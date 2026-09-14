// routes/RapportVenteRoutes.js
import express from 'express';
import RapportVenteController from '../controllers/RapportVenteController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ⚠️ ORDRE IMPORTANT : routes spécifiques AVANT paramétrées
router.get('/ventes', authenticateToken, RapportVenteController.getRapportVentes);
router.get('/ventes/export', authenticateToken, RapportVenteController.exportRapportVentes);

export default router;