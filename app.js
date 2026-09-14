// server.js - Serveur principal de l'application
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool, initDataBase } from './config/db.js';
import UtilisateurRoutes from './routes/UtilisateurRoutes.js'; 
import categorieRoutes from './routes/CategorieRoutes.js';
import ModeleRoutes from './routes/ModeleRoutes.js';
import marqueRoutes from './routes/marqueRoutes.js';
import uniteRoutes from './routes/uniteRoutes.js';
import ProduitRoutes from './routes/produitRoutes.js';
import fournisseurRoutes from './routes/FournisseurRoutes.js';
import commandeAchatRoutes from './routes/CommandeAchatRoutes.js';
import receptionRoutes from './routes/ReceptionRoutes.js';
import retourFournisseurRoutes from './routes/RetourFournisseurRoutes.js';
import commandeVenteRoutes from './routes/CommandeVenteRoutes.js';
import paiementRoutes from './routes/PaiementRoutes.js';
import factureRoutes from './routes/FactureRoutes.js';
import gptRoute from './routes/gptRoute.js'; 
import retourClientRoutes from './routes/RetourClientRoutes.js'; 
import mouvementStockRoutes from './routes/mouvementStockRoutes.js'; 
import inventaireRoutes from './routes/InventaireRoutes.js';
import dashboardRoutes from './routes/DashboardRoutes.js';
import clientRoutes from './routes/ClientRoutes.js';
import rapportVenteRoutes from './routes/RapportVenteRoutes.js';
import rapportAchatRoutes from './routes/RapportAchatRoutes.js';
import rapportStockRoutes from './routes/RapportStockRoutes.js';
import beneficeRoutes from './routes/BeneficeRoutes.js';
import alerteRoutes from './routes/AlerteRoutes.js';
import recetteRoutes from './routes/RecetteRoutes.js';
import uniteVenteRoutes from './routes/UniteVenteRoutes.js';








// ==================== CONFIGURATION ENVIRONNEMENT ====================
dotenv.config();

const app = express();

// Middleware pour parser le JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration CORS
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// ==================== ROUTES API PRINCIPALES ====================
app.use('/api/utilisateur', UtilisateurRoutes);
app.use('/api/categories', categorieRoutes);
app.use('/api/modeles',ModeleRoutes)
app.use('/api/marques', marqueRoutes);
app.use('/api/unites', uniteRoutes);
app.use('/api/produits', ProduitRoutes);
app.use('/api/fournisseurs', fournisseurRoutes);
app.use('/api/commandes-achat', commandeAchatRoutes);
app.use('/api/receptions', receptionRoutes);
app.use('/api/retours-fournisseurs', retourFournisseurRoutes);
app.use('/api/commandes-vente', commandeVenteRoutes);
app.use('/api/paiements', paiementRoutes);
app.use('/api/factures', factureRoutes);
app.use('/api/gpt', gptRoute);
app.use('/api/retours-clients', retourClientRoutes); 
app.use('/api/mouvement-stock', mouvementStockRoutes); 
app.use('/api/inventaires', inventaireRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/rapports', rapportVenteRoutes);
app.use('/api/rapports', rapportAchatRoutes);
app.use('/api/rapports', rapportStockRoutes);
app.use('/api/rapports', beneficeRoutes);
app.use('/api/alertes', alerteRoutes);
app.use('/api/recettes', recetteRoutes);
app.use('/api/unites-vente', uniteVenteRoutes);

// ==================== DÉMARRAGE DU SERVEUR ====================
const startServer = async () => {
    try {
        // Initialisation de la base de données
        await initDataBase();
        console.log('✅ [Database] Base de données initialisée avec succès');

        const PORT = process.env.PORT || 8080;
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ [Server] Serveur démarré sur le port ${PORT}`);
            console.log(`🌐 [Server] http://localhost:${PORT}`);
        });

        // Gestion des erreurs de démarrage du serveur
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ [Server] Le port ${PORT} est déjà utilisé`);
                process.exit(1);
            } else {
                console.error('❌ [Server] Erreur:', error);
            }
        });

    } catch (error) {
        console.error('❌ [Startup] Échec du démarrage du serveur:', error);
        process.exit(1);
    }
};

startServer();

export default app;