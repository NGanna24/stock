// routes/RelanceClientRoutes.js
// Relances clients (impayés) : admin, manager et caissier.
import express from 'express';
import RelanceClientController from '../controllers/RelanceClientController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();
// Accès aux pages : selon les permissions du rôle (utils/permissions.js, controleAcces)
const equipe = authenticateToken;

router.get('/', equipe, RelanceClientController.liste);
router.get('/client', equipe, RelanceClientController.detail);
router.post('/', equipe, RelanceClientController.enregistrer);

export default router;
