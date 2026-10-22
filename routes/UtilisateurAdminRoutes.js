// routes/UtilisateurAdminRoutes.js
import express from 'express';
import UtilisateurAdminController from '../controllers/UtilisateurAdminController.js';

const router = express.Router();

// ⚠️ Sécurité à ajouter plus tard : authenticateToken + requireSuperAdmin

// ⚠️ L'ordre compte : routes statiques AVANT /:id
router.get('/stats',     UtilisateurAdminController.getStats);
router.get('/inactifs',  UtilisateurAdminController.getInactifs);

router.get('/',          UtilisateurAdminController.getListe);
router.get('/:id',       UtilisateurAdminController.getDetail);

router.patch('/:id/toggle', UtilisateurAdminController.toggleActif);

export default router;