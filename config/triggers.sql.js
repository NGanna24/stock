// config/triggers.sql.js
const triggers = `
-- Trigger pour mettre à jour le stock après une entrée validée
CREATE TRIGGER after_entree_stock
AFTER INSERT ON entrees_stock
FOR EACH ROW
BEGIN
    IF NEW.statut = 'valide' THEN
        UPDATE produits 
        SET quantite_stock = quantite_stock + NEW.quantite_recue
        WHERE id_produit = NEW.id_produit;
        
        INSERT INTO mouvements_stock (
            id_produit, 
            type_mouvement, 
            quantite, 
            ancienne_quantite, 
            nouvelle_quantite, 
            id_reference, 
            type_reference, 
            id_utilisateur,
            notes
        )
        SELECT 
            NEW.id_produit,
            'entree',
            NEW.quantite_recue,
            (SELECT quantite_stock FROM produits WHERE id_produit = NEW.id_produit) - NEW.quantite_recue,
            (SELECT quantite_stock FROM produits WHERE id_produit = NEW.id_produit),
            NEW.id_entree,
            'entree_stock',
            NEW.id_utilisateur,
            NEW.notes;
    END IF;
END;

-- Trigger pour mettre à jour le stock après une sortie validée
CREATE TRIGGER after_sortie_stock
AFTER INSERT ON sorties_stock
FOR EACH ROW
BEGIN
    IF NEW.statut = 'valide' THEN
        UPDATE produits 
        SET quantite_stock = quantite_stock - NEW.quantite_sortie
        WHERE id_produit = NEW.id_produit;
        
        INSERT INTO mouvements_stock (
            id_produit, 
            type_mouvement, 
            quantite, 
            ancienne_quantite, 
            nouvelle_quantite, 
            id_reference, 
            type_reference, 
            id_utilisateur,
            notes
        )
        SELECT 
            NEW.id_produit,
            'sortie',
            NEW.quantite_sortie,
            (SELECT quantite_stock FROM produits WHERE id_produit = NEW.id_produit) + NEW.quantite_sortie,
            (SELECT quantite_stock FROM produits WHERE id_produit = NEW.id_produit),
            NEW.id_sortie,
            'sortie_stock',
            NEW.id_utilisateur,
            NEW.notes;
    END IF;
END;

-- Trigger pour mettre à jour le stock après un transfert
CREATE TRIGGER after_transfert_ligne
AFTER INSERT ON transfert_lignes
FOR EACH ROW
BEGIN
    UPDATE produits 
    SET quantite_stock = quantite_stock - NEW.quantite
    WHERE id_produit = NEW.id_produit;
END;
`;

export default { triggers };