// routes/MagasinRoutes.js
import express from 'express';
import MagasinController from '../controllers/MagasinController.js';
import { authenticateToken } from '../middleware/middleware.js';
import TransfertController from '../controllers/TransfertStockController.js';

const router = express.Router();

// ==================== ROUTES PROTÉGÉES ====================

// Mon magasin
router.get('/mon-magasin',  authenticateToken, MagasinController.getMonMagasin);
router.put('/mon-magasin',  authenticateToken, MagasinController.updateMonMagasin);

// Logo
router.post('/upload-logo', authenticateToken, MagasinController.uploadLogo);
router.delete('/logo',      authenticateToken, MagasinController.deleteLogo);

// 🆕 Géocodage
router.post('/geocoder',    authenticateToken, MagasinController.geocoder);

// 🆕 Magasins proches (⚠️ AVANT /:id)
router.get('/proches',      authenticateToken, MagasinController.getProches);

router.get('/:id',          authenticateToken, MagasinController.getById);


export default router;