// routes/TransfertStockRoutes.js
//
// Toutes les routes sont rattachées à un entrepôt.
// ⚠️ Routes statiques (/en-attente/count, /produits-magasin) AVANT les routes paramétrées.
import express from 'express';
import TransfertStockController from '../controllers/TransfertStockController.js';
import { authenticateToken } from '../middleware/middleware.js';

const router = express.Router();

// Vue centrale : tous mes transferts, tous entrepôts confondus (page /transferts)
router.get('/transferts', authenticateToken, TransfertStockController.listMesTransferts);

router.get(
    '/entrepots/:id_entrepot/transferts/en-attente/count',
    authenticateToken,
    TransfertStockController.countEnAttente
);

router.get(
    '/entrepots/:id_entrepot/transferts/produits-magasin',
    authenticateToken,
    TransfertStockController.produitsMagasin
);

router.get(
    '/entrepots/:id_entrepot/transferts',
    authenticateToken,
    TransfertStockController.list
);

// Panier : plusieurs produits d'un coup (tout ou rien)
router.post(
    '/entrepots/:id_entrepot/transferts/lot',
    authenticateToken,
    TransfertStockController.createLot
);

router.post(
    '/entrepots/:id_entrepot/transferts',
    authenticateToken,
    TransfertStockController.create
);

// Panier : actions sur tout le lot (propriétaire : approuver / refuser ; demandeur : annuler)
router.patch('/entrepots/:id_entrepot/transferts/lot/:numero_lot/approuver', authenticateToken, TransfertStockController.approuverLot);
router.patch('/entrepots/:id_entrepot/transferts/lot/:numero_lot/refuser', authenticateToken, TransfertStockController.refuserLot);
router.patch('/entrepots/:id_entrepot/transferts/lot/:numero_lot/annuler', authenticateToken, TransfertStockController.annulerLot);

// Propriétaire de l'entrepôt
router.patch(
    '/entrepots/:id_entrepot/transferts/:id_transfert/approuver',
    authenticateToken,
    TransfertStockController.approuver
);

router.patch(
    '/entrepots/:id_entrepot/transferts/:id_transfert/refuser',
    authenticateToken,
    TransfertStockController.refuser
);

// Demandeur
router.patch(
    '/entrepots/:id_entrepot/transferts/:id_transfert/annuler',
    authenticateToken,
    TransfertStockController.annuler
);

export default router;