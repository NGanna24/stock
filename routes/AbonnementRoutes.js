// routes/AbonnementRoutes.js : le patron consulte son abonnement
import express from 'express';
import AbonnementController from '../controllers/AbonnementController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();
router.get('/', authenticateToken, AbonnementController.monAbonnement);

export default router;
