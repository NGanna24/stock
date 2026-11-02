// routes/CaisseRoutes.js
//
// Caisse journalière.
//   - ouvrir / suivre / clôturer : admin, manager, caissier
//   - historique et détail des journées passées : admin, manager
// ⚠️ Routes statiques (/courante, /ouvrir, /historique) AVANT /:id
import express from 'express';
import CaisseController from '../controllers/CaisseController.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();
const equipe = requireRole('admin', 'manager', 'caissier');
const responsables = requireRole('admin', 'manager');

router.get('/courante', equipe, CaisseController.courante);
router.post('/ouvrir', equipe, CaisseController.ouvrir);
router.get('/historique', responsables, CaisseController.historique);
router.post('/:id/cloturer', equipe, CaisseController.cloturer);
router.get('/:id', responsables, CaisseController.detail);

export default router;
