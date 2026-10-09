// routes/UtilisateurRoutes.js
import express from 'express';
import UtilisateurController from '../controllers/UtilisateurController.js';
import { authenticateToken } from '../middleware/middleware.js';


const router = express.Router();

// ==================== ROUTES PUBLIQUES ====================
router.post('/register', UtilisateurController.register);
router.post('/login', UtilisateurController.login);

// ==================== ROUTES PROTÉGÉES ==================== 
router.get('/profile', authenticateToken, UtilisateurController.getProfile); 


// Réinitialisation de mot de passe (uniquement utilisateurs/patrons)
router.post('/forgot-password', UtilisateurController.forgotPassword);
router.post('/verify-reset-code', UtilisateurController.verifyResetCode);
router.post('/reset-password', UtilisateurController.resetPassword);

export default router;