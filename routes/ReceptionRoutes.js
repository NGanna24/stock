// routes/ReceptionRoutes.js
import express from 'express';
import ReceptionController from '../controllers/ReceptionController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES STATISTIQUES ====================
router.get('/stats', authenticateToken, ReceptionController.getStats);

// ==================== ROUTES D'EXPORT ====================
router.get('/export', authenticateToken, ReceptionController.export);

// ==================== ROUTES PAR STATUT ====================
router.get('/statut/:statut', authenticateToken, ReceptionController.getByStatut);

// ==================== ROUTES PAR COMMANDE ====================
router.get('/commande/:id_commande', authenticateToken, ReceptionController.getByCommande);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get('/', authenticateToken, ReceptionController.getAll);
router.get('/:id', authenticateToken, ReceptionController.getById);
router.post('/', authenticateToken, ReceptionController.create);
router.patch('/:id/statut', authenticateToken, ReceptionController.updateStatut);
router.delete('/:id', authenticateToken, ReceptionController.delete);

export default router;