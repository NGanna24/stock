// routes/ReglagesDocumentsRoutes.js — /api/documents-reglages
import express from 'express';
import { authenticateToken } from '../middleware/middleware.js';
import { uploadImageDocument } from '../middleware/uploadImageDocument.js';
import C, { reservePatron } from '../controllers/ReglagesDocumentsController.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/', C.lire);
router.put('/', reservePatron, C.enregistrer);
router.post('/cachets', reservePatron, uploadImageDocument, C.ajouterCachet);
router.put('/cachets/:id', reservePatron, uploadImageDocument, C.modifierCachet);
router.delete('/cachets/:id', reservePatron, C.supprimerCachet);
router.post('/signature', reservePatron, uploadImageDocument, C.definirSignature);
router.delete('/signature', reservePatron, C.supprimerSignature);

export default router;
