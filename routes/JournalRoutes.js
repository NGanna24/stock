// routes/JournalRoutes.js
// Journal d'activité : lecture réservée à l'admin (propriétaire du compte).
// ⚠️ Routes statiques AVANT /:id
import express from 'express';
import JournalController from '../controllers/JournalController.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();
const admin = requireRole('admin');

router.get('/', admin, JournalController.lister);
router.get('/facettes', admin, JournalController.facettes);
router.get('/export', admin, JournalController.exporter);
router.get('/:id', admin, JournalController.detail);

export default router;
