// routes/CommandeAchatRoutes.js
import express from 'express';
import CommandeAchatController from '../controllers/CommandeAchatController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES STATISTIQUES ====================
router.get(
    '/stats',
    authenticateToken,
    CommandeAchatController.getStats
); 

// ==================== ROUTES D'EXPORT ====================
router.get(
    '/export',
    authenticateToken,
    CommandeAchatController.export
);

// ==================== ROUTES FOURNISSEUR ====================
router.get(
    '/fournisseur/:id_fournisseur',
    authenticateToken,
    CommandeAchatController.getByFournisseur
);

// ==================== ROUTES STATUT ====================
router.get(
    '/statut/:statut',
    authenticateToken,
    CommandeAchatController.getByStatut
);

// ==================== ROUTES MOIS ====================
router.get(
    '/mois',
    authenticateToken,
    CommandeAchatController.getCurrentMonth
);

// ==================== ROUTE ANNULATION ====================
router.patch(
    '/:id/annuler',
    authenticateToken,
    CommandeAchatController.annuler
);

// ==================== ROUTE STATUT SPÉCIFIQUE ====================
router.patch(
    '/:id/statut',
    authenticateToken,
    CommandeAchatController.updateStatut
);

// ==================== ROUTE AJOUT DE LIGNES ====================
router.post(
    '/:id/lignes',
    authenticateToken,
    CommandeAchatController.addLignes
);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get(
    '/',
    authenticateToken,
    CommandeAchatController.getAll
);

router.get(
    '/:id',
    authenticateToken,
    CommandeAchatController.getById
);

router.post(
    '/',
    authenticateToken,
    CommandeAchatController.create
);

router.put(
    '/:id',
    authenticateToken,
    CommandeAchatController.update
);

router.delete(
    '/:id',
    authenticateToken,
    CommandeAchatController.delete
);

export default router;