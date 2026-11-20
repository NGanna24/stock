// routes/NotificationRoutes.js
import express from 'express';
import NotificationController from '../controllers/NotificationController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

router.post('/appareils', authenticateToken, NotificationController.enregistrer);
router.delete('/appareils', authenticateToken, NotificationController.retirer);
router.post('/test', authenticateToken, NotificationController.tester);
router.post('/test-resume', authenticateToken, NotificationController.testerResume);

export default router;
