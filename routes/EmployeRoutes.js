// routes/EmployeRoutes.js
import express from 'express';
import EmployeController from '../controllers/EmployeController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// ⚠️ IMPORTANT : /stats AVANT /:id (sinon "stats" serait pris comme un ID)
router.get('/stats',  EmployeController.getStats);

router.get('/',        EmployeController.getAll);
router.post('/',       EmployeController.create);

router.get('/:id',     EmployeController.getById);
router.put('/:id',     EmployeController.update);
router.patch('/:id/actif', EmployeController.toggleActivation);
router.delete('/:id',  EmployeController.delete);

export default router;