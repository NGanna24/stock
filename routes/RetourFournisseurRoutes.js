// routes/RetourFournisseurRoutes.js
import express from 'express';
import RetourFournisseurController from '../controllers/RetourFournisseurController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router(); 

// ==================== ROUTES STATISTIQUES ====================
router.get('/stats', authenticateToken, RetourFournisseurController.getStats);

// ==================== ROUTES D'EXPORT ====================
router.get('/export', authenticateToken, RetourFournisseurController.export);

// ==================== ROUTES PAR STATUT ====================
router.get('/statut/:statut', authenticateToken, RetourFournisseurController.getByStatut);

// ==================== ROUTES PAR FOURNISSEUR ====================
router.get('/fournisseur/:id_fournisseur', authenticateToken, RetourFournisseurController.getByFournisseur);

// ==================== ROUTE ANNULATION ====================
router.patch('/:id/annuler', authenticateToken, RetourFournisseurController.annuler);

// ==================== ROUTE STATUT ====================
router.patch('/:id/statut', authenticateToken, RetourFournisseurController.updateStatut);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get('/', authenticateToken, RetourFournisseurController.getAll);
router.get('/:id', authenticateToken, RetourFournisseurController.getById);
router.post('/', authenticateToken, RetourFournisseurController.create);
router.delete('/:id', authenticateToken, RetourFournisseurController.delete);

export default router;