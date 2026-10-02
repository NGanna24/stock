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
        "À utiliser UNIQUEMENT pour les salutations ('bonjour', 'salut'), remerciements ('merci'), questions hors-sujet (météo, blague, politique, heure) ou messages ambigus SANS rapport avec le stock. Ne retourne rien, sert juste à éviter d'appeler un outil stock inutilement.",
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
        "Recherche un ou plusieurs produits par nom (partiel accepté). Retourne le stock en UNITÉ DE BASE, ainsi que sa DÉCOMPOSITION en conditionnements (cartons, palettes...) sous forme de phrase prête à lire (ex: '80 bidon(s) = 6 Carton(s) + 8 bidon(s)'). À utiliser quand l'utilisateur mentionne un produit précis : 'combien de bougies', 'le prix du filtre', 'j'ai du caoutchouc', 'combien de cartons d'huile'. IMPORTANT : pour une question sur un CONDITIONNEMENT (carton, palette), utilise le champ 'conditionnements' ou 'reponse_humaine' du résultat.",
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
        "Retourne la liste de TOUS les produits du stock. Chaque produit contient son stock en unité de base ET sa décomposition en conditionnements ('conditionnements': '6 Carton(s) + 8 bidon(s)'). À utiliser quand l'utilisateur dit 'quels sont mes produits', 'liste mes produits', 'montre-moi tout mon stock', 'donne-moi la liste'.",
      parameters: {
        type: 'object',
        properties: {
          limite: {
            type: 'number',
            description: 'Nombre max de produits à retourner (défaut 30, max 100)',
          },
        },
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
        "Liste des produits en rupture (stock = 0). À utiliser pour 'ruptures', 'épuisés', 'je n'ai plus de...', 'qu'est-ce qui est terminé'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'produits_stock_bas',
      description:
        "Liste des produits dont le stock est proche du minimum. À utiliser pour 'stock faible', 'bientôt épuisé', 'à commander bientôt'. Retourne aussi la décomposition en conditionnements.",
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
        "Résumé général du stock : nombre de produits, ruptures, stocks bas, valeur d'achat et de vente. À utiliser pour 'comment va mon stock', 'fais-moi un résumé', 'combien j'ai de produits'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'valeur_stock',
      description:
        "Valeur totale du stock (prix d'achat, prix de vente, marge potentielle). À utiliser pour 'combien vaut mon stock', 'ma marchandise vaut combien'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'stock_par_categorie',
      description:
        "Répartition du stock par catégorie (nombre de produits, valeur). À utiliser pour 'mes catégories', 'répartition par catégorie', 'quelle catégorie me rapporte le plus'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'stock_par_fournisseur',
      description:
        "Répartition du stock par fournisseur (nombre de produits, valeur). À utiliser pour 'mes fournisseurs', 'stock par fournisseur'.",
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
        "Chiffre d'affaires sur une période. À utiliser pour 'CA', 'combien j'ai vendu', 'mes ventes ce mois/hier/cette semaine'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: {
            type: 'string',
            description: 'Date de début YYYY-MM-DD (défaut: 1er du mois en cours)',
          },
          date_fin: {
            type: 'string',
            description: "Date de fin YYYY-MM-DD (défaut: aujourd'hui)",
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
        "Produits les plus vendus sur une période (par quantité et par chiffre d'affaires). À utiliser pour 'meilleurs produits', 'top ventes', 'ce qui marche le mieux'.",
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
      name: 'factures_impayees',
      description:
        "Liste des factures non payées (en attente, partielles, en retard). À utiliser pour 'factures impayées', 'qui me doit', 'créances'.",
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
        "Commandes clients en attente de traitement. À utiliser pour 'commandes en attente', 'à traiter', 'à préparer'.",
      parameters: { type: 'object', properties: {} },
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
        "Recherche un client par téléphone. À utiliser pour 'c'est qui ce numéro', 'le client au 0140010385'.",
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
        "Meilleurs clients sur une période (par nombre de commandes et total acheté). À utiliser pour 'mes meilleurs clients', 'top clients'.",
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

  // ============================================================
  // BOUTIQUE
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'info_boutique',
      description:
        "Informations de la boutique : nom commercial, adresse, téléphone, email. À utiliser pour 'comment s'appelle ma boutique', 'mon adresse', 'mon magasin'.",
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
        "Retourne la liste des fournisseurs (nom, téléphone, ville). À utiliser pour 'qui sont mes fournisseurs', 'mes fournisseurs', 'donne-moi mes fournisseurs'.",
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

  // ============================================================
  // CATÉGORIES & MARQUES
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'lister_categories',
      description:
        "Retourne la liste des catégories avec le nombre de produits. À utiliser pour 'mes catégories', 'quelles catégories j'ai', 'répartition par catégorie'.",
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'lister_marques',
      description:
        "Retourne la liste des marques avec le nombre de produits. À utiliser pour 'mes marques', 'quelles marques j'ai'.",
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
        "Retourne les derniers mouvements de stock (entrées, sorties, ajustements). À utiliser pour 'qu'est-ce qui a bougé', 'dernières entrées', 'dernières sorties', 'activité récente'.",
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
        "Retourne les dépenses sur une période. À utiliser pour 'combien j'ai dépensé', 'mes dépenses', 'mes charges'.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: 'YYYY-MM-DD (défaut: 1er du mois)' },
          date_fin: { type: 'string', description: "YYYY-MM-DD (défaut: aujourd'hui)" },
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
        "Retourne les derniers retours clients. À utiliser pour 'mes retours', 'j'ai eu combien de retours', 'produits retournés'.",
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre (défaut 10)' },
        },
      },
    },
  },
];