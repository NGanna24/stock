// controllers/ModePaiementController.js
import ModePaiement from '../models/ModePaiement.js';
import { MODES_PAIEMENT } from '../utils/modesPaiement.js';

class ModePaiementController {
    /** GET /api/modes-paiement : la liste complète et les modes de la boutique */
    static async lire(req, res) {
        try {
            const actifs = await ModePaiement.actifs(req.user.id);
            res.json({ success: true, catalogue: MODES_PAIEMENT, actifs });
        } catch (e) {
            console.error('❌ ModePaiementController.lire:', e);
            res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }

    /** PUT /api/modes-paiement  Body: { actifs: ['especes', 'wave', ...] } — patron uniquement */
    static async enregistrer(req, res) {
        try {
            if (req.user.type === 'employe') {
                return res.status(403).json({ success: false, message: 'Seul le patron peut choisir les modes de paiement' });
            }
            const actifs = await ModePaiement.enregistrer(req.user.id, req.body?.actifs);
            res.json({ success: true, message: 'Modes de paiement enregistrés', catalogue: MODES_PAIEMENT, actifs });
        } catch (e) {
            if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
            console.error('❌ ModePaiementController.enregistrer:', e);
            res.status(500).json({ success: false, message: 'Erreur serveur' });
        }
    }
}

export default ModePaiementController;
