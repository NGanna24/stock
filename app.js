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
import ProduitRoutes from './routes/ProduitRoutes.js';
import fournisseurRoutes from './routes/FournisseurRoutes.js';
import commandeAchatRoutes from './routes/CommandeAchatRoutes.js';
import receptionRoutes from './routes/ReceptionRoutes.js';
import retourFournisseurRoutes from './routes/RetourFournisseurRoutes.js';
import commandeVenteRoutes from './routes/CommandeVenteRoutes.js';
import paiementRoutes from './routes/PaiementRoutes.js';
import factureRoutes from './routes/FactureRoutes.js';
import retourClientRoutes from './routes/RetourClientRoutes.js';
import MouvementStockRoutes from './routes/MouvementStockRoutes.js';
import inventaireRoutes from './routes/InventaireRoutes.js';
import dashboardRoutes from './routes/DashboardRoutes.js';
import clientRoutes from './routes/ClientRoutes.js';
import rapportVenteRoutes from './routes/RapportVenteRoutes.js';
import rapportAchatRoutes from './routes/RapportAchatRoutes.js';
import rapportStockRoutes from './routes/RapportStockRoutes.js';
import beneficeRoutes from './routes/BeneficeRoutes.js';
import alerteRoutes from './routes/AlerteRoutes.js';
import recetteRoutes from './routes/RecetteRoutes.js';
import depenseRoutes from './routes/DepenseRoutes.js';
import caisseRoutes from './routes/CaisseRoutes.js';
import detteFournisseurRoutes from './routes/DetteFournisseurRoutes.js';
import journalRoutes from './routes/JournalRoutes.js';
import relanceClientRoutes from './routes/RelanceClientRoutes.js';
import horsLigneRoutes from './routes/HorsLigneRoutes.js';
import { journalActivite } from './middleware/journal.js';
import uniteVenteRoutes from './routes/UniteVenteRoutes.js';
import magasinRoutes from './routes/MagasinRoutes.js';
import employeRoutes from './routes/EmployeRoutes.js';
// En haut, avec les autres imports
import assistantAchatRoutes from './routes/AssistantAchatRoutes.js';
import searchRoutes from './routes/SearchRoutes.js';
import ProduitEntrepotRoutes from './routes/ProduitEntrepotRoutes.js';
import MouvementEntrepotRoutes from './routes/MouvementEntrepotRoutes.js';

import adminRoutes from './routes/AdminRoutes.js';
import MagasinAdminRoutes from './routes/MagasinAdminRoutes.js';
import UtilisateurAdminRoutes from './routes/UtilisateurAdminRoutes.js';
import EntrepotRoutes from './routes/EntrepotRoutes.js';
import TransfertRoutes from './routes/TransfertStockRoutes.js';
// import TransfertRoutes from './routes/TransfertStockRoutes.js';

import TransfertStockRoutes from './routes/TransfertStockRoutes.js';

import gptRoutes from './routes/GptRoutes.js';

import SuperAdminAuthRoutes from './routes/SuperAdminAuthRoutes.js';
import { authenticateSuperAdmin } from './middleware/superAdminAuth.js';
import { requireRole, requireRoleForWrites } from './middleware/roleMiddleware.js';
import path from 'path';
import { fileURLToPath } from 'url';
import AbonnementRoutes from './routes/AbonnementRoutes.js';
import AbonnementAdminRoutes from './routes/AbonnementAdminRoutes.js';

// ==================== CONFIGURATION ENVIRONNEMENT ====================
dotenv.config();

const app = express();

// Middleware pour parser le JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== FICHIERS STATIQUES ====================
//  CORS activé pour permettre le chargement des images dans le PDF
app.use(
    '/uploads',
    cors({
        origin: '*',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }),
    express.static(path.join(__dirname, 'uploads'))
);
 
// ==================== CONFIGURATION CORS ====================
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // Autoriser les requêtes sans Origin (Postman, curl, mobile)
        if (!origin) return callback(null, true);

        // Autoriser tout si wildcard
        if (allowedOrigins.includes('*')) return callback(null, true);

        // Vérifier si l'origine est autorisée
        if (allowedOrigins.includes(origin)) {
            callback(null, origin);
        } else {
            console.log('❌ CORS bloqué pour :', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// ==================== ROUTES API PRINCIPALES ====================
// Journal d'activité : enregistre automatiquement les actions réussies (avant toutes les routes)
app.use('/api', journalActivite);

// Test de connexion (mode hors ligne) : réponse minuscule, sans authentification
app.get('/api/ping', (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true }));

app.use('/api/utilisateur', UtilisateurRoutes);
app.use('/api/abonnement', AbonnementRoutes);
app.use('/api/categories', categorieRoutes);
app.use('/api/modeles', ModeleRoutes);
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
app.use('/api/retours-clients', retourClientRoutes);
app.use('/api/mouvement-stock', MouvementStockRoutes);
app.use('/api/inventaires', inventaireRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientRoutes);
// Rapports et bénéfices : admin et manager uniquement (comme le menu)
app.use('/api/rapports', requireRole('admin', 'manager'));
app.use('/api/rapports', rapportVenteRoutes);
app.use('/api/rapports', rapportAchatRoutes);
app.use('/api/rapports', rapportStockRoutes);
app.use('/api/rapports', beneficeRoutes);
app.use('/api/alertes', alerteRoutes);
app.use('/api/recettes', recetteRoutes);
app.use('/api/depenses', depenseRoutes);
app.use('/api/caisse', caisseRoutes);
app.use('/api/dettes-fournisseurs', detteFournisseurRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/relances', relanceClientRoutes);
app.use('/api/hors-ligne', horsLigneRoutes);
app.use('/api/unites-vente', uniteVenteRoutes);
// Fiche du magasin : lecture pour tous, modification par l'admin
app.use('/api/magasin', requireRoleForWrites('admin'), magasinRoutes);
// Gestion des employés : admin uniquement
app.use('/api/employes', requireRole('admin'), employeRoutes);
app.use('/api/assistant-achat', assistantAchatRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/gpt', gptRoutes);
// ⚠️ Espace SUPER ADMIN : jeton super admin obligatoire
app.use('/api/admin', authenticateSuperAdmin, adminRoutes);
app.use('/api/super-admin/magasins', authenticateSuperAdmin, MagasinAdminRoutes);
app.use('/api/super-admin/utilisateurs', authenticateSuperAdmin, UtilisateurAdminRoutes);
app.use('/api/super-admin/abonnements', authenticateSuperAdmin, AbonnementAdminRoutes);
app.use('/api/super-admin/auth', SuperAdminAuthRoutes);
app.use('/api', ProduitEntrepotRoutes); 
app.use('/api', MouvementEntrepotRoutes);


app.use('/api/entrepots', EntrepotRoutes);
app.use('/api', TransfertStockRoutes);   // même préfixe que ProduitEntrepotRoutes

// ==================== DÉMARRAGE DU SERVEUR ====================
const startServer = async () => {
    try {
        // Initialisation de la base de données
        await initDataBase();
        console.log(' [Database] Base de données initialisée avec succès');

        const PORT = process.env.PORT || 8080;
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(` [Server] Serveur démarré sur le port ${PORT}`);
            console.log(` [Server] http://localhost:${PORT}`);
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