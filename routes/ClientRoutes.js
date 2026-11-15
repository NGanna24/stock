// routes/ClientRoutes.js
// Clients.
//   - consulter, créer, modifier : admin, manager, caissier
//   - plafond de crédit (dans create/update), désactiver, fusionner : admin, manager
// ⚠️ Routes statiques AVANT les routes paramétrées
import express from 'express';
import ClientController from '../controllers/ClientController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { exigeAction } from '../utils/permissions.js';

const router = express.Router();
// Accès aux pages : selon les permissions du rôle (utils/permissions.js, controleAcces)
const equipe = authenticateToken;
const responsables = exigeAction('clients.credit');

// Pays du magasin pour la saisie des numéros (toute l'équipe, vendeurs compris)
router.get('/indicatif', ClientController.indicatif);
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
