// routes/CompteFournisseurRoutes.js — /api/comptes-fournisseurs
import express from 'express';
import { authenticateToken } from '../middleware/middleware.js';
import { uploadJustificatif } from '../middleware/uploadJustificatif.js';
import C, { accesComptesFournisseurs } from '../controllers/CompteFournisseurController.js';

const router = express.Router();
router.use(authenticateToken, accesComptesFournisseurs);

router.get('/', C.tableau);
router.post('/', C.creer);

router.post('/operations/:idOperation/annuler', C.annuler);
router.post('/versements/:idPaiement/annuler', C.annulerVersement);
router.get('/operations/:id/justificatif', (req, res) => { req.params.source = 'operations'; return C.justificatif(req, res); });
router.get('/versements/:id/justificatif', (req, res) => { req.params.source = 'versements'; return C.justificatif(req, res); });
router.get('/par-fournisseur/:idFournisseur', C.parFournisseur);
router.put('/rapprochements/:idRappro/resoudre', C.resoudre);

router.get('/:id', C.detail);
router.put('/:id', C.modifier);
router.get('/:id/operations', C.operations);
router.get('/:id/commandes', C.commandes);
router.post('/:id/achats', uploadJustificatif, C.achat);
router.post('/:id/versements', uploadJustificatif, C.versement);
router.post('/:id/bonus', uploadJustificatif, C.bonus);
router.post('/:id/bonus/utiliser', C.utiliserBonus);
router.post('/:id/ajustements', uploadJustificatif, C.ajustement);
router.post('/:id/plafond', C.plafond);
router.get('/:id/rapprochements', C.rapprochements);
router.post('/:id/rapprochements', C.rapprocher);

export default router;
