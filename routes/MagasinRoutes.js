// routes/MagasinRoutes.js
import express from 'express';
import MagasinController from '../controllers/MagasinController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES PROTÉGÉES ====================

// Mon magasin
router.get('/mon-magasin',  authenticateToken, MagasinController.getMonMagasin);
router.put('/mon-magasin',  authenticateToken, MagasinController.updateMonMagasin);

// Logo
router.post('/upload-logo', authenticateToken, MagasinController.uploadLogo);
router.delete('/logo',      authenticateToken, MagasinController.deleteLogo);

// Magasin par ID
router.get('/:id',          authenticateToken, MagasinController.getById);

export default router;