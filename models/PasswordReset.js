// models/PasswordReset.js
import { pool } from '../config/db.js';
import crypto from 'crypto';

class PasswordReset {

    /**
     * Générer un code OTP à 6 chiffres
     */
    static generateOTP() {
        return crypto.randomInt(100000, 999999).toString();
    }

    /**
     * Créer un nouveau code OTP pour un utilisateur
     * Invalide les anciens codes non utilisés pour cet email
     */
    static async createOTP(email, idUtilisateur, ip = null) {
        try {
            // Invalider les anciens codes pour cet email
            await pool.execute(
                `UPDATE password_reset_otp 
                 SET utilise = TRUE 
                 WHERE email = ? AND utilise = FALSE`,
                [email]
            );

            const code = this.generateOTP();
            const expireAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

            const [result] = await pool.execute(
                `INSERT INTO password_reset_otp 
                 (email, code_otp, id_utilisateur, expire_at, ip_demande) 
                 VALUES (?, ?, ?, ?, ?)`,
                [email, code, idUtilisateur, expireAt, ip]
            );

            return {
                id: result.insertId,
                code,
                expireAt
            };
        } catch (error) {
            console.error('❌ Error creating OTP:', error);
            throw error;
        }
    }

    /**
     * Vérifier un code OTP
     * Retourne { valid: bool, reason?: string, otp?: object }
     */
    static async verifyOTP(email, code) {
        try {
            const [rows] = await pool.execute(
                `SELECT * FROM password_reset_otp 
                 WHERE email = ? 
                   AND code_otp = ? 
                   AND utilise = FALSE 
                   AND expire_at > NOW()
                 ORDER BY date_creation DESC 
                 LIMIT 1`,
                [email, code]
            );

            if (rows.length === 0) {
                return { valid: false, reason: 'Code invalide ou expiré' };
            }

            const otp = rows[0];

            if (otp.tentatives >= 5) {
                await pool.execute(
                    `UPDATE password_reset_otp SET utilise = TRUE WHERE id_otp = ?`,
                    [otp.id_otp]
                );
                return { 
                    valid: false, 
                    reason: 'Trop de tentatives. Demandez un nouveau code.' 
                };
            }

            await pool.execute(
                `UPDATE password_reset_otp SET tentatives = tentatives + 1 WHERE id_otp = ?`,
                [otp.id_otp]
            );

            return { valid: true, otp };
        } catch (error) {
            console.error('❌ Error verifying OTP:', error);
            throw error;
        }
    }

    /**
     * Marquer un OTP comme utilisé
     */
    static async markAsUsed(idOtp) {
        await pool.execute(
            `UPDATE password_reset_otp SET utilise = TRUE WHERE id_otp = ?`,
            [idOtp]
        );
    }

    /**
     * Compter les demandes récentes (anti-spam)
     */
    static async countRecentRequests(email, minutes = 15) {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as total FROM password_reset_otp 
             WHERE email = ? 
               AND date_creation > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [email, minutes]
        );
        return rows[0].total;
    }

    /**
     * Nettoyer les OTP expirés (à appeler périodiquement)
     */
    static async cleanupExpired() {
        await pool.execute(
            `DELETE FROM password_reset_otp 
             WHERE expire_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`
        );
    }
}

export default PasswordReset;