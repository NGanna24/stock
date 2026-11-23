// Services/GptChatService.js
// ============================================================
// ASSISTANT MIYO : conversation avec l'IA (Gemini, ou Groq) + outils maison
// ------------------------------------------------------------
// Ce qui a changé (novembre 2026) :
//  - consignes réécrites : plus courtes, dates déjà calculées, texte venant
//    d'une dictée (fautes d'écoute), réponses faites pour être LUES À VOIX HAUTE
//  - l'IA ne voit que les outils autorisés pour le rôle (comme le menu du web),
//    et les prix d'achat / marges sont retirés des réponses pour un caissier
//  - plus de place pour réfléchir (le modèle raisonne avant de répondre)
//  - un « mémo » des données trouvées est renvoyé à l'application, qui le
//    rejoue dans l'historique : « et le prix ? » garde le bon produit
//  - économies : seuls les outils du sujet de la question sont envoyés
//    (OutilsParSujet), et les consignes fixes passent avant tout ce qui change
//    (prénom, date…) pour profiter du cache de Google ; chaque question est
//    comptée (ConsommationIA)
// ============================================================
import Groq from 'groq-sdk';
import Gemini from './GeminiClient.js';
import dotenv from 'dotenv';
import { pool } from '../config/db.js';
import { toolDefinitions } from './toolss/toolDefinitions.js';
import { toolExecutors } from './toolss/StockTools.js';
import { choisirOutils, OUTIL_AUTRES } from './OutilsParSujet.js';
import { lireUsage, enregistrerQuestion } from './ConsommationIA.js';

dotenv.config();

const FUSEAU = 'Africa/Abidjan';

// ============================================================
// DROITS PAR RÔLE (mêmes règles que le menu du web)
// ============================================================
const OUTILS_PAR_ROLE = {
  caissier: [
    'aucune_action', 'rechercher_produit', 'lister_produits', 'details_produit',
    'produits_en_rupture', 'produits_stock_bas', 'chiffre_affaires', 'top_produits',
    'ventes_produit_periode', 'factures_impayees', 'commandes_en_attente',
    'commandes_par_periode', 'commandes_par_statut', 'rechercher_client', 'top_clients',
    'details_client', 'info_boutique', 'lister_categories', 'lister_marques',
    'retours_clients_recents', 'preparer_vente',
    'emplacement_produit', 'clients_qui_doivent', 'encaissements_periode', 'etat_caisse',
    'stock_entrepot', 'clients_a_relancer',
  ],
  magasinier: [
    'aucune_action', 'rechercher_produit', 'lister_produits', 'details_produit',
    'produits_en_rupture', 'produits_stock_bas', 'stats_generales', 'valeur_stock',
    'stock_par_categorie', 'stock_par_fournisseur', 'produits_non_vendus',
    'rapport_stocks_complet', 'lister_fournisseurs', 'details_fournisseur',
    'lister_categories', 'lister_marques', 'derniers_mouvements', 'inventaires_recents',
    'details_inventaire', 'info_boutique',
    'emplacement_produit', 'preparer_commande_achat', 'suivi_commandes_fournisseur',
    'stock_entrepot', 'transferts_en_cours',
  ],
};
// Le gestionnaire voit tout sauf l'administration (employés, magasins)
const INTERDITS_MANAGER = ['lister_employes', 'lister_magasins'];
// Données retirées des réponses pour ceux qui ne doivent pas les voir
const CLES_SENSIBLES = /(prix_achat|valeur_achat|cout|marge|benefice)/i;

const roleDe = (user) => String(user?.role || 'caissier').toLowerCase();

function outilsAutorises(role) {
  if (role === 'admin') return toolDefinitions;
  if (role === 'manager') return toolDefinitions.filter((t) => !INTERDITS_MANAGER.includes(t.function.name));
  const permis = OUTILS_PAR_ROLE[role] || OUTILS_PAR_ROLE.caissier;
  return toolDefinitions.filter((t) => permis.includes(t.function.name));
}

function retirerSensibles(valeur) {
  if (Array.isArray(valeur)) return valeur.map(retirerSensibles);
  if (valeur && typeof valeur === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(valeur)) {
      if (!CLES_SENSIBLES.test(k)) res[k] = retirerSensibles(v);
    }
    return res;
  }
  return valeur;
}

