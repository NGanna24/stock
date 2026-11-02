// routes/DetteFournisseurRoutes.js
// Dettes fournisseurs : consulter et payer = admin, manager ; supprimer un paiement = admin.
import express from 'express';
import DetteFournisseurController from '../controllers/DetteFournisseurController.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();
const responsables = requireRole('admin', 'manager');

router.get('/', responsables, DetteFournisseurController.liste);
router.get('/fournisseurs/:id', responsables, DetteFournisseurController.detail);
router.post('/paiements', responsables, DetteFournisseurController.payer);
router.delete('/paiements/:id', requireRole('admin'), DetteFournisseurController.supprimer);

export default router;
