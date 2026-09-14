// routes/ClientRoutes.js
import express from 'express';
import ClientController from '../controllers/ClientController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

router.use(authenticateToken);

// Routes spécifiques AVANT /:telephone
router.get('/stats', ClientController.getStats);
router.get('/top', ClientController.getTopClients);
router.get('/search', ClientController.searchClients);
router.get('/export', ClientController.exportClients);

// Routes principales
router.get('/', ClientController.getAllClients);
router.get('/:telephone', ClientController.getClientByTelephone);

export default router;