// ============================================================
// DATES (calculées ici : l'IA n'a plus à les deviner)
// ============================================================
function jourISO(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function periodes() {
  const maintenant = new Date();
  const auj = jourISO(maintenant);
  const [a, m, j] = auj.split('-').map(Number);
  const base = new Date(Date.UTC(a, m - 1, j));
  const decale = (n) => jourISO(new Date(base.getTime() + n * 86400000));
  const jourSemaine = (base.getUTCDay() + 6) % 7; // lundi = 0
  const debutMois = `${auj.slice(0, 8)}01`;
  const finMoisDernier = decale(-j);
  return {
    aujourdhui: auj,
    hier: decale(-1),
    debut_semaine: decale(-jourSemaine),
    debut_semaine_derniere: decale(-jourSemaine - 7),
    fin_semaine_derniere: decale(-jourSemaine - 1),
    debut_mois: debutMois,
    debut_mois_dernier: `${finMoisDernier.slice(0, 8)}01`,
    fin_mois_dernier: finMoisDernier,
    debut_annee: `${a}-01-01`,
    jour: new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'long' }).format(maintenant),
    heure: Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSEAU, hour: '2-digit', hourCycle: 'h23' }).format(maintenant)),
  };
}

const LIBELLE_ROLE = { admin: 'patron', manager: 'gestionnaire', caissier: 'caissier', magasinier: 'magasinier' };

