import express from 'express';
import MarqueController from '../controllers/marqueController.js';
import { authenticateToken, authorize, requireRole } from '../middleware/middleware.js';


const router = express.Router();
 
// Routes publiques (authentification requise)
router.get('/', authenticateToken, MarqueController.getAllMarques);
router.get('/active', authenticateToken, MarqueController.getActiveMarques);
router.get('/search', authenticateToken, MarqueController.searchMarques);
router.get('/stats', authenticateToken, MarqueController.getMarquesStats);
router.get('/export', authenticateToken, MarqueController.exportMarques);
router.get('/:id', authenticateToken, MarqueController.getMarqueById);
router.get('/nom/:nom', authenticateToken, MarqueController.getMarqueByNom);

// Routes protégées (Manager/Admin uniquement)
router.post('/', authenticateToken, MarqueController.createMarque);
router.put('/:id', authenticateToken, MarqueController.updateMarque);
router.patch('/:id/status', authenticateToken, MarqueController.updateMarqueStatus);
router.delete('/:id', authenticateToken, MarqueController.deleteMarque);

export default router;

