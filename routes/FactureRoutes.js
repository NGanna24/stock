// routes/FactureRoutes.js
import express from 'express';
import FactureController from '../controllers/FactureController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES STATISTIQUES ====================
router.get('/stats', authenticateToken, FactureController.getStats);

// ==================== ROUTES D'EXPORT ====================
router.get('/export', authenticateToken, FactureController.export);

// ==================== ROUTES PAR STATUT ====================
router.get('/statut/:statut', authenticateToken, FactureController.getByStatut);

// ==================== ROUTES PAR CLIENT ====================
router.get('/commande/:id_commande', authenticateToken, FactureController.getByCommande);

// ==================== ROUTES DE MISE À JOUR ====================
router.patch('/:id/statut', authenticateToken, FactureController.updateStatut);
router.patch('/:id/echeance', authenticateToken, FactureController.updateEcheance);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get('/', authenticateToken, FactureController.getAll);
router.get('/:id', authenticateToken, FactureController.getById);
router.post('/', authenticateToken, FactureController.create);
router.delete('/:id', authenticateToken, FactureController.delete);

export default router;