// routes/AbonnementAdminRoutes.js : le super-admin gère les abonnements
// (monté derrière authenticateSuperAdmin dans app.js)
import express from 'express';
import AbonnementController from '../controllers/AbonnementController.js';

const router = express.Router();

// Routes fixes AVANT /:id
router.get('/', AbonnementController.liste);
router.get('/reglages', AbonnementController.lireReglages);
router.put('/reglages', AbonnementController.modifierReglages);

router.get('/:id', AbonnementController.detail);
router.post('/:id/prolonger', AbonnementController.prolonger);
router.delete('/:id/paiements/:idAbonnement', AbonnementController.supprimerPaiement);

export default router;
