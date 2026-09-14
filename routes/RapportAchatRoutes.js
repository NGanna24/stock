// routes/RapportAchatRoutes.js
import express from 'express';
import RapportAchatController from '../controllers/RapportAchatController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ⚠️ ORDRE IMPORTANT : routes spécifiques AVANT paramétrées
router.get('/achats', authenticateToken, RapportAchatController.getRapportAchats);
router.get('/achats/export', authenticateToken, RapportAchatController.exportRapportAchats);

export default router;