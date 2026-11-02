// models/HorsLigne.js
//
// Mode hors ligne (ventes).
//   - catalogue() : tout ce qu'il faut pour vendre sans internet (produits, stock, unités de vente)
//   - synchroniser() : reçoit une vente faite hors ligne et l'enregistre UNE SEULE FOIS
//       1. réservation de l'identifiant local (clé unique) → pas de doublon même si l'appareil renvoie
//       2. création de la vente (stock insuffisant accepté : la vente a déjà eu lieu → signalé)
//       3. paiements, un par un, avec un compteur → reprise possible après une coupure
import { pool } from '../config/db.js';
import CommandeVente from './CommandeVente.js';

const ID_LOCAL_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MODES = ['especes', 'carte', 'virement', 'cheque', 'autre'];
const RESERVATION_EXPIREE_MS = 2 * 60 * 1000;

const erreur = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const dateSQL = (d) => {
    const x = new Date(d);
    return isNaN(x) ? null : x.toISOString().slice(0, 19).replace('T', ' ');
};

class HorsLigne {
    /** Produits (avec stock, prix et unités de vente actives) pour vendre hors ligne. */
    static async catalogue(idUtilisateur) {
        const [produits] = await pool.query(
            `SELECT p.id_produit, p.nom, p.prix_vente, p.prix_achat, p.quantite_stock, p.statut,
                    md.nom AS modele_nom, c.nom AS categorie_nom, m.nom AS marque_nom,
                    u.nom AS unite_nom, u.symbole AS unite_symbole
             FROM produits p
             LEFT JOIN modeles md ON md.id_modele = p.id_modele
             LEFT JOIN categories c ON c.id_categorie = p.id_categorie
             LEFT JOIN marques m ON m.id_marque = p.id_marque
             LEFT JOIN unites u ON u.id_unite = p.id_unite
             WHERE p.id_utilisateur = ?
             ORDER BY p.nom ASC`,
            [idUtilisateur]
        );

        const [unites] = await pool.query(
            `SELECT uv.id_unite_vente, uv.id_produit, uv.nom, uv.quantite_base, uv.prix_vente, uv.prix_achat, uv.est_principal
             FROM unites_vente uv
             JOIN produits p ON p.id_produit = uv.id_produit AND p.id_utilisateur = ?
             WHERE uv.actif = TRUE
             ORDER BY uv.est_principal DESC, uv.quantite_base ASC`,
            [idUtilisateur]
        );
        const parProduit = new Map();
        unites.forEach((u) => {
            if (!parProduit.has(u.id_produit)) parProduit.set(u.id_produit, []);
            parProduit.get(u.id_produit).push({
                id_unite_vente: u.id_unite_vente,
                nom: u.nom,
                quantite_base: num(u.quantite_base) || 1,
                prix_vente: num(u.prix_vente),
                prix_achat: num(u.prix_achat),
                est_principal: !!u.est_principal,
            });
        });

        return {
            genere_le: new Date().toISOString(),
            produits: produits.map((p) => ({
                ...p,
                prix_vente: num(p.prix_vente),
                prix_achat: num(p.prix_achat),
                quantite_stock: num(p.quantite_stock),
                unites_vente: parProduit.get(p.id_produit) || [],
            })),
        };
    }

    /** Contrôle de forme d'une vente envoyée par l'appareil. */
    static _valider(v) {
        if (!v || typeof v !== 'object') throw erreur('Vente invalide');
        if (!ID_LOCAL_RE.test(String(v.id_local || ''))) throw erreur('Identifiant local de la vente invalide');
        if (!Array.isArray(v.lignes) || v.lignes.length === 0) throw erreur('Vente sans produit');
        if (v.lignes.length > 200) throw erreur('Trop de lignes dans la vente');
        v.lignes.forEach((l) => {
            if (!Number.isInteger(Number(l.id_produit)) || !(parseFloat(l.quantite) > 0)) throw erreur('Ligne de vente invalide');
        });
        const paiements = Array.isArray(v.paiements) ? v.paiements : [];
        if (paiements.length > 20) throw erreur('Trop de paiements');
        paiements.forEach((p) => {
            if (!(parseFloat(p.montant) > 0)) throw erreur('Montant de paiement invalide');
        });
        return paiements;
    }

