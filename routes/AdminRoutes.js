// routes/AdminRoutes.js
import express from 'express';
import AdminController from '../controllers/AdminController.js';

const router = express.Router();

// ⚠️ AUCUNE SÉCURITÉ POUR L'INSTANT
// À renforcer plus tard avec authenticateToken + requireSuperAdmin

// ==================== DASHBOARD ====================
router.get('/dashboard', AdminController.getDashboard);
router.get('/stats',     AdminController.getStats);

// ==================== UTILISATEURS ====================
router.get('/utilisateurs',              AdminController.getUtilisateurs);
router.get('/utilisateurs/:id',          AdminController.getUtilisateur);
router.patch('/utilisateurs/:id/toggle', AdminController.toggleUtilisateur);
router.get('/inactifs',                  AdminController.getInactifs);

// ==================== MAGASINS / CARTE ====================
router.get('/magasins-carte', AdminController.getMagasinsCarte);

// ==================== ANALYSES ====================
router.get('/top-produits', AdminController.getTopProduits);
router.get('/activite',     AdminController.getActivite);
router.get('/geo',          AdminController.getGeo);

export default router;