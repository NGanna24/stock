import express from 'express';
import ModeleController from '../controllers/modeleController.js';
import { authenticateToken } from '../middleware/middleware.js';


const router = express.Router();

// Routes CRUD
router.get('/', authenticateToken,ModeleController.getAllModeles);
router.get('/:id', authenticateToken,ModeleController.getModeleById);
router.post('/',authenticateToken, ModeleController.createModele);
router.put('/:id',authenticateToken, ModeleController.updateModele);
router.delete('/:id',authenticateToken, ModeleController.deleteModele);

export default router;