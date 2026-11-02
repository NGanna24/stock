-- Relances clients (rappels d'impayés envoyés par WhatsApp / SMS / appel)
-- Le client est identifié par son téléphone (comme dans commandes_vente).
CREATE TABLE IF NOT EXISTS relances_clients (
    id_relance INT PRIMARY KEY AUTO_INCREMENT,
    id_utilisateur INT NOT NULL,
    telephone VARCHAR(200) NOT NULL,
    nomclient VARCHAR(200),
    canal ENUM('whatsapp', 'sms', 'appel', 'autre') NOT NULL DEFAULT 'whatsapp',
    montant_du DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    nb_factures INT NOT NULL DEFAULT 0,
    factures VARCHAR(500),
    message TEXT,
    note VARCHAR(255),
    par_type ENUM('utilisateur', 'employe') NOT NULL DEFAULT 'utilisateur',
    par_id INT NOT NULL,
    par_nom VARCHAR(100),
    date_relance DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_relance_client (id_utilisateur, telephone, date_relance),
    INDEX idx_relance_date (id_utilisateur, date_relance),
    FOREIGN KEY (id_utilisateur) REFERENCES utilisateurs(id_utilisateur) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
