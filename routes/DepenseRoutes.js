// routes/DepenseRoutes.js
//
// Droits :
//   - admin   : tout (y compris supprimer et gérer les catégories)
//   - manager : consulter, ajouter, modifier (pas de suppression)
//   - autres  : aucun accès
// ⚠️ Routes statiques (/categories, /reprise, /lot) AVANT les routes paramétrées (/:id).
import express from 'express';
import DepenseController from '../controllers/DepenseController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

/** Le rôle est déjà posé par authenticateToken (req.user.role), employé ou compte principal. */
const roles = (...autorises) => (req, res, next) => {
    const role = req.user?.role || req.userRole;
    if (autorises.includes(role)) return next();
    return res.status(403).json({
        success: false,
        message: autorises.length === 1
            ? 'Action réservée à un administrateur'
            : 'Accès réservé aux administrateurs et managers',
    });
};

const lecture = [authenticateToken, roles('admin', 'manager')];
const admin = [authenticateToken, roles('admin')];

// Catégories
router.get('/categories', ...lecture, DepenseController.listCategories);
router.post('/categories', ...admin, DepenseController.createCategorie);
router.put('/categories/:id', ...admin, DepenseController.updateCategorie);

// Reprise des dépenses fixes du mois précédent
router.get('/reprise', ...lecture, DepenseController.reprise);
router.post('/lot', ...lecture, DepenseController.createLot);

// CRUD
router.get('/', ...lecture, DepenseController.list);
router.post('/', ...lecture, DepenseController.create);
router.get('/:id', ...lecture, DepenseController.getById);
router.put('/:id', ...lecture, DepenseController.update);
router.delete('/:id', ...admin, DepenseController.remove);

export default router;
