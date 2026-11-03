// routes/ClientRoutes.js
// Clients.
//   - consulter, créer, modifier : admin, manager, caissier
//   - plafond de crédit (dans create/update), désactiver, fusionner : admin, manager
// ⚠️ Routes statiques AVANT les routes paramétrées
import express from 'express';
import ClientController from '../controllers/ClientController.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();
const equipe = requireRole('admin', 'manager', 'caissier');
const responsables = requireRole('admin', 'manager');

router.get('/stats', equipe, ClientController.getStats);
router.get('/top', equipe, ClientController.getTopClients);
router.get('/search', equipe, ClientController.searchClients);
router.get('/export', equipe, ClientController.exportClients);
router.get('/', equipe, ClientController.getAllClients);
router.post('/', equipe, ClientController.create);

router.get('/:id/releve', equipe, ClientController.releve);
router.post('/:id/fusionner', responsables, ClientController.fusionner);
router.patch('/:id/actif', responsables, ClientController.setActif);
router.put('/:id', equipe, ClientController.update);
router.get('/:telephone', equipe, ClientController.getClientByTelephone);

export default router;
