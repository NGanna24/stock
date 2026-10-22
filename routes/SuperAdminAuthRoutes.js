// routes/SuperAdminAuthRoutes.js
import express from 'express';
import SuperAdminController from '../controllers/SuperAdminController.js';
import { authenticateSuperAdmin } from '../middleware/superAdminAuth.js';

const router = express.Router();

// ==================== PUBLIC ====================
router.post('/login', SuperAdminController.login);
router.post('/register', SuperAdminController.register);

// ==================== PROTÉGÉ ====================
router.get('/me', authenticateSuperAdmin, SuperAdminController.me);
router.post('/change-password', authenticateSuperAdmin, SuperAdminController.changePassword);
router.post('/logout', authenticateSuperAdmin, SuperAdminController.logout);

export default router;