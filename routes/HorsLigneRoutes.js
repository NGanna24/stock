// routes/HorsLigneRoutes.js
// Mode hors ligne (ventes) : admin, manager, caissier — comme la page Ventes.
import express from 'express';
import HorsLigneController from '../controllers/HorsLigneController.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();
const vendeurs = requireRole('admin', 'manager', 'caissier');

router.get('/catalogue', vendeurs, HorsLigneController.catalogue);
router.post('/ventes', vendeurs, HorsLigneController.synchroniser);
router.get('/historique', vendeurs, HorsLigneController.historique);

export default router;
