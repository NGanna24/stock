// routes/CaisseRoutes.js
//
// Caisse journalière.
//   - ouvrir / suivre / clôturer : admin, manager, caissier
//   - historique et détail des journées passées : admin, manager
// ⚠️ Routes statiques (/courante, /ouvrir, /historique) AVANT /:id
import express from 'express';
import CaisseController from '../controllers/CaisseController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { exigeAction } from '../utils/permissions.js';

const router = express.Router();
// Accès aux pages : selon les permissions du rôle (utils/permissions.js, controleAcces)
const equipe = authenticateToken;
const responsables = exigeAction('caisse.historique');

router.get('/courante', equipe, CaisseController.courante);
router.post('/ouvrir', equipe, CaisseController.ouvrir);
router.get('/historique', responsables, CaisseController.historique);
router.post('/:id/cloturer', equipe, CaisseController.cloturer);
router.get('/:id', responsables, CaisseController.detail);

export default router;
