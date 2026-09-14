// routes/InventaireRoutes.js
import express from 'express';
import InventaireController from '../controllers/InventaireController.js';
import { authenticateToken, authorize, requireRole } from '../middleware/middleware.js';

const router = express.Router();

router.use(authenticateToken);

// Routes spécifiques AVANT /:id
router.get('/stats', InventaireController.getInventaireStats);

// CRUD
router.get('/', InventaireController.getAllInventaires);
router.post('/', InventaireController.createInventaire);
router.get('/:id', InventaireController.getInventaireById);
router.delete('/:id', InventaireController.deleteInventaire);

// Actions métier
router.post('/:id/demarrer', InventaireController.demarrerInventaire);
router.patch('/:id/lignes/:id_ligne', InventaireController.saisirLigne);
router.patch('/:id/lignes', InventaireController.saisirLignesEnMasse);
router.post('/:id/valider', InventaireController.validerInventaire);
router.post('/:id/annuler', InventaireController.annulerInventaire);

export default router;