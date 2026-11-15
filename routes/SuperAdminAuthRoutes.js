// routes/SuperAdminAuthRoutes.js
import express from 'express';
import SuperAdminController from '../controllers/SuperAdminController.js';
import { journalSuperAdmin } from '../middleware/journalSuperAdmin.js';
import { authenticateSuperAdmin } from '../middleware/superAdminAuth.js';

const router = express.Router();

// ==================== PUBLIC ====================
router.post('/login', SuperAdminController.login);
router.post('/register', SuperAdminController.register);

// ==================== PROTÉGÉ ====================
router.get('/me', authenticateSuperAdmin, SuperAdminController.me);
router.put('/profil', authenticateSuperAdmin, journalSuperAdmin, SuperAdminController.profil);
router.post('/change-password', authenticateSuperAdmin, journalSuperAdmin, SuperAdminController.changePassword);
router.post('/logout', authenticateSuperAdmin, journalSuperAdmin, SuperAdminController.logout);

export default router;