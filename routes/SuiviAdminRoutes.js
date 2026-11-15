// routes/SuiviAdminRoutes.js — /api/super-admin/suivi (jeton super admin obligatoire)
import express from 'express';
import SuiviAdminController from '../controllers/SuiviAdminController.js';

const router = express.Router();

router.get('/alertes', SuiviAdminController.alertes);
router.get('/alertes/nombre', SuiviAdminController.nombreAlertes);
router.get('/activite', SuiviAdminController.activite);
router.get('/revenus', SuiviAdminController.revenus);
router.get('/statistiques', SuiviAdminController.statistiques);
router.get('/rapport', SuiviAdminController.rapport);
router.get('/apercu', SuiviAdminController.apercu);
router.get('/journal', SuiviAdminController.journal);
router.get('/securite', SuiviAdminController.securite);
router.post('/securite/debloquer/:type/:id', SuiviAdminController.debloquer);

export default router;
