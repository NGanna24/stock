// routes/AssistantAchatRoutes.js
import express from 'express';
import AssistantAchatController from '../controllers/AssistantAchatController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

router.use(authenticateToken);

// GET la proposition de réapprovisionnement
router.get('/proposition', AssistantAchatController.getProposition);

// POST créer les bons de commande
router.post('/creer', AssistantAchatController.creerBons);

export default router; 