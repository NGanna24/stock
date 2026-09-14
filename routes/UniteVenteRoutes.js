// routes/UniteVenteRoutes.js
import express from 'express';
import UniteVenteController from '../controllers/UniteVenteController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES CRUD ====================
router.post('/', authenticateToken, UniteVenteController.create);
router.put('/:id', authenticateToken, UniteVenteController.update);
router.delete('/:id', authenticateToken, UniteVenteController.delete);

export default router;