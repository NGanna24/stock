// controllers/ClientController.js
import Client from '../models/Client.js';

class ClientController {
    /**
     * ============================================================
     * Récupérer tous les clients du workspace
     * ============================================================
     */
    static async getAllClients(req, res) {
        try {
            // ✅ req.workspaceId en 2e argument
            const clients = await Client.findAll(req.query, req.workspaceId);
            res.status(200).json({
                success: true,
                count: clients.length,
                data: clients
            });
        } catch (error) {
            console.error('❌ Erreur getAllClients:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des clients',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Récupérer un client par téléphone (workspace)
     * ============================================================
     */
    static async getClientByTelephone(req, res) {
        try {
            const { telephone } = req.params;
            // ✅ req.workspaceId en 2e argument
            const client = await Client.findByTelephone(telephone, req.workspaceId);

            if (!client) {
                return res.status(404).json({
                    success: false,
                    message: 'Client non trouvé'
                });
            }

            res.status(200).json({
                success: true,
                data: client
            });
        } catch (error) {
            console.error('❌ Erreur getClientByTelephone:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du client',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Statistiques des clients (workspace)
     * ============================================================
     */
    static async getStats(req, res) {
        try {
            // ✅ req.workspaceId en argument
            const stats = await Client.getStats(req.workspaceId);
            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('❌ Erreur getStats clients:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Top clients (workspace)
     * ============================================================
     */
    static async getTopClients(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;
            // ✅ req.workspaceId en 2e argument
            const top = await Client.getTopClients(limit, req.workspaceId);
            res.status(200).json({
                success: true,
                count: top.length,
                data: top
            });
        } catch (error) {
            console.error('❌ Erreur getTopClients:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des top clients',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Recherche de clients (workspace)
     * ============================================================
     */
    static async searchClients(req, res) {
        try {
            const { keyword } = req.query;
            const limit = parseInt(req.query.limit) || 10;
            // ✅ req.workspaceId en 3e argument
            const clients = await Client.search(keyword, limit, req.workspaceId);
            res.status(200).json({
                success: true,
                count: clients.length,
                data: clients
            });
        } catch (error) {
            console.error('❌ Erreur searchClients:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche des clients',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * ============================================================
     * Export CSV (workspace)
     * ============================================================
     */
    static async exportClients(req, res) {
        try {
            // ✅ req.workspaceId en 2e argument
            const clients = await Client.export(req.query, req.workspaceId);

            const headers = [
                'Nom', 'Téléphone', 'Nb commandes', 'Total achats',
                'Panier moyen', 'Nb factures', 'Montant impayé',
                'Première commande', 'Dernière commande'
            ];

            const rows = clients.map(c => [
                c.nomclient || '',
                c.telephone || '',
                c.nb_commandes || 0,
                c.total_achats || 0,
                c.panier_moyen || 0,
                c.nb_factures || 0,
                c.montant_impaye || 0,
                c.premiere_commande || '',
                c.derniere_commande || ''
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=clients_${new Date().toISOString().split('T')[0]}.csv`
            );
            res.status(200).send(csvContent);
        } catch (error) {
            console.error('❌ Erreur exportClients:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'exportation des clients',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

export default ClientController;