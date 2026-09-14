// routes/DashboardRoutes.js
import express from 'express';
import DashboardController from '../controllers/DashboardController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// Toutes les routes nécessitent l'authentification
router.use(authenticateToken);

// Route principale : toutes les stats en un appel
router.get('/stats', DashboardController.getStats);

// Routes détaillées (pour recharger une partie spécifique)
router.get('/kpis', DashboardController.getKPIs);
router.get('/ventes-chart', DashboardController.getVentesChart);
router.get('/top-produits', DashboardController.getTopProduits);
router.get('/alertes', DashboardController.getAlertes);
router.get('/derniers-mouvements', DashboardController.getDerniersMouvements);
router.get('/dernieres-factures', DashboardController.getDernieresFactures);
router.get('/dernieres-commandes', DashboardController.getDernieresCommandes);

export default router;