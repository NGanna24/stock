// routes/RelanceClientRoutes.js
// Relances clients (impayés) : admin, manager et caissier.
import express from 'express';
import RelanceClientController from '../controllers/RelanceClientController.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();
const equipe = requireRole('admin', 'manager', 'caissier');

router.get('/', equipe, RelanceClientController.liste);
router.get('/client', equipe, RelanceClientController.detail);
router.post('/', equipe, RelanceClientController.enregistrer);

export default router;
