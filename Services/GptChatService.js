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
// ============================================================
import Groq from 'groq-sdk';
import Gemini from './GeminiClient.js';
import dotenv from 'dotenv';
import { pool } from '../config/db.js';
import { toolDefinitions } from './toolss/toolDefinitions.js';
import { toolExecutors } from './toolss/StockTools.js';

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
  ],
  magasinier: [
    'aucune_action', 'rechercher_produit', 'lister_produits', 'details_produit',
    'produits_en_rupture', 'produits_stock_bas', 'stats_generales', 'valeur_stock',
    'stock_par_categorie', 'stock_par_fournisseur', 'produits_non_vendus',
    'rapport_stocks_complet', 'lister_fournisseurs', 'details_fournisseur',
    'lister_categories', 'lister_marques', 'derniers_mouvements', 'inventaires_recents',
    'details_inventaire', 'info_boutique',
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
    try {
      const [[m]] = await pool.execute(
        'SELECT nom_commercial, ville FROM magasins WHERE id_utilisateur = ? ORDER BY id_magasin LIMIT 1',
        [workspaceId]
      );
      return m ? { nom: m.nom_commercial, ville: m.ville } : null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // CONSIGNES
  // ============================================================
  getSystemPrompt(user = {}, boutique = null) {
    const p = periodes();
    const prenom = user.fullname ? String(user.fullname).split(' ')[0] : '';
    const role = roleDe(user);
    const moment = p.heure < 12 ? 'le matin' : p.heure < 18 ? "l'après-midi" : 'le soir';

    return `Tu es Miyo, l'assistant de la boutique${boutique?.nom ? ` « ${boutique.nom} »` : ''}${boutique?.ville ? ` à ${boutique.ville}` : ''}, en Côte d'Ivoire. La boutique vend surtout des pièces détachées et des lubrifiants pour motos, au détail et en gros (cartons).
Tu parles à ${prenom || "l'utilisateur"}, ${LIBELLE_ROLE[role] || role}. Nous sommes ${p.jour}, ${moment}.

## Ce que tu reçois
Le message vient d'une DICTÉE VOCALE. Il peut contenir des fautes d'écoute ou des mots mal coupés (« bouchie » pour « bougie », « cinq litres » pour « 5L », « Ali » écrit « Allie »).
- Devine le sens le plus probable d'après le contexte d'une boutique de pièces moto.
- Les nombres peuvent être écrits en lettres : « deux cartons » = 2 cartons.
- Si un nom de produit est approximatif, cherche quand même avec l'outil : la recherche tolère les fautes.

## Comment tu réponds
Ta réponse est LUE À VOIX HAUTE.
- Français simple, tutoiement, ton chaleureux de commerçant. Une à trois phrases courtes.
- Pas de listes à puces, pas de tableaux, pas de symboles (*, #, /, %), pas d'emoji.
- Montants : écris « 15 000 francs ». Pourcentages : « 20 pour cent ».
- Pas de jargon : jamais « unité de base », « outil », « requête », « base de données ».
- Quantités : utilise le champ « reponse_humaine » des résultats quand il existe, sans recalculer.
- S'il y a plus de 4 éléments, cite les 3 plus importants et dis combien il y en a en tout.

## Les données
Tu ne sais RIEN du magasin sans appeler un outil. Ne devine jamais un chiffre.
- Toute question sur un produit, le stock, les ventes, un client, un fournisseur, les dettes ou les dépenses : appelle l'outil adapté.
- Résultat vide : dis-le simplement et propose une autre formulation.
- Plusieurs produits possibles (champ autres_produits_proches) : demande lequel en citant les noms.
- Question trop vague (« combien ? ») : demande une précision avec deux exemples concrets.
- Suite de conversation (« et le prix ? », « et hier ? », « lesquels ? ») : reprends le produit, le client ou la période de l'échange précédent. Les lignes « [mémo] » de l'historique contiennent les données déjà trouvées.

## Dates (déjà calculées, utilise-les telles quelles au format AAAA-MM-JJ)
- aujourd'hui : ${p.aujourdhui}
- hier : ${p.hier}
- cette semaine : ${p.debut_semaine} au ${p.aujourdhui}
- la semaine dernière : ${p.debut_semaine_derniere} au ${p.fin_semaine_derniere}
- ce mois : ${p.debut_mois} au ${p.aujourdhui}
- le mois dernier : ${p.debut_mois_dernier} au ${p.fin_mois_dernier}
- cette année : ${p.aujourdhui.slice(0, 4)}-01-01 au ${p.aujourdhui}
Sans période précisée pour des ventes : prends ce mois.

## Vendre à la voix
Quand on te demande de vendre (« vends 2 cartons d'huile à Awa », « mets 3 bougies pour Koffi, il a payé ») :
- Appelle preparer_vente, une ligne par produit et par unité.
- La vente n'est PAS enregistrée : résume en une phrase puis dis « Vérifie et touche Confirmer. » Ne dis jamais que c'est fait.
- S'il y a des problèmes (produit introuvable, stock insuffisant, prix manquant), dis-les et demande quoi corriger.
- Paiement seulement si l'utilisateur dit que le client a payé (espèces par défaut).

## Droits
Tu n'as accès qu'aux informations permises pour un ${LIBELLE_ROLE[role] || role}. Si on te demande autre chose (bénéfices, prix d'achat, employés…) et que tu n'as pas l'outil, réponds gentiment que ce n'est pas disponible avec ce compte.

## Politesse
Bonjour, merci, au revoir : réponds en une phrase, sans outil. Hors sujet : ramène gentiment à la boutique.`;
  }

  // ============================================================
  // CHAT
  // ============================================================
  async chat(userMessage, workspaceId, user = {}, history = []) {
    if (!userMessage || typeof userMessage !== 'string') {
      throw new Error('Message utilisateur requis');
    }
    if (!workspaceId) {
      throw new Error("workspaceId manquant (problème d'authentification)");
    }

    const role = roleDe(user);
    const outils = outilsAutorises(role);
    const nomsPermis = new Set(outils.map((t) => t.function.name));
    const masquerSensible = role === 'caissier';
    const boutique = await this.nomBoutique(workspaceId);

    const safeHistory = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant'))
          .slice(-8)
          .map((h) => ({ role: h.role, content: h.content.slice(0, 1500) }))
      : [];

    const messages = [
      { role: 'system', content: this.getSystemPrompt(user, boutique) },
      ...safeHistory,
      { role: 'user', content: userMessage.trim() },
    ];

    const toolsUsed = [];
    const memo = [];
    let action = null;

    const appelGroq = () =>
      this.groq.chat.completions.create({
        model: this.model,
        // champs propres à Gemini retirés : Groq les refuse
        messages: messages.map(({ _gemini_parts, _gemini_modele, reasoning, ...m }) =>
          m.tool_calls ? { ...m, tool_calls: m.tool_calls.map(({ _gemini_id, ...t }) => t) } : m
        ),
        tools: outils,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: this.MAX_TOKENS,
        reasoning_effort: 'low',
      });

    const appeler = async () => {
      if (this.fournisseur !== 'gemini') return appelGroq();
      try {
        return await Gemini.discuter({ messages, tools: outils, max_tokens: this.MAX_TOKENS });
      } catch (e) {
        if ([429, 503].includes(e.status) && this.groqSecours) {
          console.warn('[GptChatService] limite Google atteinte : Groq prend le relais');
          return appelGroq();
        }
        throw e;
      }
    };

    try {
      let response = await appeler();
      let assistantMessage = response.choices[0].message;
      let iterations = 0;

      while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < this.MAX_ITERATIONS) {
        iterations++;
        // Le raisonnement interne n'est pas renvoyé au modèle (évite les erreurs de format)
        const { reasoning, ...propre } = assistantMessage;
        messages.push(propre);

        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          toolsUsed.push(toolName);
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            toolArgs = {};
          }
          console.log(`[GptChatService] Outil : ${toolName}(${JSON.stringify(toolArgs)})`);

          let toolResult;
          try {
            const executor = toolExecutors[toolName];
            if (!nomsPermis.has(toolName)) {
              toolResult = { error: "Cette information n'est pas disponible avec ce compte." };
            } else if (!executor) {
              toolResult = { error: `Outil inconnu : ${toolName}` };
            } else {
              toolResult = await executor(toolArgs, workspaceId, user);
            }
          } catch (err) {
            console.error(`[GptChatService] Erreur outil ${toolName}:`, err.message);
            toolResult = { error: 'Erreur technique en récupérant les données. Réessaie ou reformule.' };
          }

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

        response = await appeler();
        assistantMessage = response.choices[0].message;
      }

      if (iterations >= this.MAX_ITERATIONS && assistantMessage.tool_calls?.length) {
        return {
          success: true,
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
      finalReply = finalReply
        .replace(/^["'«]|["'»]$/g, '')
        .replace(/^(Miyo|Assistant)\s*:\s*/i, '')
        // texte lu à voix haute : pas de mise en forme
        .replace(/\*\*|__|`|#+\s/g, '')
        .replace(/^\s*[-•]\s+/gm, '')
        .trim();

      return {
        success: true,
        reply: finalReply,
        action,
        memo: memo.join(' | ').slice(0, 1200),
        iterations,
        tools_used: toolsUsed,
      };
    } catch (error) {
      console.error('[GptChatService] Erreur:', error.message);
      throw new Error(error?.error?.message || error.message || 'Erreur de conversation');
    }
  }
}

export default new GptChatService();
