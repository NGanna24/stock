// routes/PaiementRoutes.js
import express from 'express';
import PaiementController from '../controllers/PaiementController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES STATISTIQUES ====================
router.get('/stats', authenticateToken, PaiementController.getStats);

// ==================== ROUTES D'EXPORT ====================
router.get('/export', authenticateToken, PaiementController.export);

// ==================== ROUTES PAR FACTURE ====================
router.get('/facture/:id_facture', authenticateToken, PaiementController.getByFacture);

// ==================== ROUTES PAR COMMANDE ====================
router.get('/commande/:id_commande', authenticateToken, PaiementController.getByCommande);

// ==================== ROUTES PAR MODE ====================
router.get('/mode/:mode', authenticateToken, PaiementController.getByMode);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get('/', authenticateToken, PaiementController.getAll);
router.get('/:id', authenticateToken, PaiementController.getById);
router.post('/', authenticateToken, PaiementController.create);
router.delete('/:id', authenticateToken, PaiementController.delete);

export default router;