// routes/PermissionRoutes.js
//   GET    /api/permissions/moi   : toute personne connectée (menu, boutons)
//   GET    /api/permissions       : propriétaire
//   PUT    /api/permissions/:role : propriétaire
//   DELETE /api/permissions/:role : propriétaire (réglages par défaut)
import express from 'express';
import PermissionController from '../controllers/PermissionController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { exigeProprietaire } from '../utils/permissions.js';

const router = express.Router();

router.get('/moi', authenticateToken, PermissionController.moi);
router.get('/', exigeProprietaire, PermissionController.liste);
router.put('/:role', exigeProprietaire, PermissionController.enregistrer);
router.delete('/:role', exigeProprietaire, PermissionController.retablir);

export default router;
