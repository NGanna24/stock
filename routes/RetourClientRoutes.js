// routes/RetourClientRoutes.js
import express from 'express';
import RetourClientController from '../controllers/RetourClientController.js';
import { authenticateToken } from '../middleware/middleware.js'; // ← adapte selon ton middleware

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// ============================================================
// ROUTES SPÉCIALES (avant les routes avec :id)
// ============================================================

// Rechercher une commande pour faire un retour
router.get('/search-commande', RetourClientController.searchCommande);

// Statistiques
router.get('/stats', RetourClientController.getStats);

// ============================================================
// CRUD
// ============================================================

// Liste de tous les retours
router.get('/', RetourClientController.getAll);

// Créer un retour
router.post('/', RetourClientController.create);

// Détail d'un retour
router.get('/:id', RetourClientController.getById);

// Annuler un retour
router.patch('/:id/annuler', RetourClientController.annuler);

export default router;