// models/SuperAdmin.js
import { pool } from '../config/db.js';

class SuperAdmin {
    // ============================================================
    // 🔍 TROUVER
    // ============================================================
    static async findByIdentifiant(identifiant) {
        const [rows] = await pool.query(
            `SELECT * FROM super_admins
             WHERE email = ? OR telephone = ?
             LIMIT 1`,
            [identifiant, identifiant]
        );
        return rows[0] || null;
    }

    static async findById(id) {
        const [rows] = await pool.query(
            `SELECT
                id_super_admin, fullname, telephone, email,
                actif, derniere_connexion, derniere_ip,
                date_creation, date_modification
             FROM super_admins WHERE id_super_admin = ? LIMIT 1`,
            [id]
        );
        return rows[0] || null;
    }

    // ============================================================
    // 🆕 CRÉER (inscription)
    // ============================================================
    static async existsByEmailOrPhone(email, telephone) {
        const [rows] = await pool.query(
            `SELECT email, telephone FROM super_admins
             WHERE email = ? OR telephone = ?
             LIMIT 1`,
            [email, telephone]
        );
        return rows[0] || null;
    }

    static async create({ fullname, telephone, email, password }) {
        const [result] = await pool.query(
            `INSERT INTO super_admins (fullname, telephone, email, password, actif)
             VALUES (?, ?, ?, ?, TRUE)`,
            [fullname, telephone, email, password]
        );
        return result.insertId;
    }

    // ============================================================
    // 📊 SUIVI CONNEXION
    // ============================================================
    static async updateLoginSuccess(id, ip) {
        await pool.query(
            `UPDATE super_admins
             SET derniere_connexion = NOW(),
                 derniere_ip = ?,
                 tentatives_echouees = 0,
                 bloque_jusqua = NULL
             WHERE id_super_admin = ?`,
            [ip, id]
        );
    }

    static async updateLoginFailure(id) {
        const [rows] = await pool.query(
            `SELECT tentatives_echouees FROM super_admins WHERE id_super_admin = ?`,
            [id]
        );
        if (!rows[0]) return;

        const attempts = rows[0].tentatives_echouees + 1;
        const blockedUntil = attempts >= 5
            ? new Date(Date.now() + 15 * 60 * 1000)
            : null;

        await pool.query(
            `UPDATE super_admins
             SET tentatives_echouees = ?, bloque_jusqua = ?
             WHERE id_super_admin = ?`,
            [attempts, blockedUntil, id]
        );
    }

    static async resetAttempts(id) {
        await pool.query(
            `UPDATE super_admins SET tentatives_echouees = 0, bloque_jusqua = NULL
             WHERE id_super_admin = ?`,
            [id]
        );
    }

    // ============================================================
    // 🔑 MOT DE PASSE
    // ============================================================
    static async updatePassword(id, hashedPassword) {
        const [result] = await pool.query(
            `UPDATE super_admins SET password = ? WHERE id_super_admin = ?`,
            [hashedPassword, id]
        );
        return result.affectedRows > 0;
    }
}

export default SuperAdmin;