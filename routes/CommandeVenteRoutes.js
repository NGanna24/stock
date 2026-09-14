// routes/CommandeVenteRoutes.js
import express from 'express';
import CommandeVenteController from '../controllers/CommandeVenteController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES STATISTIQUES ====================
router.get('/stats', authenticateToken, CommandeVenteController.getStats);

// ==================== ROUTES D'EXPORT ====================
router.get('/export', authenticateToken, CommandeVenteController.export);

// ==================== ROUTES PAR TÉLÉPHONE ====================
router.get('/telephone/:telephone', authenticateToken, CommandeVenteController.getByTelephone);

// ==================== ROUTES PAR STATUT ====================
router.get('/statut/:statut', authenticateToken, CommandeVenteController.getByStatut);

// ==================== ROUTE ANNULATION ====================
router.patch('/:id/annuler', authenticateToken, CommandeVenteController.annuler);

// ==================== ROUTE STATUT ====================
router.patch('/:id/statut', authenticateToken, CommandeVenteController.updateStatut);

// ==================== ROUTE PAIEMENT ====================
router.post('/:id/paiement', authenticateToken, CommandeVenteController.addPaiement);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get('/', authenticateToken, CommandeVenteController.getAll);
router.get('/:id', authenticateToken, CommandeVenteController.getById);
router.post('/', authenticateToken, CommandeVenteController.create);
router.delete('/:id', authenticateToken, CommandeVenteController.delete);

export default router;