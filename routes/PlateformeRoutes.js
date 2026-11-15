// routes/PlateformeRoutes.js
import express from 'express';
import PlateformeController from '../controllers/PlateformeController.js';

/** Public : /api/plateforme */
export const plateformePublique = express.Router();
plateformePublique.get('/etat', PlateformeController.etat);

/** Super Admin : /api/super-admin/plateforme (jeton obligatoire, monté dans app.js) */
export const plateformeAdmin = express.Router();
plateformeAdmin.get('/', PlateformeController.reglages);
plateformeAdmin.put('/', PlateformeController.modifier);
