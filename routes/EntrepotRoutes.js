// routes/EntrepotRoutes.js
import express from 'express';
import EntrepotController from '../controllers/EntrepotController.js';
import TransfertController from '../controllers/TransfertStockController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ============================================================
// ⚠️ ORDRE : STATIQUES → PARAMÉTRÉES → CRUD
// ============================================================

// ==================== ROUTES STATIQUES ====================
router.get('/', authenticateToken, EntrepotController.getMesEntrepots);
router.post('/', authenticateToken, EntrepotController.create);
router.post('/rejoindre', authenticateToken, EntrepotController.rejoindre);

// ==================== ROUTES PARAMÉTRÉES ====================
router.get('/:id', authenticateToken, EntrepotController.getById);
router.put('/:id', authenticateToken, EntrepotController.update);
router.post('/:id/regenerer-code', authenticateToken, EntrepotController.regenererCode);

// Membres
router.get('/:id/membres', authenticateToken, EntrepotController.getMembres);
router.delete('/:id/membres/:idMembre', authenticateToken, EntrepotController.retirerMembre);

// Produits partagés
router.get('/:id/produits', authenticateToken, EntrepotController.getProduits);
router.post('/:id/produits', authenticateToken, EntrepotController.partagerProduit);
router.delete('/:id/produits/:idProduit', authenticateToken, EntrepotController.retirerProduit);

// Stock
router.get('/:id/stock', authenticateToken, EntrepotController.getStock);
router.post('/:id/stock', authenticateToken, EntrepotController.ajouterStock);   // ✅ AJOUTÉ


export default router;