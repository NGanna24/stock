// routes/MouvementEntrepotRoutes.js
// À monter comme les autres routes d'entrepôt (même préfixe /api) :
//   import mouvementEntrepotRoutes from './routes/MouvementEntrepotRoutes.js';
//   app.use('/api', mouvementEntrepotRoutes);
import express from 'express';
import MouvementEntrepotController from '../controllers/MouvementEntrepotController.js';
import InventaireEntrepotController from '../controllers/InventaireEntrepotController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

router.get('/entrepots/:id_entrepot/mouvements', authenticateToken, MouvementEntrepotController.list);
router.get('/entrepots/:id_entrepot/synthese', authenticateToken, MouvementEntrepotController.synthese);

// Inventaire de l'entrepôt (même fichier de routes : rien de plus à monter)
const inv = '/entrepots/:id_entrepot/inventaires';
router.get(inv, authenticateToken, InventaireEntrepotController.list);
router.post(inv, authenticateToken, InventaireEntrepotController.creer);
router.get(`${inv}/:id_inventaire`, authenticateToken, InventaireEntrepotController.get);
router.put(`${inv}/:id_inventaire/lignes/:id_ligne`, authenticateToken, InventaireEntrepotController.compter);
router.delete(`${inv}/:id_inventaire/lignes/:id_ligne`, authenticateToken, InventaireEntrepotController.annulerComptage);
router.post(`${inv}/:id_inventaire/tout-conforme`, authenticateToken, InventaireEntrepotController.toutConforme);
router.post(`${inv}/:id_inventaire/valider`, authenticateToken, InventaireEntrepotController.valider);
router.post(`${inv}/:id_inventaire/annuler`, authenticateToken, InventaireEntrepotController.annuler);

export default router;