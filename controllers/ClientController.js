// controllers/ClientController.js
import Client from '../models/Client.js';

const sendError = (res, error, fallback) => {
    if (!error.statusCode) console.error('❌', error);
    if (error.statusCode) {
        return res.status(error.statusCode).json({
            success: false, message: error.message,
            ...(error.id_client_existant ? { id_client_existant: error.id_client_existant } : {}),
        });
    }
    return res.status(500).json({
        success: false, message: fallback,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};

const responsable = (req) => ['admin', 'manager'].includes(req.user?.role);

class ClientController {
    /* GET /api/clients?search&type&statut&tri&inclureInactifs */
    static async getAllClients(req, res) {
        try {
            const clients = await Client.findAll(req.query, req.workspaceId);
            res.json({ success: true, count: clients.length, data: clients });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la récupération des clients');
        }
    }

    /* GET /api/clients/stats */
    static async getStats(req, res) {
        try {
            res.json({ success: true, data: await Client.getStats(req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du calcul des statistiques');
        }
    }

    /* GET /api/clients/top?limit */
    static async getTopClients(req, res) {
        try {
            res.json({ success: true, data: await Client.getTopClients(parseInt(req.query.limit, 10) || 10, req.workspaceId) });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la récupération des meilleurs clients');
        }
    }

    /* GET /api/clients/search?keyword|q&limit */
    static async searchClients(req, res) {
        try {
            const data = await Client.search(req.query.keyword || req.query.q, req.query.limit, req.workspaceId);
            res.json({ success: true, count: data.length, data });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la recherche');
        }
    }

    /* GET /api/clients/export (CSV, mêmes filtres que la liste) */
    static async exportClients(req, res) {
        try {
            const clients = await Client.export(req.query, req.workspaceId);
            const TYPES = { particulier: 'Particulier', revendeur: 'Revendeur', entreprise: 'Entreprise' };
            const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const fr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
            const lignes = [
                ['N° client', 'Nom', 'Type', 'Téléphone', 'Téléphone 2', 'Quartier', 'Ville', 'E-mail', 'Ventes', 'Total achats',
                 'Doit', 'Plafond de crédit', 'Dernière vente', 'Client depuis', 'Actif', 'Note'],
                ...clients.map((c) => [c.code_client, c.nom, TYPES[c.type_client], c.telephone, c.telephone2, c.quartier, c.ville, c.email,
                    c.nb_ventes, c.total_achats, c.du, c.plafond_credit ?? '', fr(c.derniere_vente), fr(c.date_creation instanceof Date ? c.date_creation.toISOString() : c.date_creation),
                    c.actif ? 'Oui' : 'Non', c.note]),
            ];
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=clients_${new Date().toISOString().slice(0, 10)}.csv`);
            res.send('﻿' + lignes.map((l) => l.map(cell).join(';')).join('\r\n'));
        } catch (error) {
            sendError(res, error, "Erreur lors de l'export");
        }
    }

    /* GET /api/clients/:cle  (id du client ou téléphone, toutes formes) → fiche complète */
    static async getClientByTelephone(req, res) {
        try {
            const fiche = await Client.fiche(req.params.telephone, req.workspaceId);
            if (!fiche) return res.status(404).json({ success: false, message: 'Client non trouvé' });
            // compatibilité : data = client + commandes, et la fiche détaillée
            res.json({ success: true, data: { ...fiche.client, commandes: fiche.ventes, fiche } });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la récupération du client');
        }
    }

    /* POST /api/clients */
    static async create(req, res) {
        try {
            const client = await Client.create(req.body || {}, req.workspaceId, { peutFixerPlafond: responsable(req) });
            res.status(201).json({ success: true, message: 'Client créé', data: client });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la création du client');
        }
    }

    /* PUT /api/clients/:id */
    static async update(req, res) {
        try {
            const client = await Client.update(parseInt(req.params.id, 10) || 0, req.body || {}, req.workspaceId, { peutFixerPlafond: responsable(req) });
            res.json({ success: true, message: 'Client modifié', data: client });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la modification du client');
        }
    }

    /* PATCH /api/clients/:id/actif { actif } (admin, manager) */
    static async setActif(req, res) {
        try {
            const actif = req.body?.actif !== false && req.body?.actif !== 'false' && req.body?.actif !== 0;
            const client = await Client.setActif(parseInt(req.params.id, 10) || 0, actif, req.workspaceId);
            res.json({ success: true, message: actif ? 'Client réactivé' : 'Client désactivé', data: client });
        } catch (error) {
            sendError(res, error, 'Erreur lors du changement de statut');
        }
    }

    /* POST /api/clients/:id/fusionner { id_source } (admin, manager) */
    static async fusionner(req, res) {
        try {
            const r = await Client.fusionner(parseInt(req.params.id, 10) || 0, parseInt(req.body?.id_source, 10) || 0, req.workspaceId);
            res.json({ success: true, message: `Fiches fusionnées (${r.ventes_deplacees} vente(s) déplacée(s))`, data: r });
        } catch (error) {
            sendError(res, error, 'Erreur lors de la fusion');
        }
    }

    /* GET /api/clients/:id/releve?dateDebut&dateFin */
    static async releve(req, res) {
        try {
            res.json({ success: true, data: await Client.releve(parseInt(req.params.id, 10) || 0, req.workspaceId, req.query) });
        } catch (error) {
            sendError(res, error, 'Erreur lors du calcul du relevé');
        }
    }
}

export default ClientController;
