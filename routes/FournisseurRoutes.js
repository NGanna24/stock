// routes/FournisseurRoutes.js
import express from 'express';
import FournisseurController from '../controllers/FournisseurController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// ==================== ROUTES PROTÉGÉES ====================
// Toutes les routes nécessitent une authentification

// ==================== ROUTES DE STATISTIQUES ====================
router.get(
    '/stats',
    authenticateToken,
    FournisseurController.getStats
);

// ==================== ROUTES DE RECHERCHE ====================
router.get(
    '/search',
    authenticateToken,
    FournisseurController.search
);

// ==================== ROUTES D'EXPORT ====================
router.get(
    '/export',
    authenticateToken,
    FournisseurController.export
);

// ==================== ROUTES DES FOURNISSEURS ACTIFS ====================
router.get(
    '/active',
    authenticateToken,
    FournisseurController.getActive
);

// ==================== ROUTES DES PAYS ET VILLES ====================
router.get(
    '/countries',
    authenticateToken,
    FournisseurController.getDistinctCountries
);

router.get(
    '/cities',
    authenticateToken,
    FournisseurController.getDistinctCities
);

// ==================== ROUTES PAR PAYS ET VILLE ====================
router.get(
    '/country/:pays',
    authenticateToken,
    FournisseurController.getByCountry
);

router.get(
    '/city/:ville',
    authenticateToken,
    FournisseurController.getByCity
);

// ==================== ROUTES CRUD PRINCIPALES ====================
router.get(
    '/',
    authenticateToken,
    FournisseurController.getAll
);

router.get(
    '/:id',
    authenticateToken,
    FournisseurController.getById
);

router.post(
    '/',
    authenticateToken,
    // authorizeRoles('admin', 'manager'), // Décommentez si vous avez ce middleware
    FournisseurController.create
);

router.put(
    '/:id',
    authenticateToken,
    // authorizeRoles('admin', 'manager'),
    FournisseurController.update
);

router.patch(
    '/:id/activate',
    authenticateToken,
    // authorizeRoles('admin', 'manager'),
    FournisseurController.activate
);

router.patch(
    '/:id/deactivate',
    authenticateToken,
    // authorizeRoles('admin', 'manager'),
    FournisseurController.deactivate
);

router.delete(
    '/:id',
    authenticateToken,
    // authorizeRoles('admin'),
    FournisseurController.delete
);

export default router;