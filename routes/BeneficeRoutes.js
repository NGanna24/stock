// routes/BeneficeRoutes.js
import express from 'express';
import BeneficeController from '../controllers/BeneficeController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ⚠️ ORDRE IMPORTANT
router.get('/benefices', authenticateToken, BeneficeController.getBenefices);
router.get('/benefices/export', authenticateToken, BeneficeController.exportBenefices);

export default router;