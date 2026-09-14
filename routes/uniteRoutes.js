import express from 'express';
import UniteController from '../controllers/uniteController.js';
import { authenticateToken, authorize, requireRole } from '../middleware/middleware.js';


const router = express.Router();
 
// Routes publiques (authentification requise)
router.get('/', authenticateToken, UniteController.getAllUnites);
router.get('/search', authenticateToken, UniteController.searchUnites);
router.get('/stats', authenticateToken, UniteController.getUnitesStats);
router.get('/export', authenticateToken, UniteController.exportUnites);
router.get('/:id', authenticateToken, UniteController.getUniteById);
router.get('/nom/:nom', authenticateToken, UniteController.getUniteByNom);

// Routes protégées (Manager/Admin uniquement)
router.post('/', authenticateToken,  UniteController.createUnite);
router.put('/:id', authenticateToken,  UniteController.updateUnite);
router.delete('/:id', authenticateToken,  UniteController.deleteUnite);

export default router;