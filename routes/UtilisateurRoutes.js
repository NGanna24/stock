// routes/UtilisateurRoutes.js
import express from 'express';
import UtilisateurController from '../controllers/UtilisateurController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { uploadPhotoProfil } from '../middleware/uploadPhotoProfil.js';
import { limiterParAppareil } from '../utils/securite.js';

const router = express.Router();

// ==================== ROUTES PUBLIQUES (essais limités par appareil) ====================
router.post('/register', limiterParAppareil('inscription', 10, 60), UtilisateurController.register);
router.post('/login', limiterParAppareil('connexion', 20, 15), UtilisateurController.login);

// ==================== ROUTES PROTÉGÉES ====================
router.get('/profile', authenticateToken, UtilisateurController.getProfile);
router.put('/profile', authenticateToken, UtilisateurController.updateProfile);
router.post('/photo', authenticateToken, uploadPhotoProfil, UtilisateurController.definirPhoto);
router.delete('/photo', authenticateToken, UtilisateurController.definirPhoto);

// Session : prolonger, déverrouiller l'écran, fermer toutes les sessions, se déconnecter
router.post('/renouveler', authenticateToken, UtilisateurController.renouveler);
router.post('/verifier-code', limiterParAppareil('deverrouillage', 20, 15), authenticateToken, UtilisateurController.verifierCode);
router.post('/deconnecter-partout', authenticateToken, UtilisateurController.deconnecterPartout);
router.post('/logout', UtilisateurController.logout);

// Réinitialisation de mot de passe (uniquement utilisateurs/patrons)
router.post('/forgot-password', limiterParAppareil('mot-de-passe-oublie', 5, 15), UtilisateurController.forgotPassword);
router.post('/verify-reset-code', limiterParAppareil('code-reinitialisation', 10, 15), UtilisateurController.verifyResetCode);
router.post('/reset-password', limiterParAppareil('code-reinitialisation', 10, 15), UtilisateurController.resetPassword);

export default router;
