// models/Inventaire.js
import { pool } from '../config/db.js';
import MouvementStock from './MouvementStock.js';

class Inventaire {
    /**
     * ============================================================
     * Générer une référence unique PAR WORKSPACE
     * ============================================================
     */
    static async genererReference(id_utilisateur) {
        if (!id_utilisateur) {
            throw new Error('id_utilisateur requis pour genererReference');
        }

        const date = new Date();
        const annee = date.getFullYear();
        const mois = String(date.getMonth() + 1).padStart(2, '0');

        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM inventaires
             WHERE id_utilisateur = ?
               AND YEAR(date_creation) = ?
               AND MONTH(date_creation) = ?`,
            [id_utilisateur, annee, mois]
        );

        const count = rows[0].count + 1;
        return `INV-${annee}${mois}-${String(count).padStart(4, '0')}`;
    }

    /**
     * ============================================================
     * Créer un inventaire (statut = 'planifie')
     * ============================================================
     */
    static async create(data) {
        const {
            libelle,
            date_debut,
            type_inventaire = 'complet',
            id_emplacement = null,
            notes = null,
            id_utilisateur
        } = data;

        if (!id_utilisateur) throw new Error('id_utilisateur requis');
        if (!libelle || libelle.trim() === '') throw new Error('Le libellé est obligatoire');
        if (!date_debut) throw new Error('La date de début est obligatoire');
        if (!['complet', 'partiel', 'tournant'].includes(type_inventaire)) {
            throw new Error('Type d\'inventaire invalide');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const reference = await this.genererReference(id_utilisateur);

            const [result] = await connection.execute(
                `INSERT INTO inventaires (
                    id_utilisateur, reference, libelle, date_debut,
                    type_inventaire, id_emplacement, statut, notes
                ) VALUES (?, ?, ?, ?, ?, ?, 'planifie', ?)`,
                [
                    id_utilisateur,
                    reference,
                    libelle.trim(),
                    date_debut,
                    type_inventaire,
                    id_emplacement,
                    notes
                ]
            );

            await connection.commit();
            return await this.findById(result.insertId, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Démarrer un inventaire (planifie → en_cours)
     * ============================================================
     */
    static async demarrer(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour demarrer');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invRows] = await connection.execute(
                `SELECT * FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?
                 FOR UPDATE`,
                [id, id_utilisateur]
            );
            if (invRows.length === 0) throw new Error('Inventaire non trouvé');
            const inventaire = invRows[0];

            if (inventaire.statut !== 'planifie') {
                throw new Error(`Impossible de démarrer un inventaire avec statut "${inventaire.statut}"`);
            }

            // Récupérer les produits du workspace
            let produitsQuery = `
                SELECT id_produit, nom, quantite_stock, emplacement
                FROM produits
                WHERE id_utilisateur = ?
            `;
            const params = [id_utilisateur];

            if (inventaire.type_inventaire === 'partiel' && inventaire.id_emplacement) {
                produitsQuery += ` AND emplacement = (
                    SELECT code FROM emplacements
                    WHERE id_emplacement = ?
                )`;
                params.push(inventaire.id_emplacement);
            }

            produitsQuery += ' ORDER BY nom ASC';

            const [produits] = await connection.execute(produitsQuery, params);

            if (produits.length === 0) {
                throw new Error('Aucun produit à inventorier');
            }

            // Insérer les lignes (snapshot)
            for (const p of produits) {
                await connection.execute(
                    `INSERT INTO inventaire_lignes (
                        id_inventaire, id_produit, id_emplacement,
                        quantite_theorique, quantite_reelle, ecart
                    ) VALUES (?, ?, ?, ?, 0, 0)`,
                    [
                        id,
                        p.id_produit,
                        inventaire.id_emplacement || null,
                        parseFloat(p.quantite_stock) || 0
                    ]
                );
            }

            await connection.execute(
                `UPDATE inventaires SET statut = 'en_cours'
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(id, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Saisir la quantité réelle d'une ligne
     * ============================================================
     */
    static async saisirLigne(id_inventaire, id_ligne, quantite_reelle, notes = null, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour saisirLigne');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invRows] = await connection.execute(
                `SELECT statut FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id_inventaire, id_utilisateur]
            );
            if (invRows.length === 0) throw new Error('Inventaire non trouvé');
            if (invRows[0].statut !== 'en_cours') {
                throw new Error(`Impossible de saisir : inventaire au statut "${invRows[0].statut}"`);
            }

            const qteReelle = parseFloat(quantite_reelle);
            if (isNaN(qteReelle) || qteReelle < 0) {
                throw new Error('La quantité réelle doit être un nombre positif');
            }

            const [ligneRows] = await connection.execute(
                `SELECT quantite_theorique FROM inventaire_lignes
                 WHERE id_ligne = ? AND id_inventaire = ?`,
                [id_ligne, id_inventaire]
            );
            if (ligneRows.length === 0) throw new Error('Ligne d\'inventaire non trouvée');

            const theorique = parseFloat(ligneRows[0].quantite_theorique) || 0;
            const ecart = theorique - qteReelle;

            await connection.execute(
                `UPDATE inventaire_lignes
                 SET quantite_reelle = ?,
                     ecart = ?,
                     notes = COALESCE(?, notes),
                     date_scannage = NOW()
                 WHERE id_ligne = ?`,
                [qteReelle, ecart, notes, id_ligne]
            );

            await connection.commit();
            return { id_ligne, quantite_theorique: theorique, quantite_reelle: qteReelle, ecart };

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Saisie en masse
     * ============================================================
     */
    static async saisirLignesEnMasse(id_inventaire, lignes, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour saisirLignesEnMasse');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invRows] = await connection.execute(
                `SELECT statut FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id_inventaire, id_utilisateur]
            );
            if (invRows.length === 0) throw new Error('Inventaire non trouvé');
            if (invRows[0].statut !== 'en_cours') {
                throw new Error(`Inventaire au statut "${invRows[0].statut}"`);
            }

            let count = 0;
            for (const ligne of lignes) {
                const { id_ligne, quantite_reelle, notes = null } = ligne;
                const qteReelle = parseFloat(quantite_reelle);
                if (isNaN(qteReelle) || qteReelle < 0) continue;

                const [lRows] = await connection.execute(
                    `SELECT quantite_theorique FROM inventaire_lignes
                     WHERE id_ligne = ? AND id_inventaire = ?`,
                    [id_ligne, id_inventaire]
                );
                if (lRows.length === 0) continue;

                const theorique = parseFloat(lRows[0].quantite_theorique) || 0;
                const ecart = theorique - qteReelle;

                await connection.execute(
                    `UPDATE inventaire_lignes
                     SET quantite_reelle = ?, ecart = ?,
                         notes = COALESCE(?, notes),
                         date_scannage = NOW()
                     WHERE id_ligne = ?`,
                    [qteReelle, ecart, notes, id_ligne]
                );
                count++;
            }

            await connection.commit();
            return { success: true, count };

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * ✅ VALIDER un inventaire (VERSION CORRIGÉE)
     *    - Applique le stock réel aux produits
     *    - Crée les ajustements signés
     *    - Tracé dans mouvements_stock
     * ============================================================
     */
    static async valider(id, id_utilisateur, valide_par_nom = null) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour valider');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Vérifier l'inventaire
            const [invRows] = await connection.execute(
                `SELECT * FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?
                 FOR UPDATE`,
                [id, id_utilisateur]
            );
            if (invRows.length === 0) throw new Error('Inventaire non trouvé');
            const inventaire = invRows[0];

            if (inventaire.statut !== 'en_cours') {
                throw new Error(`Impossible de valider un inventaire au statut "${inventaire.statut}"`);
            }

            // 2. Récupérer TOUTES les lignes (pas seulement les écarts)
            const [lignes] = await connection.execute(
                `SELECT * FROM inventaire_lignes WHERE id_inventaire = ?`,
                [id]
            );

            let nbAjustements = 0;
            let valeurEcartTotal = 0;

            // 3. Pour chaque ligne avec écart → ajustement + mise à jour stock
            for (const ligne of lignes) {
                const theorique = parseFloat(ligne.quantite_theorique) || 0;
                const reelle = parseFloat(ligne.quantite_reelle) || 0;
                const ecart = theorique - reelle;

                // ✅ Mise à jour du stock MÊME SI pas d'écart (pour être sûr)
                await connection.execute(
                    `UPDATE produits
                     SET quantite_stock = ?,
                         statut = CASE WHEN ? > 0 THEN 'disponible' ELSE 'rupture' END
                     WHERE id_produit = ? AND id_utilisateur = ?`,
                    [reelle, reelle, ligne.id_produit, id_utilisateur]
                );

                // Si pas d'écart, on ne crée pas d'ajustement (pas nécessaire)
                if (ecart === 0) continue;

                // ✅ Quantité d'ajustement SIGNÉE
                // ecart > 0 → manquant (sortie)
                // ecart < 0 → surplus (entrée)
                const quantiteAjustement = -ecart; // on applique la correction

                // Récupérer le prix d'achat pour valoriser
                const [prodRows] = await connection.execute(
                    `SELECT prix_achat FROM produits WHERE id_produit = ?`,
                    [ligne.id_produit]
                );
                const prixAchat = parseFloat(prodRows[0]?.prix_achat) || 0;
                valeurEcartTotal += Math.abs(ecart) * prixAchat;

                // Créer l'ajustement
                const refAjust = `AJU-INV-${id}-${ligne.id_ligne}`;
                const [ajustResult] = await connection.execute(
                    `INSERT INTO ajustements_stock (
                        id_utilisateur, reference, date_ajustement, id_produit,
                        quantite, ancienne_quantite, nouvelle_quantite,
                        motif, notes
                    ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'inventaire', ?)`,
                    [
                        id_utilisateur,
                        refAjust,
                        ligne.id_produit,
                        quantiteAjustement,  // ✅ signé
                        theorique,
                        reelle,
                        `Ajustement suite à inventaire ${inventaire.reference} (écart: ${ecart})`
                    ]
                );
                const id_ajustement = ajustResult.insertId;

                // ✅ Mouvement de stock (signé)
                await MouvementStock.enregistrer({
                    id_produit: ligne.id_produit,
                    type_mouvement: 'ajustement',
                    quantite: quantiteAjustement,
                    id_reference: id_ajustement,
                    type_reference: 'ajustement',
                    id_utilisateur,
                    notes: `Inventaire ${inventaire.reference} - Écart ${ecart}`
                }, connection, id_utilisateur);

                nbAjustements++;
            }

            // 4. Passer l'inventaire à 'termine'
            await connection.execute(
                `UPDATE inventaires
                 SET statut = 'termine',
                     date_fin = CURDATE(),
                     date_validation = NOW(),
                     valide_par = ?
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [valide_par_nom || 'Système', id, id_utilisateur]
            );

            await connection.commit();

            return {
                inventaire: await this.findById(id, id_utilisateur),
                nb_ajustements: nbAjustements,
                valeur_ecarts: valeurEcartTotal
            };

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Annuler un inventaire
     * ============================================================
     */
    static async annuler(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour annuler');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invRows] = await connection.execute(
                `SELECT statut FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            if (invRows.length === 0) throw new Error('Inventaire non trouvé');

            if (!['planifie', 'en_cours'].includes(invRows[0].statut)) {
                throw new Error(`Impossible d'annuler un inventaire "${invRows[0].statut}"`);
            }

            await connection.execute(
                `UPDATE inventaires SET statut = 'annule'
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            await connection.commit();
            return await this.findById(id, id_utilisateur);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * Supprimer un inventaire
     * ============================================================
     */
    static async delete(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour delete');

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invRows] = await connection.execute(
                `SELECT statut FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );
            if (invRows.length === 0) throw new Error('Inventaire non trouvé');

            if (!['planifie', 'annule'].includes(invRows[0].statut)) {
                throw new Error(`Impossible de supprimer un inventaire "${invRows[0].statut}"`);
            }

            await connection.execute(
                `DELETE FROM inventaires
                 WHERE id_inventaire = ? AND id_utilisateur = ?`,
                [id, id_utilisateur]
            );

            await connection.commit();
            return true;

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * ============================================================
     * ✅ Récupérer un inventaire avec ses lignes + résumé
     * ============================================================
     */
    static async findById(id, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findById');

        const [rows] = await pool.execute(
            `SELECT i.*,
                    e.code AS emplacement_nom,
                    u.fullname AS utilisateur_nom
             FROM inventaires i
             LEFT JOIN emplacements e ON i.id_emplacement = e.id_emplacement
             LEFT JOIN utilisateurs u ON i.id_utilisateur = u.id_utilisateur
             WHERE i.id_inventaire = ?
               AND i.id_utilisateur = ?`,
            [id, id_utilisateur]
        );
        if (rows.length === 0) return null;
        const inventaire = rows[0];

        const [lignes] = await pool.execute(
            `SELECT il.*,
                    p.nom AS produit_nom,
                    p.id_marque,
                    p.prix_achat,
                    m.nom AS marque_nom,
                    p.id_unite,
                    un.symbole AS unite_symbole
             FROM inventaire_lignes il
             LEFT JOIN produits p ON il.id_produit = p.id_produit
             LEFT JOIN marques m ON p.id_marque = m.id_marque
             LEFT JOIN unites un ON p.id_unite = un.id_unite
             WHERE il.id_inventaire = ?
             ORDER BY p.nom ASC`,
            [id]
        );

        inventaire.lignes = lignes;

        // ✅ Résumé calculé
        const nbLignes = lignes.length;
        const nbSaisis = lignes.filter(l => l.date_scannage).length;
        const lignesAvecEcart = lignes.filter(l => parseFloat(l.ecart) !== 0);
        const nbEcarts = lignesAvecEcart.length;

        let valeurEcartTotal = 0;
        let valeurManquant = 0;
        let valeurSurplus = 0;

        lignesAvecEcart.forEach(l => {
            const ecart = parseFloat(l.ecart) || 0;
            const prix = parseFloat(l.prix_achat) || 0;
            const valeur = Math.abs(ecart) * prix;
            valeurEcartTotal += valeur;

            if (ecart > 0) valeurManquant += valeur;
            else valeurSurplus += valeur;
        });

        inventaire.resume = {
            nb_lignes: nbLignes,
            nb_saisis: nbSaisis,
            nb_ecarts: nbEcarts,
            pourcentage_saisi: nbLignes > 0 ? Math.round((nbSaisis / nbLignes) * 100) : 0,
            valeur_ecart_total: valeurEcartTotal,
            valeur_manquant: valeurManquant,
            valeur_surplus: valeurSurplus,
        };

        return inventaire;
    }

    /**
     * ============================================================
     * Récupérer tous les inventaires (par workspace)
     * ============================================================
     */
    static async findAll(filters = {}, id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour findAll');

        let query = `
            SELECT i.*,
                   e.code AS emplacement_nom,
                   u.fullname AS utilisateur_nom,
                   (SELECT COUNT(*) FROM inventaire_lignes
                    WHERE id_inventaire = i.id_inventaire) AS nb_lignes,
                   (SELECT COUNT(*) FROM inventaire_lignes
                    WHERE id_inventaire = i.id_inventaire AND ecart <> 0) AS nb_ecarts
            FROM inventaires i
            LEFT JOIN emplacements e ON i.id_emplacement = e.id_emplacement
            LEFT JOIN utilisateurs u ON i.id_utilisateur = u.id_utilisateur
            WHERE i.id_utilisateur = ?
        `;
        const params = [id_utilisateur];

        if (filters.statut) {
            query += ' AND i.statut = ?';
            params.push(filters.statut);
        }
        if (filters.type_inventaire) {
            query += ' AND i.type_inventaire = ?';
            params.push(filters.type_inventaire);
        }
        if (filters.date_debut) {
            query += ' AND i.date_debut >= ?';
            params.push(filters.date_debut);
        }
        if (filters.date_fin) {
            query += ' AND i.date_debut <= ?';
            params.push(filters.date_fin);
        }
        if (filters.search) {
            query += ' AND (i.reference LIKE ? OR i.libelle LIKE ?)';
            const s = `%${filters.search}%`;
            params.push(s, s);
        }

        query += ' ORDER BY i.date_creation DESC';

        if (filters.limit) {
            const limit = Math.min(parseInt(filters.limit) || 50, 500);
            query += ` LIMIT ${limit}`;
        }
        if (filters.offset) {
            const offset = Math.max(parseInt(filters.offset) || 0, 0);
            query += ` OFFSET ${offset}`;
        }

        const [rows] = await pool.query(query, params);
        return rows;
    }

    /**
     * ============================================================
     * Statistiques des inventaires
     * ============================================================
     */
    static async getStats(id_utilisateur) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis pour getStats');

        const [rows] = await pool.execute(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN statut = 'planifie' THEN 1 ELSE 0 END) AS planifie,
                SUM(CASE WHEN statut = 'en_cours' THEN 1 ELSE 0 END) AS en_cours,
                SUM(CASE WHEN statut = 'termine'  THEN 1 ELSE 0 END) AS termine,
                SUM(CASE WHEN statut = 'annule'   THEN 1 ELSE 0 END) AS annule,
                SUM(CASE WHEN DATE(date_creation) = CURDATE() THEN 1 ELSE 0 END) AS aujourdhui
             FROM inventaires
             WHERE id_utilisateur = ?`,
            [id_utilisateur]
        );

        const s = rows[0];
        return {
            total: parseInt(s.total) || 0,
            planifie: parseInt(s.planifie) || 0,
            en_cours: parseInt(s.en_cours) || 0,
            termine: parseInt(s.termine) || 0,
            annule: parseInt(s.annule) || 0,
            aujourdhui: parseInt(s.aujourdhui) || 0
        };
    }
}

export default Inventaire;