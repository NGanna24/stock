import { createPool } from "mysql2/promise";
import creation_tables from "./codesql.js";
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
 