// controllers/SearchController.js
import Search from '../models/Search.js';

class SearchController {
    /**
     * GET /api/search?q=terme&limit=5
     */
    static async searchGlobal(req, res) {
        try {
            const { q = '', limit = 5 } = req.query;

            if (!q || q.trim().length < 2) {
                return res.status(200).json({
                    success: true,
                    data: {
                        produits: [],
                        clients: [],
                        factures: [],
                        commandes: [],
                        fournisseurs: [],
                    },
                });
            }

            const data = await Search.searchGlobal(
                req.workspaceId,
                q,
                parseInt(limit, 10) || 5
            );

            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            console.error('❌ searchGlobal error:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            });
        }
    }
}

export default SearchController;