class GptChatService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.model = 'openai/gpt-oss-120b';
    // IA utilisée : Gemini (gratuit) dès que GEMINI_API_KEY est présent.
    // Pour revenir à Groq : IA_FOURNISSEUR=groq dans le .env
    this.fournisseur = (process.env.IA_FOURNISSEUR || (Gemini.disponible() ? 'gemini' : 'groq')).toLowerCase();
    // Si tous les modèles gratuits de Google sont épuisés, Groq (gratuit aussi) prend le relais.
    // Pour l'interdire : IA_SECOURS=non dans le .env
    this.groqSecours = Boolean(process.env.GROQ_API_KEY) && (process.env.IA_SECOURS || '').toLowerCase() !== 'non';
    console.log(
      `[GptChatService] IA : ${this.fournisseur === 'gemini' ? `Gemini (${Gemini.modeleActif})` : `Groq (${this.model})`}` +
        (this.fournisseur === 'gemini' && this.groqSecours ? ', Groq en secours' : '')
    );
    this.MAX_ITERATIONS = 5;
    // Le modèle réfléchit avant de répondre : 800 jetons ne suffisaient pas
    this.MAX_TOKENS = 2500;
  }

  async nomBoutique(workspaceId) {
    // Gardé 10 minutes en mémoire : inutile de le relire à chaque question
    this._boutiques ||= new Map();
    const connu = this._boutiques.get(workspaceId);
    if (connu && connu.expire > Date.now()) return connu.valeur;
    try {
      const [[m]] = await pool.execute(
        'SELECT nom_commercial, ville FROM magasins WHERE id_utilisateur = ? ORDER BY id_magasin LIMIT 1',
        [workspaceId]
      );
      const valeur = m ? { nom: m.nom_commercial, ville: m.ville } : null;
      this._boutiques.set(workspaceId, { valeur, expire: Date.now() + 10 * 60 * 1000 });
      return valeur;
    } catch {
      return null;
    }
  }

  // ============================================================
  // CONSIGNES
  // ============================================================
  // Consignes FIXES : identiques pour toutes les boutiques et tous les jours.
  // Google ne facture presque rien pour un début de message qu'il a déjà vu
  // (cache) : tout ce qui change (prénom, date, boutique) va dans contexte().
  getSystemPrompt() {
    return `Tu es Miyo, l'assistant d'une boutique en Côte d'Ivoire. Les boutiques qui t'utilisent vendent surtout des pièces détachées et des lubrifiants pour motos, au détail et en gros (cartons). Le nom de la boutique, la personne qui te parle, son rôle et la date sont donnés dans le message « Contexte » au début de la conversation.

## Ce que tu reçois
Le message vient d'une DICTÉE VOCALE. Il peut contenir des fautes d'écoute ou des mots mal coupés (« bouchie » pour « bougie », « cinq litres » pour « 5L », « Ali » écrit « Allie »).
- Devine le sens le plus probable d'après le contexte d'une boutique de pièces moto.
- Les nombres peuvent être écrits en lettres : « deux cartons » = 2 cartons.
- Si un nom de produit est approximatif, cherche quand même avec l'outil : la recherche tolère les fautes.

## Qui te parle
Beaucoup d'utilisateurs lisent peu et parlent un français simple, avec des mots de la rue (nouchi) ou des mots locaux mélangés. Exemples : « c'est fini dans boutique » = rupture de stock, « l'argent est rentré combien » = combien j'ai vendu, « ça marche pas » = ça ne se vend pas, « gâté » = abîmé.
- Comprends l'idée, même si la phrase est mal construite. Ne corrige jamais la personne.

## Comment tu réponds
Ta réponse est LUE À VOIX HAUTE à quelqu'un qui ne lit peut-être pas.
- Français très simple, mots de tous les jours, comme à un client au marché. Tutoiement, ton chaleureux.
- Une à trois phrases très courtes (12 mots maximum chacune). Le chiffre important d'abord.
- Pas de listes à puces, pas de tableaux, pas de symboles (*, #, /, %), pas d'emoji.
- Montants : écris « 15 000 francs ». Pourcentages : « 20 pour cent ».
- Pas de jargon : jamais « unité de base », « outil », « requête », « base de données ».
- Quantités : utilise le champ « reponse_humaine » des résultats quand il existe, sans recalculer.
- S'il y a plus de 4 éléments, cite les 3 plus importants et dis combien il y en a en tout.

## Les données
Tu ne sais RIEN du magasin sans appeler un outil. Ne devine jamais un chiffre.
- Toute question sur un produit, le stock, les ventes, un client, un fournisseur, les dettes ou les dépenses : appelle l'outil adapté.
- « Où est… », « c'est rangé où » : emplacement_produit. Si l'emplacement n'est pas noté, dis-le et explique où le noter.
- « Qui me doit », « les crédits », « combien on me doit », « est-ce que Koffi me doit » : clients_qui_doivent.
- « Combien j'ai encaissé », « l'argent rentré », « combien en Wave / en espèces » : encaissements_periode (argent vraiment reçu). Le chiffre d'affaires (chiffre_affaires) compte aussi les ventes à crédit : ne confonds pas les deux.
- « Combien dans la caisse », « la caisse est ouverte » : etat_caisse (espèces du tiroir ; le mobile money est à part).
- « Je dois combien à… », « mes dettes fournisseurs » : dettes_fournisseurs. Ne confonds pas avec clients_qui_doivent (l'argent qu'on te doit).
- « Qui a le plus vendu », « combien Awa a vendu » : ventes_par_vendeur.
- « Ma commande est arrivée ? », « ce qui reste à recevoir » : suivi_commandes_fournisseur.
- Stock « à l'entrepôt » ou « au dépôt » : stock_entrepot. Sans ce mot, le stock demandé est celui de la boutique.
- « En route vers la boutique », « mon transfert », « demandes à valider » : transferts_en_cours.
- « Qui relancer », « qui appeler pour l'argent » : clients_a_relancer (les plus urgents). Pour juste savoir qui doit combien : clients_qui_doivent.
- Résultat vide : dis-le simplement et propose une autre formulation.
- Plusieurs produits possibles (champ autres_produits_proches) : demande lequel en citant les noms.
- Question trop vague (« combien ? ») : demande une précision avec deux exemples concrets.
- Suite de conversation (« et le prix ? », « et hier ? », « lesquels ? ») : reprends le produit, le client ou la période de l'échange précédent. Les lignes « [mémo] » de l'historique contiennent les données déjà trouvées.

## Dates
Les dates déjà calculées (aujourd'hui, hier, cette semaine, ce mois…) sont dans le message « Contexte » : utilise-les telles quelles, au format AAAA-MM-JJ.
Sans période précisée pour des ventes : prends ce mois.

## Outils reçus
Pour aller plus vite, tu ne reçois que les outils utiles au sujet de la question. Si aucun d'eux ne permet de répondre et que l'outil autres_informations est proposé, appelle-le d'abord : tu recevras tous les outils. Ne dis jamais qu'une information n'est pas disponible avant de l'avoir fait.

## Vendre à la voix
Quand on te demande de vendre (« vends 2 cartons d'huile à Awa », « mets 3 bougies pour Koffi, il a payé ») :
- Appelle preparer_vente, une ligne par produit et par unité.
- La vente n'est PAS enregistrée : résume en une phrase puis dis « Vérifie et touche Confirmer. » Ne dis jamais que c'est fait.
- S'il y a des problèmes (produit introuvable, stock insuffisant, prix manquant), dis-les et demande quoi corriger.
- Paiement seulement si l'utilisateur dit que le client a payé (espèces par défaut).

## Commander au fournisseur
Quand on te demande de commander ou d'acheter des produits pour la boutique (« commande 10 cartons d'huile », « commande ce qui manque ») :
- Appelle preparer_commande_achat. Pour « ce qui manque », cherche d'abord les produits en stock bas ou en rupture, puis mets-les dans la commande.
- La commande n'est PAS envoyée : résume en une phrase puis dis « Vérifie et touche Confirmer. » Ne dis jamais que c'est fait.
- Si le fournisseur manque ou si un produit est flou, demande la précision.

## Droits
Tu n'as accès qu'aux informations permises pour le rôle de la personne (donné dans le « Contexte »). Si on te demande autre chose (bénéfices, prix d'achat, employés…) et que tu n'as pas l'outil, réponds gentiment que ce n'est pas disponible avec ce compte.

## Politesse
Bonjour, merci, au revoir : réponds en une phrase, sans outil. Hors sujet : ramène gentiment à la boutique.`;
  }

  // Ce qui change d'une question à l'autre : placé APRÈS les consignes et les outils
  contexte(user = {}, boutique = null, vocabulaire = '') {
    const p = periodes();
    const prenom = user.fullname ? String(user.fullname).split(' ')[0] : '';
    const role = roleDe(user);
    const moment = p.heure < 12 ? 'le matin' : p.heure < 18 ? "l'après-midi" : 'le soir';
    return `[Contexte : informations du système, ce n'est pas un message de la personne]
Boutique : ${boutique?.nom ? `« ${boutique.nom} »` : 'nom non renseigné'}${boutique?.ville ? ` à ${boutique.ville}` : ''}.
Tu parles à ${prenom || "l'utilisateur"}, ${LIBELLE_ROLE[role] || role}. Nous sommes ${p.jour}, ${moment}.
Dates (AAAA-MM-JJ) :
- aujourd'hui : ${p.aujourdhui}
- hier : ${p.hier}
- cette semaine : ${p.debut_semaine} au ${p.aujourdhui}
- la semaine dernière : ${p.debut_semaine_derniere} au ${p.fin_semaine_derniere}
- ce mois : ${p.debut_mois} au ${p.aujourdhui}
- le mois dernier : ${p.debut_mois_dernier} au ${p.fin_mois_dernier}
- cette année : ${p.aujourdhui.slice(0, 4)}-01-01 au ${p.aujourdhui}${
      vocabulaire ? `\nNoms utilisés dans cette boutique (produits, marques, clients) : ${vocabulaire.slice(0, 1500)}` : ''
    }`;
  }

  // ============================================================
  // CHAT
  // ============================================================
  // Consignes en plus quand on envoie directement la voix (une seule étape : écouter, chercher, répondre)
  consignesVoix() {
    return `## Message vocal
Le dernier message de l'utilisateur est un ENREGISTREMENT DE SA VOIX (accent ivoirien, bruit de boutique possible).
Les noms utilisés dans la boutique (produits, marques, clients) sont dans le « Contexte ».
- Écoute, comprends la demande, appelle les outils si besoin, puis réponds.
- Ta réponse finale commence OBLIGATOIREMENT par une ligne « ENTENDU: » suivie de ce que la personne a demandé, en français correct et court. Puis, à la ligne suivante, ta réponse.
- Si on n'entend aucune parole : « ENTENDU: [silence] » puis « Je n'ai rien entendu. Parle plus près du téléphone. »`;
  }

  /**
   * @param {{ audio?: { mime: string, data: string }, vocabulaire?: string, sansSecours?: boolean }} options
   *   audio : la voix est envoyée telle quelle (Gemini seulement)
   */
  async chat(userMessage, workspaceId, user = {}, history = [], options = {}) {
    const { audio = null, vocabulaire = '', sansSecours = false, actions = '' } = options;
    if (audio) userMessage = 'Message vocal ci-dessus : réponds en commençant par la ligne ENTENDU:';
    if (!userMessage || typeof userMessage !== 'string') {
      throw new Error('Message utilisateur requis');
    }
    if (!workspaceId) {
      throw new Error("workspaceId manquant (problème d'authentification)");
    }

    const role = roleDe(user);
    // Les commandes fournisseur ne sont proposées qu'aux versions de l'application qui savent les afficher
    // (une ancienne version prendrait le brouillon pour une vente)
    const actionsAcceptees = String(actions || '').split(',').map((x) => x.trim());
    const outilsRole = outilsAutorises(role).filter(
      (t) => t.function.name !== 'preparer_commande_achat' || actionsAcceptees.includes('commande_achat')
    );
    const nomsPermis = new Set(outilsRole.map((t) => t.function.name));
    const masquerSensible = role === 'caissier';
    const boutique = await this.nomBoutique(workspaceId);

    const safeHistory = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant'))
          .slice(-8)
          .map((h) => ({ role: h.role, content: h.content.slice(0, 1500) }))
      : [];

    // Seulement les outils du sujet de la question (tous pour un message vocal ou une question floue)
    const choix = choisirOutils(audio ? '' : userMessage, safeHistory, outilsRole, { voix: Boolean(audio) });
    let outils = choix.outils;
    let complet = choix.complet;

    // Ordre pensé pour le cache de Google : consignes fixes (+ outils) d'abord, puis ce qui change
    const messages = [
      { role: 'system', content: this.getSystemPrompt() + (audio ? `\n\n${this.consignesVoix()}` : '') },
      { role: 'user', content: this.contexte(user, boutique, audio ? vocabulaire : '') },
      ...safeHistory,
      { role: 'user', content: userMessage.trim(), ...(audio ? { _audio: audio } : {}) },
    ];
    const consommation = [];

    const toolsUsed = [];
    const memo = [];
    let action = null;

    const appelGroq = () =>
      this.groq.chat.completions.create({
        model: this.model,
        // champs propres à Gemini retirés : Groq les refuse
        messages: messages.map(({ _gemini_parts, _gemini_modele, reasoning, ...m }) =>
          m.tool_calls ? { ...m, tool_calls: m.tool_calls.map(({ _gemini_id, ...t }) => t) } : (({ _audio, ...r }) => r)(m)
        ),
        tools: outils,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: this.MAX_TOKENS,
        reasoning_effort: 'low',
      });

    // Mesure du temps : chaque aller-retour vers l'IA et les outils
    const debut = Date.now();
    const tempsIA = [];
    let tempsOutils = 0;
    const journal = () =>
      console.log(
        `[Miyo] Temps : ${Date.now() - debut} ms au total · IA ${tempsIA.length} fois (${tempsIA.join(' + ')} ms) · outils ${tempsOutils} ms` +
          (toolsUsed.length ? ` · ${toolsUsed.join(', ')}` : '')
      );

    const appelerIA = async () => {
      if (this.fournisseur !== 'gemini' && !audio) return appelGroq();
      try {
        return await Gemini.discuter({ messages, tools: outils, max_tokens: this.MAX_TOKENS });
      } catch (e) {
        // Avec la voix, Groq ne peut pas écouter : c'est l'appelant qui passe par la dictée
        // 402 = crédit Google épuisé : Groq répond en attendant la recharge
        if ([402, 429, 503].includes(e.status) && this.groqSecours && !audio && !sansSecours) {
          console.warn(`[GptChatService] ${e.status === 402 ? 'crédit Google épuisé' : 'limite Google atteinte'} : Groq prend le relais`);
          return appelGroq();
        }
        throw e;
      }
    };
    const appeler = async () => {
      const t = Date.now();
      try {
        const rep = await appelerIA();
        const u = lireUsage(rep);
        if (u) consommation.push(u);
        return rep;
      } finally {
        tempsIA.push(Date.now() - t);
      }
    };
    // Outils reçus insuffisants : l'IA demande tout, on relance avec la liste complète
    const elargirSiDemande = async (reponse) => {
      const appels = reponse.choices[0].message.tool_calls || [];
      if (complet || !appels.some((a) => a.function.name === OUTIL_AUTRES.function.name)) return reponse;
      console.log(`[Miyo IA] outils du sujet insuffisants (${choix.sujets.join(', ')}) : tous les outils`);
      outils = outilsRole;
      complet = true;
      return appeler();
    };
    const compter = () =>
      enregistrerQuestion({
        id_utilisateur: workspaceId,
        appels: consommation,
        voix: Boolean(audio),
        outilsEnvoyes: outils.length,
        complet,
        sujets: choix.sujets,
        dureeMs: Date.now() - debut,
      });

    try {
      let response = await elargirSiDemande(await appeler());
      let assistantMessage = response.choices[0].message;
      let iterations = 0;

      while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < this.MAX_ITERATIONS) {
        iterations++;
        // Le raisonnement interne n'est pas renvoyé au modèle (évite les erreurs de format)
        const { reasoning, ...propre } = assistantMessage;
        messages.push(propre);

        // Les outils demandés en même temps sont lancés ensemble (plus d'attente l'un après l'autre)
        const tOutils = Date.now();
        const appels = assistantMessage.tool_calls.map((toolCall) => {
          const toolName = toolCall.function.name;
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            toolArgs = {};
          }
          console.log(`[GptChatService] Outil : ${toolName}(${JSON.stringify(toolArgs)})`);
          const executor = toolExecutors[toolName];
          const resultat = (async () => {
            try {
              if (!nomsPermis.has(toolName)) return { error: "Cette information n'est pas disponible avec ce compte." };
              if (!executor) return { error: `Outil inconnu : ${toolName}` };
              return await executor(toolArgs, workspaceId, user);
            } catch (err) {
              console.error(`[GptChatService] Erreur outil ${toolName}:`, err.message);
              return { error: 'Erreur technique en récupérant les données. Réessaie ou reformule.' };
            }
          })();
          return { toolCall, toolName, toolArgs, resultat };
        });
        const resultats = await Promise.all(appels.map((a) => a.resultat));
        tempsOutils += Date.now() - tOutils;

        for (let i = 0; i < appels.length; i++) {
          const { toolCall, toolName, toolArgs } = appels[i];
          toolsUsed.push(toolName);
          let toolResult = resultats[i];

          // Brouillon d'action (vente préparée) : pour l'application, pas pour le modèle
          if (toolResult && typeof toolResult === 'object' && '__action' in toolResult) {
            if (toolResult.__action) action = toolResult.__action;
            const { __action, ...pourModele } = toolResult;
            toolResult = pourModele;
          }
          if (masquerSensible) toolResult = retirerSensibles(toolResult);

          const contenu = JSON.stringify(toolResult);
          memo.push(`${toolName}(${JSON.stringify(toolArgs)}) → ${contenu.slice(0, 400)}`);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolName, content: contenu.slice(0, 12000) });
        }

        response = await elargirSiDemande(await appeler());
        assistantMessage = response.choices[0].message;
      }

      journal();
      compter();
      if (iterations >= this.MAX_ITERATIONS && assistantMessage.tool_calls?.length) {
        return {
          success: true,
          question: null,
          reply: action
            ? 'Vente préparée. Vérifie et touche Confirmer.'
            : "Je n'arrive pas à trouver cette information. Dis-le autrement, par exemple avec le nom exact du produit.",
          action,
          memo: memo.join(' | ').slice(0, 1200),
          iterations,
          tools_used: toolsUsed,
        };
      }

      let finalReply = assistantMessage.content?.trim() || "Je n'ai pas bien compris. Tu peux répéter autrement ?";
      // Message vocal : la 1re ligne dit ce que Miyo a entendu
      let question = null;
      const entendu = finalReply.match(/^\s*\**ENTENDU\**\s*:\s*(.*?)\s*(?:\n+|$)/i);
      if (entendu) {
        question = entendu[1].replace(/^\**\s*/, '').replace(/^["«]\s*|\s*["»]$/g, '').trim() || null;
        if (question && /^\[?silence\]?\.?$/i.test(question)) question = '';
        finalReply = finalReply.slice(entendu[0].length).trim() || "Je n'ai rien entendu. Parle plus près du téléphone.";
      }
      finalReply = finalReply
        .replace(/^["'«]|["'»]$/g, '')
        .replace(/^(Miyo|Assistant)\s*:\s*/i, '')
        // texte lu à voix haute : pas de mise en forme
        .replace(/\*\*|__|`|#+\s/g, '')
        .replace(/^\s*[-•]\s+/gm, '')
        // jamais d'emoji dans Miyo (affiché et lu à voix haute)
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      return {
        success: true,
        question,
        reply: finalReply,
        action,
        memo: memo.join(' | ').slice(0, 1200),
        iterations,
        tools_used: toolsUsed,
      };
    } catch (error) {
      compter();
      console.error(`[GptChatService] Erreur après ${Date.now() - debut} ms :`, error.message);
      throw new Error(error?.error?.message || error.message || 'Erreur de conversation');
    }
  }
}

export default new GptChatService();
