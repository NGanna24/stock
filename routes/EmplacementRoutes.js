// routes/EmplacementRoutes.js
import express from 'express';
import EmplacementController from '../controllers/EmplacementController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();
router.get('/', authenticateToken, EmplacementController.liste);
router.post('/', authenticateToken, EmplacementController.creer);
router.put('/:id', authenticateToken, EmplacementController.renommer);
router.delete('/:id', authenticateToken, EmplacementController.supprimer);

export default router;
