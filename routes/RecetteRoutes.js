// routes/RecetteRoutes.js
// Recettes (argent reçu des clients).
//   - consulter, exporter, encaisser une facture : admin, manager, caissier
//   - supprimer une recette (erreur de saisie) : admin, manager
// ⚠️ Routes spécifiques AVANT les routes paramétrées
import express from 'express';
import RecetteController from '../controllers/RecetteController.js';
import { authenticateToken } from '../middleware/middleware.js';
import { exigeAction } from '../utils/permissions.js';

const router = express.Router();
// Accès aux pages : selon les permissions du rôle (utils/permissions.js, controleAcces)
const equipe = authenticateToken;
const responsables = exigeAction('encaissements.supprimer');

router.get('/', equipe, RecetteController.getAllRecettes);
router.get('/stats', equipe, RecetteController.getStats);
router.get('/factures-impayees', equipe, RecetteController.getFacturesImpayees);
router.get('/export', equipe, RecetteController.exportRecettes);

router.post('/', equipe, RecetteController.createRecette);
router.delete('/:id', responsables, RecetteController.deleteRecette);

export default router;
