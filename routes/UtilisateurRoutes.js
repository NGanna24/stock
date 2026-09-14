// routes/UtilisateurRoutes.js
import express from 'express';
import UtilisateurController from '../controllers/UtilisateurController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES PUBLIQUES ====================
router.post('/register', UtilisateurController.register);
router.post('/login', UtilisateurController.login);

// ==================== ROUTES PROTÉGÉES ====================
// router.post('/logout', authenticateToken, UtilisateurController.logout);
router.get('/profile', authenticateToken, UtilisateurController.getProfile); // ← Ajouté authenticateToken
// router.put('/profile', authenticateToken, UtilisateurController.updateProfile);
// router.put('/change-password', authenticateToken, UtilisateurController.changePassword);

export default router;