    /**
     * Enregistre une vente faite hors ligne.
     * → { id_local, statut: 'synchronisee' | 'deja_recue' | 'en_cours', id_commande, numero_commande,
     *     numero_facture, ruptures: [...], avertissements: [...] }
     */
    static async synchroniser(idUtilisateur, v, vendeur) {
        const paiements = HorsLigne._valider(v);
        const idLocal = String(v.id_local);
        const dateLocale = dateSQL(v.date_vente) || dateSQL(Date.now());

        // ---------- 1. Réservation de l'identifiant local ----------
        let ligne;
        try {
            await pool.execute(
                `INSERT INTO ventes_hors_ligne
                    (id_utilisateur, id_local, numero_provisoire, date_vente_locale, vendeur_type, vendeur_id, vendeur_nom)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [idUtilisateur, idLocal, String(v.numero_provisoire || '').slice(0, 50) || null, dateLocale,
                 vendeur.type, vendeur.id, vendeur.nom]
            );
        } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY') throw e;
            const [rows] = await pool.query(
                'SELECT * FROM ventes_hors_ligne WHERE id_utilisateur = ? AND id_local = ?',
                [idUtilisateur, idLocal]
            );
            ligne = rows[0];
        }

        // Déjà reçue (ou en cours de réception par une autre requête)
        if (ligne) {
            if (!ligne.id_commande) {
                const age = Date.now() - new Date(ligne.date_reception).getTime();
                if (age < RESERVATION_EXPIREE_MS) {
                    return { id_local: idLocal, statut: 'en_cours' };
                }
                // Réservation abandonnée (coupure pendant la création) : on reprend
                await pool.execute('UPDATE ventes_hors_ligne SET date_reception = UTC_TIMESTAMP() WHERE id = ?', [ligne.id]);
            } else {
                const avertissements = await HorsLigne._appliquerPaiements(idUtilisateur, ligne, paiements, v);
                const c = await CommandeVente.findById(ligne.id_commande, idUtilisateur);
                return {
                    id_local: idLocal,
                    statut: 'deja_recue',
                    id_commande: ligne.id_commande,
                    numero_commande: c?.numero_commande || null,
                    numero_facture: c?.numero_facture || null,
                    ruptures: [],
                    avertissements,
                };
            }
        }
        if (!ligne) {
            const [rows] = await pool.query(
                'SELECT * FROM ventes_hors_ligne WHERE id_utilisateur = ? AND id_local = ?',
                [idUtilisateur, idLocal]
            );
            ligne = rows[0];
        }

        // ---------- 2. Stock insuffisant ? (on enregistre quand même, on signale) ----------
        const besoin = new Map();
        v.lignes.forEach((l) => {
            const base = l.quantite_totale_base != null
                ? parseFloat(l.quantite_totale_base)
                : parseFloat(l.quantite) * (parseFloat(l.quantite_base) || 1);
            besoin.set(Number(l.id_produit), (besoin.get(Number(l.id_produit)) || 0) + (base || 0));
        });
        const ids = [...besoin.keys()];
        const [stocks] = await pool.query(
            `SELECT id_produit, nom, quantite_stock FROM produits WHERE id_utilisateur = ? AND id_produit IN (${ids.map(() => '?').join(',')})`,
            [idUtilisateur, ...ids]
        );
        const ruptures = stocks
            .filter((p) => besoin.get(p.id_produit) > (parseFloat(p.quantite_stock) || 0) + 0.0001)
            .map((p) => ({
                id_produit: p.id_produit,
                produit: p.nom,
                stock_avant: num(p.quantite_stock),
                vendu: num(besoin.get(p.id_produit)),
                stock_apres: num((parseFloat(p.quantite_stock) || 0) - besoin.get(p.id_produit)),
            }));

        // ---------- 3. Création de la vente ----------
        const quand = new Date(v.date_vente || Date.now());
        const heure = isNaN(quand) ? '' : ` à ${String(quand.getUTCHours()).padStart(2, '0')}:${String(quand.getUTCMinutes()).padStart(2, '0')}`;
        const notes = [`Vente faite hors ligne${heure}${v.numero_provisoire ? ` (n° provisoire ${v.numero_provisoire})` : ''}`
            + `${vendeur.nom ? ` par ${vendeur.nom}` : ''}`, v.notes ? String(v.notes).slice(0, 500) : null]
            .filter(Boolean).join(' · ');

        let commande;
        try {
            commande = await CommandeVente.create({
                nomclient: v.nomclient ? String(v.nomclient).slice(0, 200) : null,
                telephone: v.telephone ? String(v.telephone).slice(0, 200) : null,
                date_commande: (dateLocale || '').slice(0, 10),
                notes,
                id_utilisateur: idUtilisateur,
                mode_paiement: MODES.includes(v.mode_paiement) ? v.mode_paiement : 'especes',
                date_echeance: v.date_echeance || null,
                autoriser_stock_negatif: true,
                lignes: v.lignes.map((l) => ({
                    id_produit: Number(l.id_produit),
                    id_unite_vente: l.id_unite_vente || null,
                    nom_unite_vente: l.nom_unite_vente || 'Unité',
                    quantite_base: parseFloat(l.quantite_base) || 1,
                    quantite: parseFloat(l.quantite),
                    quantite_totale_base: l.quantite_totale_base != null ? parseFloat(l.quantite_totale_base) : null,
                    prix_vente: parseFloat(l.prix_vente) || 0,
                    remise: parseFloat(l.remise) || 0,
                })),
            });
        } catch (e) {
            // Vente impossible à enregistrer (produit supprimé, prix manquant…) : on libère l'identifiant
            await pool.execute('DELETE FROM ventes_hors_ligne WHERE id = ? AND id_commande IS NULL', [ligne.id]).catch(() => {});
            throw erreur(e.message || 'Vente refusée par le serveur', 422);
        }

        await pool.execute(
            'UPDATE ventes_hors_ligne SET id_commande = ?, stock_force = ? WHERE id = ?',
            [commande.id_commande, ruptures.length ? 1 : 0, ligne.id]
        );
        ligne = { ...ligne, id_commande: commande.id_commande, paiements_appliques: 0 };

        // ---------- 4. Paiements ----------
        const avertissements = await HorsLigne._appliquerPaiements(idUtilisateur, ligne, paiements, v);
        const c = await CommandeVente.findById(commande.id_commande, idUtilisateur);

        return {
            id_local: idLocal,
            statut: 'synchronisee',
            id_commande: commande.id_commande,
            numero_commande: c?.numero_commande || commande.numero_commande,
            numero_facture: c?.numero_facture || null,
            montant_total: num(c?.montant_total),
            total_paye: num(c?.total_paye),
            ruptures,
            avertissements,
        };
    }

    /** Applique les paiements pas encore enregistrés (compteur paiements_appliques). */
    static async _appliquerPaiements(idUtilisateur, ligne, paiements, v) {
        const avertissements = [];
        for (let i = Number(ligne.paiements_appliques) || 0; i < paiements.length; i++) {
            const p = paiements[i];
            try {
                await CommandeVente.addPaiement(ligne.id_commande, {
                    id_facture: null,
                    date_paiement: (dateSQL(p.date) || dateSQL(v.date_vente) || dateSQL(Date.now())).slice(0, 10),
                    montant: num(p.montant),
                    mode_paiement: MODES.includes(p.mode_paiement) ? p.mode_paiement : 'especes',
                    note: `Paiement hors ligne${v.numero_provisoire ? ` (${v.numero_provisoire})` : ''}`,
                    reference: p.reference ? String(p.reference).slice(0, 100) : null,
                }, idUtilisateur);
            } catch (e) {
                avertissements.push(`Paiement de ${num(p.montant)} FCFA non enregistré : ${e.message}`);
            }
            // Compté même en cas d'échec : on ne le renverra pas en boucle (l'avertissement le signale)
            await pool.execute('UPDATE ventes_hors_ligne SET paiements_appliques = ? WHERE id = ?', [i + 1, ligne.id]);
        }
        return avertissements;
    }

    /** Dernières ventes hors ligne reçues (pour vérifier le stock forcé). */
    static async historique(idUtilisateur, limite = 50) {
        const [rows] = await pool.query(
            `SELECT vh.id_local, vh.numero_provisoire, vh.id_commande, vh.stock_force, vh.date_vente_locale,
                    vh.vendeur_nom, vh.date_reception, cv.numero_commande, cv.nomclient, cv.montant_total
             FROM ventes_hors_ligne vh
             LEFT JOIN commandes_vente cv ON cv.id_commande = vh.id_commande
             WHERE vh.id_utilisateur = ? AND vh.id_commande IS NOT NULL
             ORDER BY vh.date_reception DESC LIMIT ?`,
            [idUtilisateur, Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200)]
        );
        return rows.map((r) => ({ ...r, stock_force: !!r.stock_force, montant_total: num(r.montant_total) }));
    }
}

export default HorsLigne;
