// Services/toolss/toolDefinitions.js

export const toolDefinitions = [
  // ============================================================
  // NO-OP : salutations, remerciements, hors-sujet
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'aucune_action',
      description:
        "Utilise cet outil pour les salutations ('bonjour', 'salut'), remerciements ('merci'), ou questions hors-sujet (météo, blague, heure). Ne renvoie rien.",
      parameters: {
        type: 'object',
        properties: {
          raison: {
            type: 'string',
            description: "Pourquoi aucune action n'est nécessaire",
          },
        },
      },
    },
  },

  // ============================================================
  // PRODUITS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'rechercher_produit',
      description:
        "Cherche un produit par son nom. Utilise cet outil quand l'utilisateur parle d'un produit précis (ex: 'combien de bidons d'huile', 'le prix du filtre', 'j'ai combien de bougies').",
      parameters: {
        type: 'object',
        properties: {
          nom: {
            type: 'string',
            description:
              "Nom du produit ou partie du nom (ex: 'bougie', 'filtre', 'huile')",
          },
        },
        required: ['nom'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'lister_produits',
      description:
        "Donne la liste de tous les produits en stock. Utilise cet outil quand l'utilisateur dit 'quels sont mes produits', 'liste mes produits', 'montre-moi mon stock'.",
      parameters: {
        type: 'object',
        properties: {
          limite: {
            type: 'number',
            description: 'Nombre max de produits (défaut 30, max 100)',
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'details_produit',
      description:
        "Donne la fiche complète d'un produit : prix, marge, stock, catégorie, mouvements récents. Utilise cet outil pour 'parle-moi du produit X', 'détails sur l'huile', 'fiche produit bougie'.",
      parameters: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Nom du produit' },
        },
        required: ['nom'],
      },
    },
  },

  // ============================================================
  // ALERTES STOCK
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'produits_en_rupture',
      description:
        "Liste les produits en rupture (stock = 0). Utilise pour 'ruptures', 'épuisés', 'qu'est-ce qui est terminé'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'produits_stock_bas',
      description:
        "Liste les produits dont le stock est proche du minimum. Utilise pour 'stock faible', 'bientôt épuisé', 'à commander'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // STATISTIQUES STOCK
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'stats_generales',
      description:
        "Résumé général du stock : nombre de produits, ruptures, stocks bas, valeur. Utilise pour 'comment va mon stock', 'fais-moi un résumé', 'combien j'ai de produits'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'valeur_stock',
      description:
        "Valeur totale du stock (achat, vente, marge). Utilise pour 'combien vaut mon stock', 'ma marchandise vaut combien'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'stock_par_categorie',
      description:
        "Répartition du stock par catégorie. Utilise pour 'mes catégories', 'quelle catégorie me rapporte le plus'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'stock_par_fournisseur',
      description:
        "Répartition du stock par fournisseur. Utilise pour 'stock par fournisseur'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // VENTES & FINANCES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'chiffre_affaires',
      description:
        "Chiffre d'affaires sur une période. Utilise pour 'mes ventes ce mois', 'combien j'ai vendu cette semaine', 'CA du mois'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: {
            type: 'string',
            description: 'Date début YYYY-MM-DD (défaut: 1er du mois)',
          },
          date_fin: {
            type: 'string',
            description: "Date fin YYYY-MM-DD (défaut: aujourd'hui)",
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'top_produits',
      description:
        "Produits les plus vendus sur une période. Utilise pour 'meilleurs produits', 'top ventes', 'ce qui marche le mieux'.",
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre (défaut 5, max 10)' },
          date_debut: { type: 'string', description: 'YYYY-MM-DD (défaut: -30j)' },
          date_fin: { type: 'string', description: "YYYY-MM-DD (défaut: aujourd'hui)" },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'ventes_produit_periode',
      description:
        "Ventes d'un produit précis sur une période. Utilise pour 'combien j'ai vendu de filtres cette semaine', 'ventes de bougies ce mois'.",
      parameters: {
        type: 'object',
        properties: {
          nom_produit: { type: 'string', description: 'Nom du produit' },
          date_debut: { type: 'string', description: 'YYYY-MM-DD (défaut: -30j)' },
          date_fin: { type: 'string', description: "YYYY-MM-DD (défaut: aujourd'hui)" },
        },
        required: ['nom_produit'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'produits_non_vendus',
      description:
        "Produits qui ne se vendent plus depuis X jours. Utilise pour 'produits qui dorment', 'rien vendu depuis 3 mois'.",
      parameters: {
        type: 'object',
        properties: {
          jours: { type: 'number', description: 'Nombre de jours (défaut 90)' },
          limite: { type: 'number', description: 'Nombre max (défaut 20)' },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'comparer_ventes_periodes',
      description:
        "Compare le chiffre d'affaires entre 2 périodes. Utilise pour 'compare ce mois vs le mois dernier', 'évolution de mes ventes'.",
      parameters: {
        type: 'object',
        properties: {
          periode1_debut: { type: 'string', description: 'YYYY-MM-DD' },
          periode1_fin: { type: 'string', description: 'YYYY-MM-DD' },
          periode2_debut: { type: 'string', description: 'YYYY-MM-DD' },
          periode2_fin: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: [
          'periode1_debut',
          'periode1_fin',
          'periode2_debut',
          'periode2_fin',
        ],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'benefices_periode',
      description:
        "Bénéfices (marge) sur une période. Utilise pour 'mes bénéfices', 'combien j'ai gagné', 'ma marge ce mois'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: {
            type: 'string',
            description: 'YYYY-MM-DD (défaut: 1er du mois)',
          },
          date_fin: {
            type: 'string',
            description: "YYYY-MM-DD (défaut: aujourd'hui)",
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'factures_impayees',
      description:
        "Liste des factures non payées. Utilise pour 'factures impayées', 'qui me doit', 'créances'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // COMMANDES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'commandes_en_attente',
      description:
        "Commandes clients en attente. Utilise pour 'commandes en attente', 'à traiter', 'à préparer'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'commandes_par_periode',
      description:
        "Commandes de vente sur une période. Utilise pour 'commandes cette semaine', 'commandes de janvier'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: 'YYYY-MM-DD' },
          date_fin: { type: 'string', description: 'YYYY-MM-DD' },
          statut: {
            type: 'string',
            description:
              "Filtre optionnel : 'en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee'",
          },
        },
        required: ['date_debut', 'date_fin'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'commandes_par_statut',
      description:
        "Commandes par statut. Utilise pour 'commandes livrées', 'commandes annulées', 'commandes confirmées'.",
      parameters: {
        type: 'object',
        properties: {
          statut: {
            type: 'string',
            description:
              "'en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee'",
          },
          limite: { type: 'number', description: 'Nombre max (défaut 20)' },
        },
        required: ['statut'],
      },
    },
  },

  // ============================================================
  // CLIENTS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'rechercher_client',
      description:
        "Cherche un client par téléphone. Utilise pour 'c'est qui ce numéro', 'le client au 0140010385'.",
      parameters: {
        type: 'object',
        properties: {
          telephone: { type: 'string', description: 'Numéro de téléphone' },
        },
        required: ['telephone'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'top_clients',
      description:
        "Meilleurs clients sur une période. Utilise pour 'mes meilleurs clients', 'top clients'.",
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre (défaut 5)' },
          date_debut: { type: 'string', description: 'YYYY-MM-DD (défaut: -90j)' },
          date_fin: { type: 'string', description: "YYYY-MM-DD (défaut: aujourd'hui)" },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'details_client',
      description:
        "Fiche complète d'un client : historique, total dépensé, dernière commande. Utilise pour 'parle-moi du client Dupont', 'historique du 0140010385'.",
      parameters: {
        type: 'object',
        properties: {
          nom_ou_telephone: {
            type: 'string',
            description: 'Nom du client OU numéro de téléphone',
          },
        },
        required: ['nom_ou_telephone'],
      },
    },
  },

  // ============================================================
  // BOUTIQUE
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'info_boutique',
      description:
        "Infos de la boutique : nom, adresse, téléphone, email. Utilise pour 'comment s'appelle ma boutique', 'mon adresse'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // FOURNISSEURS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'lister_fournisseurs',
      description:
        "Liste des fournisseurs. Utilise pour 'mes fournisseurs', 'qui sont mes fournisseurs'.",
      parameters: {
        type: 'object',
        properties: {
          recherche: {
            type: 'string',
            description: 'Recherche par nom (optionnel)',
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'details_fournisseur',
      description:
        "Fiche complète d'un fournisseur. Utilise pour 'parle-moi du fournisseur ABC', 'fiche fournisseur X'.",
      parameters: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Nom du fournisseur' },
        },
        required: ['nom'],
      },
    },
  },

  // ============================================================
  // CATÉGORIES & MARQUES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'lister_categories',
      description:
        "Liste des catégories. Utilise pour 'mes catégories', 'quelles catégories j'ai'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'lister_marques',
      description:
        "Liste des marques. Utilise pour 'mes marques', 'quelles marques j'ai'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // MOUVEMENTS DE STOCK
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'derniers_mouvements',
      description:
        "Derniers mouvements de stock (entrées, sorties). Utilise pour 'qu'est-ce qui a bougé', 'activité récente'.",
      parameters: {
        type: 'object',
        properties: {
          limite: {
            type: 'number',
            description: 'Nombre de mouvements (défaut 10, max 30)',
          },
        },
      },
    },
  },

  // ============================================================
  // DÉPENSES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'depenses_periode',
      description:
        "Dépenses sur une période. Utilise pour 'combien j'ai dépensé', 'mes dépenses', 'mes charges'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: {
            type: 'string',
            description: 'YYYY-MM-DD (défaut: 1er du mois)',
          },
          date_fin: {
            type: 'string',
            description: "YYYY-MM-DD (défaut: aujourd'hui)",
          },
        },
      },
    },
  },

  // ============================================================
  // RETOURS CLIENTS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'retours_clients_recents',
      description:
        "Derniers retours clients. Utilise pour 'mes retours', 'produits retournés'.",
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre (défaut 10)' },
        },
      },
    },
  },

  // ============================================================
  // INVENTAIRES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'inventaires_recents',
      description:
        "Derniers inventaires. Utilise pour 'mes inventaires', 'inventaires en cours'.",
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre max (défaut 10)' },
          statut: {
            type: 'string',
            description: "'planifie', 'en_cours', 'termine', 'annule'",
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'details_inventaire',
      description:
        "Détails d'un inventaire (lignes, écarts). Utilise pour 'détails inventaire INV-001', 'écarts de l'inventaire'.",
      parameters: {
        type: 'object',
        properties: {
          reference: {
            type: 'string',
            description: "Référence de l'inventaire",
          },
        },
        required: ['reference'],
      },
    },
  },

  // ============================================================
  // EMPLOYÉS / MAGASINS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'lister_employes',
      description:
        "Liste des employés. Utilise pour 'mes employés', 'qui travaille chez moi'.",
      parameters: {
        type: 'object',
        properties: {
          actif_seulement: {
            type: 'boolean',
            description: 'Si true, seulement les employés actifs',
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'lister_magasins',
      description:
        "Liste des magasins. Utilise pour 'mes magasins', 'mes points de vente'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // RAPPORTS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'rapport_ventes_complet',
      description:
        "Rapport complet des ventes (commandes + factures). Utilise pour 'rapport de ventes', 'bilan des ventes'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: 'YYYY-MM-DD' },
          date_fin: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['date_debut', 'date_fin'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'rapport_stocks_complet',
      description:
        "Rapport complet du stock avec état (Normal / Alerte). Utilise pour 'rapport de stock', 'bilan du stock'.",
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre max (défaut 50)' },
        },
      },
    },
  },

  // ============================================================
  // ACTION : préparer une vente (rien n'est enregistré sans confirmation)
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'preparer_vente',
      description:
        "Prépare une VENTE quand l'utilisateur veut vendre ou enregistrer une vente (ex: 'vends 2 cartons d'huile à Awa', 'mets 3 bougies pour Koffi, il a payé', 'enregistre une vente de 5 filtres'). " +
        "La vente n'est PAS enregistrée : l'application affiche un récapitulatif que le vendeur doit confirmer. " +
        "Mets une ligne par produit ET par unité : '2 cartons et 3 bidons d'huile' = 2 lignes (huile/carton/2 et huile/bidon/3).",
      parameters: {
        type: 'object',
        properties: {
          lignes: {
            type: 'array',
            description: 'Produits vendus',
            items: {
              type: 'object',
              properties: {
                produit: { type: 'string', description: "Nom du produit tel que dit (ex: 'huile 5L', 'bougie')" },
                quantite: { type: 'number', description: 'Nombre vendu dans cette unité' },
                unite: { type: 'string', description: "Unité dite (ex: 'carton', 'bidon', 'pièce'). Vide si non précisée." },
                prix_unitaire: { type: 'number', description: "Prix par unité SEULEMENT si l'utilisateur le donne" },
              },
              required: ['produit', 'quantite'],
            },
          },
          client: { type: 'string', description: 'Nom du client si donné' },
          telephone: { type: 'string', description: 'Téléphone du client si donné' },
          paiement: {
            type: 'object',
            description: "Seulement si l'utilisateur dit que le client a payé",
            properties: {
              mode: { type: 'string', enum: ['especes', 'wave', 'orange_money', 'mtn_momo', 'moov_money', 'carte', 'virement', 'cheque'] },
              montant: { type: 'number', description: 'Montant payé si différent du total' },
            },
          },
        },
        required: ['lignes'],
      },
    },
  },
  // ============================================================
  // OÙ EST RANGÉ UN PRODUIT
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'emplacement_produit',
      description: "Dit OÙ est rangé un produit dans la boutique (emplacement, rayon, étagère). Ex: 'où se trouve l'huile 5L ?', 'les bougies sont où ?', 'où j'ai mis les filtres ?'.",
      parameters: {
        type: 'object',
        properties: { nom: { type: 'string', description: 'Nom du produit tel que dit' } },
        required: ['nom'],
      },
    },
  },

  // ============================================================
  // CLIENTS QUI DOIVENT DE L'ARGENT
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'clients_qui_doivent',
      description: "Liste les CLIENTS QUI DOIVENT de l'argent (crédits, dettes clients) avec le montant de chacun et le total. Ex: 'qui me doit ?', 'les clients qui doivent', 'combien on me doit ?', 'est-ce que Koffi me doit ?', 'les crédits'.",
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: "Nom ou téléphone d'un client précis, seulement si la question porte sur lui" },
          limite: { type: 'number', description: 'Nombre de clients à citer (5 par défaut)' },
        },
      },
    },
  },

  // ============================================================
  // ARGENT ENCAISSÉ
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'encaissements_periode',
      description: "Dit combien d'argent a été ENCAISSÉ (vraiment reçu) sur une période, par moyen de paiement : espèces, Wave, Orange Money, MTN, Moov. Ex: 'combien j'ai encaissé aujourd'hui ?', 'l'argent rentré hier', 'combien en Wave cette semaine ?'. Différent du chiffre d'affaires : une vente à crédit n'est pas encaissée.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: "AAAA-MM-JJ (aujourd'hui si absent)" },
          date_fin: { type: 'string', description: "AAAA-MM-JJ (aujourd'hui si absent)" },
        },
      },
    },
  },

  // ============================================================
  // ACTION : préparer une commande au fournisseur (rien n'est enregistré sans confirmation)
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'preparer_commande_achat',
      description:
        "Prépare une COMMANDE AU FOURNISSEUR (réapprovisionnement) quand l'utilisateur veut commander ou acheter des produits pour la boutique. Ex: 'commande 10 cartons d'huile chez Yuxing', 'il faut commander des bougies', 'commande ce qui manque'. " +
        "La commande n'est PAS enregistrée : l'application affiche un récapitulatif à confirmer. Une ligne par produit et par unité. " +
        "Pour 'commande ce qui manque' : appelle d'abord produits_stock_bas ou produits_en_rupture, puis mets ces produits dans les lignes (quantité vide = quantité proposée).",
      parameters: {
        type: 'object',
        properties: {
          fournisseur: { type: 'string', description: 'Nom du fournisseur si dit (sinon le fournisseur habituel des produits)' },
          lignes: {
            type: 'array',
            description: 'Produits à commander',
            items: {
              type: 'object',
              properties: {
                produit: { type: 'string', description: 'Nom du produit tel que dit' },
                quantite: { type: 'number', description: 'Quantité dans cette unité (vide si non dite)' },
                unite: { type: 'string', description: "Unité dite (ex: 'carton', 'pièce'). Vide si non précisée." },
                prix_unitaire: { type: 'number', description: "Prix d'achat par unité SEULEMENT si l'utilisateur le donne" },
              },
              required: ['produit'],
            },
          },
        },
        required: ['lignes'],
      },
    },
  },
  // ============================================================
  // LA CAISSE
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'etat_caisse',
      description: "Dit combien il y a d'espèces DANS LA CAISSE (tiroir) maintenant, si la caisse est ouverte, depuis quand et par qui, ou la dernière fermeture. Ex: 'combien il y a dans la caisse ?', 'la caisse est ouverte ?', 'combien je dois trouver dans le tiroir ?', 'la caisse d'hier soir'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  // ============================================================
  // CE QUE JE DOIS AUX FOURNISSEURS
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'dettes_fournisseurs',
      description: "Dit combien JE DOIS AUX FOURNISSEURS (dettes fournisseurs, crédit chez eux), le total et par fournisseur, ou pour un fournisseur précis (avec son plafond et le crédit encore disponible). Ex: 'je dois combien à Yuxing ?', 'mes dettes fournisseurs', 'à qui je dois de l'argent ?'.",
      parameters: {
        type: 'object',
        properties: { fournisseur: { type: 'string', description: 'Nom du fournisseur, seulement si la question porte sur lui' } },
      },
    },
  },

  // ============================================================
  // VENTES PAR VENDEUR
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'ventes_par_vendeur',
      description: "Ventes de chaque VENDEUR (employé) sur une période : qui a le plus vendu, combien un vendeur a vendu. Ex: 'qui a le plus vendu aujourd'hui ?', 'combien Awa a vendu cette semaine ?', 'les ventes des vendeurs'.",
      parameters: {
        type: 'object',
        properties: {
          vendeur: { type: 'string', description: "Nom du vendeur, seulement si la question porte sur lui" },
          date_debut: { type: 'string', description: "AAAA-MM-JJ (aujourd'hui si absent)" },
          date_fin: { type: 'string', description: "AAAA-MM-JJ (aujourd'hui si absent)" },
        },
      },
    },
  },

  // ============================================================
  // SUIVI DES COMMANDES FOURNISSEUR
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'suivi_commandes_fournisseur',
      description: "Suivi des COMMANDES PASSÉES AUX FOURNISSEURS : arrivées ou pas, ce qui reste à recevoir. Ex: 'ma commande chez Yuxing est arrivée ?', 'qu'est-ce qui reste à recevoir ?', 'mes commandes en attente chez les fournisseurs'.",
      parameters: {
        type: 'object',
        properties: {
          fournisseur: { type: 'string', description: 'Nom du fournisseur, seulement si la question porte sur lui' },
          inclure_recues: { type: 'boolean', description: 'true pour voir aussi les commandes déjà arrivées (30 derniers jours)' },
        },
      },
    },
  },
  // ============================================================
  // STOCK À L'ENTREPÔT
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'stock_entrepot',
      description: "Stock à l'ENTREPÔT (pas en boutique) : combien il reste d'un produit à l'entrepôt, ou le résumé de l'entrepôt (ruptures, presque finis). Ex: 'il reste combien d'huile à l'entrepôt ?', 'qu'est-ce qui manque à l'entrepôt ?', 'y a des bougies au dépôt ?'.",
      parameters: {
        type: 'object',
        properties: { produit: { type: 'string', description: 'Nom du produit, si la question porte sur un produit précis' } },
      },
    },
  },

  // ============================================================
  // TRANSFERTS ENTREPÔT → BOUTIQUE
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'transferts_en_cours',
      description: "Transferts de marchandise de l'ENTREPÔT vers la BOUTIQUE : ce qui est en attente ou en route, ce qui est arrivé ou refusé, et les demandes à valider pour mon entrepôt. Ex: 'qu'est-ce qui est en route vers la boutique ?', 'mon transfert est validé ?', 'des demandes de transfert à valider ?'.",
      parameters: {
        type: 'object',
        properties: { jours: { type: 'number', description: 'Combien de jours en arrière regarder (7 par défaut)' } },
      },
    },
  },

  // ============================================================
  // CLIENTS À RELANCER
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'clients_a_relancer',
      description: "Clients À RELANCER aujourd'hui : ceux qui sont en retard de paiement et qu'on n'a pas relancés ces derniers jours, du plus urgent au moins urgent. Ex: 'qui je dois relancer ?', 'qui appeler pour l'argent ?', 'les relances du jour'.",
      parameters: {
        type: 'object',
        properties: { limite: { type: 'number', description: 'Nombre de clients à citer (5 par défaut)' } },
      },
    },
  },
];
