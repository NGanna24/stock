// controllers/ImportProduitController.js
// Import de produits depuis Excel : modèle à remplir, aperçu vérifié, puis import.
import { lireClasseur, analyser, importer, modeleExcel } from '../Services/ImportProduits.js';

const oui = (v) => v === true || v === 'true' || v === '1' || v === 1;

const erreur = (res, e, quoi) => {
  if (!e.status) console.error(`❌ Import produits (${quoi}) :`, e);
  return res.status(e.status || 500).json({ success: false, message: e.status ? e.message : "Erreur pendant l'import. Réessaie." });
};

class ImportProduitController {
  /** GET /api/produits/import/modele : fichier Excel vide à remplir */
  static async modele(req, res) {
    try {
      const buffer = await modeleExcel(req.workspaceId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="fiche-produits-miyo.xlsx"');
      return res.send(Buffer.from(buffer));
    } catch (e) {
      return erreur(res, e, 'modèle');
    }
  }

  /** POST /api/produits/import/apercu (fichier « fichier ») : lit et vérifie, n'enregistre rien */
  static async apercu(req, res) {
    try {
      if (!req.file?.buffer) return res.status(400).json({ success: false, message: 'Choisis un fichier Excel.' });
      const lu = await lireClasseur(req.file.buffer);
      const verifie = await analyser(lu.lignes, req.workspaceId, { mettreAJour: oui(req.body?.mettre_a_jour) });
      return res.json({
        success: true,
        data: { feuille: lu.feuille, colonnes: lu.colonnes, colonnes_ignorees: lu.ignorees, ...verifie },
      });
    } catch (e) {
      return erreur(res, e, 'aperçu');
    }
  }

  /** POST /api/produits/import (fichier « fichier » + id_fournisseur + id_unite + id_categorie ou categorie_nom
   *  + mettre_a_jour : compléter les prix des produits déjà présents)
   *  Le fichier est relu ici : on n'enregistre que ce que le serveur a lui-même vérifié. */
  static async importer(req, res) {
    try {
      if (!req.file?.buffer) return res.status(400).json({ success: false, message: 'Choisis un fichier Excel.' });
      const { id_fournisseur, id_unite, id_categorie, categorie_nom, mettre_a_jour } = req.body || {};
      const lu = await lireClasseur(req.file.buffer);
      const r = await importer(
        { lignes: lu.lignes, id_fournisseur, id_unite, id_categorie, categorie_nom, mettre_a_jour: oui(mettre_a_jour) },
        req.workspaceId
      );
      const morceaux = [];
      if (r.crees) morceaux.push(`${r.crees} produit${r.crees > 1 ? 's' : ''} importé${r.crees > 1 ? 's' : ''}`);
      if (r.mis_a_jour) morceaux.push(`${r.mis_a_jour} mis à jour`);
      return res.status(201).json({ success: true, message: `${morceaux.join(', ')}.`, data: r });
    } catch (e) {
      return erreur(res, e, 'import');
    }
  }
}

export default ImportProduitController;
