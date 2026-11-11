// routes/ModePaiementRoutes.js
import express from 'express';
import ModePaiementController from '../controllers/ModePaiementController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();
router.get('/', authenticateToken, ModePaiementController.lire);
router.put('/', authenticateToken, ModePaiementController.enregistrer);

export default router;
