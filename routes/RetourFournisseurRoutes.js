// routes/RetourFournisseurRoutes.js
import express from 'express';
import RetourFournisseurController from '../controllers/RetourFournisseurController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// Routes statiques AVANT /:id
router.get('/stats', authenticateToken, RetourFournisseurController.getStats);
router.get('/export', authenticateToken, RetourFournisseurController.export);
router.get('/statut/:statut', authenticateToken, RetourFournisseurController.getByStatut);
router.get('/fournisseur/:id_fournisseur', authenticateToken, RetourFournisseurController.getByFournisseur);
router.get('/produits-recus/:id_fournisseur', authenticateToken, RetourFournisseurController.getProduitsRecus);

router.patch('/:id/annuler', authenticateToken, RetourFournisseurController.annuler);
router.patch('/:id/statut', authenticateToken, RetourFournisseurController.updateStatut);

router.get('/', authenticateToken, RetourFournisseurController.getAll);
router.get('/:id', authenticateToken, RetourFournisseurController.getById);
router.post('/', authenticateToken, RetourFournisseurController.create);
router.delete('/:id', authenticateToken, RetourFournisseurController.delete);

export default router;