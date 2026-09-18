// models/Search.js
import { pool } from '../config/db.js';

class Search {
    /**
     * ============================================================
     * RECHERCHE GLOBALE
     * ============================================================
     * Tables cherchées :
     *  - produits          (nom, categorie, marque, modele, emplacement)
     *  - clients           (nom, telephone, email, ville)  ← TABLE DÉDIÉE
     *  - factures_vente    (numero, client)
     *  - commandes_vente   (numero, client, telephone)
     *  - commandes_achat   (numero, fournisseur)
     *  - fournisseurs      (nom, telephone, email, ville)
     */
    static async searchGlobal(id_utilisateur, terme, limit = 5) {
        if (!id_utilisateur) throw new Error('id_utilisateur requis');

        if (!terme || terme.trim().length < 2) {
            return {
                produits: [],
                clients: [],
                factures: [],
                commandes: [],
                commandes_achat: [],
                fournisseurs: [],
            };
        }

        const t = `%${terme.trim()}%`;
        const limitInt = Math.max(1, Math.min(20, parseInt(limit, 10) || 5));

        try {
            // ========== 1. PRODUITS ==========
            const [produits] = await pool.query(
                `SELECT
                    p.id_produit,
                    p.nom,
                    p.prix_vente,
                    p.quantite_stock,
                    p.statut,
                    u.symbole AS unite_symbole,
                    m.nom AS modele_nom,
                    mar.nom AS marque_nom,
                    c.nom AS categorie_nom
                 FROM produits p
                 LEFT JOIN modeles m ON p.id_modele = m.id_modele
                 LEFT JOIN marques mar ON p.id_marque = mar.id_marque
                 LEFT JOIN categories c ON p.id_categorie = c.id_categorie
                 LEFT JOIN unites u ON p.id_unite = u.id_unite
                 WHERE p.id_utilisateur = ?
                   AND (
                        p.nom LIKE ?
                        OR m.nom LIKE ?
                        OR mar.nom LIKE ?
                        OR c.nom LIKE ?
                        OR p.emplacement LIKE ?
                   )
                 ORDER BY p.nom ASC
                 LIMIT ${limitInt}`,
                [id_utilisateur, t, t, t, t, t]
            );

            // ========== 2. CLIENTS (table dédiée) ==========
            const [clients] = await pool.query(
                `SELECT
                    c.id_client,
                    c.nom,
                    c.telephone,
                    c.email,
                    c.ville,
                    c.pays,
                    c.adresse,
                    (
                        SELECT COUNT(*)
                        FROM commandes_vente cv
                        WHERE cv.id_utilisateur = c.id_utilisateur
                          AND (
                                cv.telephone = c.telephone
                                OR cv.nomclient = c.nom
                          )
                    ) AS nb_commandes
                 FROM clients c
                 WHERE c.id_utilisateur = ?
                   AND c.actif = TRUE
                   AND (
                        c.nom LIKE ?
                        OR c.telephone LIKE ?
                        OR c.email LIKE ?
                        OR c.ville LIKE ?
                   )
                 ORDER BY c.nom ASC
                 LIMIT ${limitInt}`,
                [id_utilisateur, t, t, t, t]
            );

            // ========== 3. FACTURES ==========
            const [factures] = await pool.query(
                `SELECT
                    fv.id_facture,
                    fv.numero_facture,
                    fv.date_facture,
                    fv.montant_total,
                    fv.statut,
                    cv.nomclient,
                    cv.telephone
                 FROM factures_vente fv
                 LEFT JOIN commandes_vente cv ON fv.id_commande = cv.id_commande
                 WHERE fv.id_utilisateur = ?
                   AND (
                        fv.numero_facture LIKE ?
                        OR cv.nomclient LIKE ?
                        OR cv.telephone LIKE ?
                   )
                 ORDER BY fv.date_facture DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur, t, t, t]
            );

            // ========== 4. COMMANDES DE VENTE ==========
            const [commandes] = await pool.query(
                `SELECT
                    cv.id_commande,
                    cv.numero_commande,
                    cv.date_commande,
                    cv.montant_total,
                    cv.statut,
                    cv.nomclient,
                    cv.telephone
                 FROM commandes_vente cv
                 WHERE cv.id_utilisateur = ?
                   AND (
                        cv.numero_commande LIKE ?
                        OR cv.nomclient LIKE ?
                        OR cv.telephone LIKE ?
                   )
                 ORDER BY cv.date_commande DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur, t, t, t]
            );

            // ========== 5. COMMANDES D'ACHAT ==========
            const [commandesAchat] = await pool.query(
                `SELECT
                    ca.id_commande_achat,
                    ca.numero_commande,
                    ca.date_commande,
                    ca.montant_total,
                    ca.statut,
                    f.nom AS fournisseur_nom
                 FROM commandes_achat ca
                 LEFT JOIN fournisseurs f ON ca.id_fournisseur = f.id_fournisseur
                 WHERE ca.id_utilisateur = ?
                   AND (
                        ca.numero_commande LIKE ?
                        OR f.nom LIKE ?
                   )
                 ORDER BY ca.date_commande DESC
                 LIMIT ${limitInt}`,
                [id_utilisateur, t, t]
            );

            // ========== 6. FOURNISSEURS ==========
            const [fournisseurs] = await pool.query(
                `SELECT
                    f.id_fournisseur,
                    f.nom,
                    f.telephone,
                    f.email,
                    f.ville,
                    f.pays
                 FROM fournisseurs f
                 WHERE f.id_utilisateur = ?
                   AND f.actif = TRUE
                   AND (
                        f.nom LIKE ?
                        OR f.telephone LIKE ?
                        OR f.email LIKE ?
                        OR f.ville LIKE ?
                   )
                 ORDER BY f.nom ASC
                 LIMIT ${limitInt}`,
                [id_utilisateur, t, t, t, t]
            );

            return {
                produits: produits.map(r => ({
                    id: r.id_produit,
                    nom: r.nom,
                    modele_nom: r.modele_nom,
                    marque_nom: r.marque_nom,
                    categorie_nom: r.categorie_nom,
                    prix_vente: parseFloat(r.prix_vente) || 0,
                    quantite_stock: parseFloat(r.quantite_stock) || 0,
                    statut: r.statut,
                    unite_symbole: r.unite_symbole,
                })),
                clients: clients.map(r => ({
                    id: r.id_client,
                    nom: r.nom,
                    telephone: r.telephone,
                    email: r.email,
                    ville: r.ville,
                    pays: r.pays,
                    adresse: r.adresse,
                    nb_commandes: parseInt(r.nb_commandes) || 0,
                })),
                factures: factures.map(r => ({
                    id: r.id_facture,
                    numero: r.numero_facture,
                    date: r.date_facture,
                    montant: parseFloat(r.montant_total) || 0,
                    statut: r.statut,
                    client: r.nomclient,
                    telephone: r.telephone,
                })),
                commandes: commandes.map(r => ({
                    id: r.id_commande,
                    numero: r.numero_commande,
                    date: r.date_commande,
                    montant: parseFloat(r.montant_total) || 0,
                    statut: r.statut,
                    client: r.nomclient,
                    telephone: r.telephone,
                })),
                commandes_achat: commandesAchat.map(r => ({
                    id: r.id_commande_achat,
                    numero: r.numero_commande,
                    date: r.date_commande,
                    montant: parseFloat(r.montant_total) || 0,
                    statut: r.statut,
                    fournisseur: r.fournisseur_nom,
                })),
                fournisseurs: fournisseurs.map(r => ({
                    id: r.id_fournisseur,
                    nom: r.nom,
                    telephone: r.telephone,
                    ville: r.ville,
                    email: r.email,
                })),
            };
        } catch (error) {
            console.error('❌ Erreur searchGlobal:', error);
            throw error;
        }
    }
}

export default Search;