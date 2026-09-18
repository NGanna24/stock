// routes/SearchRoutes.js
import express from 'express';
import SearchController from '../controllers/SearchController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

router.get('/', authenticateToken, SearchController.searchGlobal);

export default router;