// routes/SuperAdminAuthRoutes.js
import express from 'express';
import SuperAdminController from '../controllers/SuperAdminController.js';
import { journalSuperAdmin } from '../middleware/journalSuperAdmin.js';
import { authenticateSuperAdmin } from '../middleware/superAdminAuth.js';
import { limiterParAppareil } from '../utils/securite.js';

const router = express.Router();

// ==================== PUBLIC ====================
// Limite d'essais par appareil : empêche de deviner le mot de passe ou le code d'invitation
router.post('/login', limiterParAppareil('admin-connexion', 10, 15), SuperAdminController.login);
router.post('/register', limiterParAppareil('admin-inscription', 5, 60), SuperAdminController.register);

// ==================== PROTÉGÉ ====================
router.get('/me', authenticateSuperAdmin, SuperAdminController.me);
router.put('/profil', authenticateSuperAdmin, journalSuperAdmin, SuperAdminController.profil);
router.post('/change-password', authenticateSuperAdmin, journalSuperAdmin, SuperAdminController.changePassword);
router.post('/logout', authenticateSuperAdmin, journalSuperAdmin, SuperAdminController.logout);

export default router;