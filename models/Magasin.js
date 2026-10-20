// models/Magasin.js
import { pool } from '../config/db.js';

class Magasin {
    /**
     * ============================================================
     * Champs modifiables du magasin
     * ============================================================
     */
    static CHAMPS_MODIFIABLES = [
        'nom_commercial',
        'slogan',
        'logo_url',
        'description',
        'quartier',
        'ville',
        'pays',
        'telephone',
        'telephone2',
        'whatsapp',
        'email',
        // 🆕 GÉOLOCALISATION
        'latitude',
        'longitude',
        'adresse_complete',
        'position_source',
        'precision_gps',
        // Infos légales
        'numero_rccm',
        'numero_nif',
        'numero_contribuable',
        'regime_fiscal'
    ];

    /**
     * ============================================================
     * Créer le magasin d'un utilisateur (appelé à l'inscription)
     * ============================================================
     */
    static async create(id_utilisateur, data = {}) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour create');
        }

        const {
            nom_commercial = null,
            slogan = null,
            logo_url = null,
            description = null,
            quartier = null,
            ville = null,
            pays = null,
            telephone = null,
            telephone2 = null,
            whatsapp = null,
            email = null,
            // 🆕 GÉOLOCALISATION
            latitude = null,
            longitude = null,
            adresse_complete = null,
            position_source = 'manuel',
            precision_gps = null,
            // Infos légales
            numero_rccm = null,
            numero_nif = null,
            numero_contribuable = null,
            regime_fiscal = null
        } = data;

        const [result] = await pool.execute(
            `INSERT INTO magasins (
                id_utilisateur,
                nom_commercial, slogan, logo_url, description,
                quartier, ville, pays, telephone, telephone2, whatsapp, email,
                latitude, longitude, adresse_complete, position_source, precision_gps,
                numero_rccm, numero_nif, numero_contribuable, regime_fiscal,
                actif
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                id_utilisateur,
                nom_commercial, slogan, logo_url, description,
                quartier, ville, pays, telephone, telephone2, whatsapp, email,
                latitude, longitude, adresse_complete, position_source, precision_gps,
                numero_rccm, numero_nif, numero_contribuable, regime_fiscal
            ]
        );

        return result.insertId;
    }

    /**
     * ============================================================
     * Récupérer le magasin d'un utilisateur (patron)
     * ============================================================
     */
    static async findByUtilisateur(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findByUtilisateur');
        }

        const [rows] = await pool.execute(
            `SELECT m.*, 
                    u.fullname AS nom_patron, 
                    u.email     AS email_patron, 
                    u.slug      AS slug_patron
             FROM magasins m
             JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
             WHERE m.id_utilisateur = ?
             LIMIT 1`,
            [id_utilisateur]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Récupérer un magasin par ID (vérifié dans le workspace)
     * ============================================================
     */
    static async findById(id_magasin, id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour findById');
        }

        const [rows] = await pool.execute(
            `SELECT m.*, 
                    u.fullname AS nom_patron, 
                    u.email     AS email_patron, 
                    u.slug      AS slug_patron
             FROM magasins m
             JOIN utilisateurs u ON m.id_utilisateur = u.id_utilisateur
             WHERE m.id_magasin = ? AND m.id_utilisateur = ?`,
            [id_magasin, id_utilisateur]
        );
        return rows[0] || null;
    }

    /**
     * ============================================================
     * Mettre à jour le magasin du patron connecté
     * Accepte TOUS les champs modifiables
     * ============================================================
     */
    static async update(id_utilisateur, data) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour update');
        }

        const updates = [];
        const values = [];

        for (const champ of this.CHAMPS_MODIFIABLES) {
            if (data[champ] !== undefined) {
                updates.push(`${champ} = ?`);
                // Convertir les chaînes vides en null
                const value = data[champ] === '' ? null : data[champ];
                values.push(value);
            }
        }

        if (updates.length === 0) {
            return false;
        }

        values.push(id_utilisateur);

        const [result] = await pool.execute(
            `UPDATE magasins SET ${updates.join(', ')} WHERE id_utilisateur = ?`,
            values
        );

        return result.affectedRows > 0;
    }

    /**
     * ============================================================
     * Vérifier qu'un magasin existe pour un utilisateur
     * ============================================================
     */
    static async existsForUtilisateur(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour existsForUtilisateur');
        }

        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS count FROM magasins WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );
        return rows[0].count > 0;
    }

    /**
     * ============================================================
     * Créer un magasin s'il n'existe pas déjà (idempotent)
     * ============================================================
     */
    static async createIfNotExists(id_utilisateur, data = {}) {
        const existe = await this.existsForUtilisateur(id_utilisateur);
        if (existe) {
            return null;
        }
        return await this.create(id_utilisateur, data);
    }

    /**
     * ============================================================
     * 🆕 Trouver les magasins proches d'un point GPS
     * Formule Haversine (rayon Terre = 6371 km)
     * ============================================================
     */
    static async findProches(latitude, longitude, rayonKm = 10) {
        if (!latitude || !longitude) {
            throw new Error('latitude et longitude requis');
        }

        const [rows] = await pool.execute(
            `SELECT
                m.id_magasin,
                m.nom_commercial,
                m.slogan,
                m.logo_url,
                m.quartier,
                m.ville,
                m.pays,
                m.telephone,
                m.whatsapp,
                m.email,
                m.latitude,
                m.longitude,
                (6371 * ACOS(
                    COS(RADIANS(?)) * COS(RADIANS(m.latitude)) *
                    COS(RADIANS(m.longitude) - RADIANS(?)) +
                    SIN(RADIANS(?)) * SIN(RADIANS(m.latitude))
                )) AS distance_km
             FROM magasins m
             WHERE m.actif = TRUE
               AND m.latitude IS NOT NULL
               AND m.longitude IS NOT NULL
             HAVING distance_km < ?
             ORDER BY distance_km ASC
             LIMIT 50`,
            [latitude, longitude, latitude, rayonKm]
        );

        return rows;
    }
}

export default Magasin;