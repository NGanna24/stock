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
];