// routes/DashboardRoutes.js
import express from 'express';
import DashboardController from '../controllers/DashboardController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/stats', DashboardController.getStats);
router.get('/kpis', DashboardController.getKPIs);
router.get('/ventes-chart', DashboardController.getVentesChart);
router.get('/benefices-jour', DashboardController.getBeneficesParJour);  // ✅ NOUVEAU
router.get('/top-produits', DashboardController.getTopProduits);
router.get('/alertes', DashboardController.getAlertes);
router.get('/derniers-mouvements', DashboardController.getDerniersMouvements);
router.get('/dernieres-factures', DashboardController.getDernieresFactures);
router.get('/dernieres-commandes', DashboardController.getDernieresCommandes);

export default router;