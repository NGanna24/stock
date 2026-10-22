// routes/MagasinAdminRoutes.js
import express from 'express';
import MagasinAdminController from '../controllers/MagasinAdminController.js';

const router = express.Router();

// ⚠️ Sécurité à ajouter plus tard : authenticateToken + requireSuperAdmin

// ⚠️ L'ordre compte : routes statiques AVANT /:id
router.get('/stats',    MagasinAdminController.getStats);
router.get('/filtres',  MagasinAdminController.getFiltres);
router.get('/carte',    MagasinAdminController.getGeolocalises);

router.get('/',         MagasinAdminController.getListe);
router.get('/:id',      MagasinAdminController.getDetail);

router.patch('/:id/toggle',           MagasinAdminController.toggleActif);
router.patch('/:id/geolocalisation',  MagasinAdminController.updateGeolocalisation);



export default router;