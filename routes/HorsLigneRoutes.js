// routes/HorsLigneRoutes.js
// Mode hors ligne (ventes) : admin, manager, caissier — comme la page Ventes.
import express from 'express';
import HorsLigneController from '../controllers/HorsLigneController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();
// Accès aux pages : selon les permissions du rôle (utils/permissions.js, controleAcces)
const vendeurs = authenticateToken;

router.get('/catalogue', vendeurs, HorsLigneController.catalogue);
router.post('/ventes', vendeurs, HorsLigneController.synchroniser);
router.get('/historique', vendeurs, HorsLigneController.historique);

export default router;
