import { createPool } from "mysql2/promise";
import creation_tables from "./codesql.js";
import { executerMigrations, rattacherVentesAuxClients } from "./migrations.js";
import dotenv from 'dotenv';
dotenv.config();  
// Configuration améliorée avec des variables d'environnement
const pool = createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "stock",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00',
    multipleStatements: true 
});

const initDataBase = async () => {
    let connection;
 
    try {
        // Acquérir une connexion depuis le pool
        connection = await pool.getConnection();

        // Exécuter le script SQL de création des tables
        await connection.query(creation_tables.creation_tables);
        // console.log("Tables créées avec succès");

        // Ajouts de colonnes manquantes (sans perte de données)
        await executerMigrations(pool);

        // En arrière-plan : fiches clients reconstituées depuis les ventes existantes
        rattacherVentesAuxClients(pool).catch((e) => console.error('⚠️ [Clients] rattachement des ventes :', e.message));

    } catch (error) {
        console.error("Erreur lors de l'initialisation de la base de données:", error);
        throw error;
    } finally {
        // Toujours libérer la connexion
        if (connection) connection.release();
    }
};



// Exportation du pool et des fonctions
export  { pool, initDataBase };
 