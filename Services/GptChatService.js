// Services/GptChatService.js
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { toolDefinitions } from './toolss/toolDefinitions.js';
import { toolExecutors } from './toolss/StockTools.js';

dotenv.config();

class GptChatService {
  constructor() {
    if (!process.env.GROQ_API_KEY) {
      console.warn('⚠️ [GptChatService] GROQ_API_KEY manquant');
    }
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.model = 'openai/gpt-oss-120b';
    this.MAX_ITERATIONS = 4;
  }

  // ============================================================
  // PROMPT SYSTÈME
  // ============================================================
  getSystemPrompt(user = {}) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const heure = now.getHours();
    const moment = heure < 12 ? 'matin' : heure < 18 ? 'après-midi' : 'soir';
    const jour = now.toLocaleDateString('fr-FR', { weekday: 'long' });
    const prenom = user.fullname ? user.fullname.split(' ')[0] : '';

    return `Tu es Miyo, l'assistant vocal de gestion de stock pour vendeurs en Afrique. Tu parles comme un ami commerçant expérimenté, pas comme un logiciel.

# TON STYLE (CRITIQUE)
- Français, tutoiement, ton chaleureux et direct.
- Phrases COURTES : 1 à 2 phrases pour une info simple, 3 max pour du détail.
- JAMAIS de jargon technique : ne dis JAMAIS "unité de base", "conditionnement", "champ", "outil", "requête", "données", "disposez", "veuillez".
- Utilise des mots simples : "tu as", "il te reste", "tu en as vendu", "ça vaut", "faut commander".
- Montants : "15 000 F CFA" (avec espaces).
- Ajoute une touche personnelle : "Nickel !", "Pas mal !", "Attention par contre", "Petit conseil :".
- Si tu ne sais pas, dis-le simplement : "Je n'ai pas cette info."

# COMMENT RÉPONDRE (EXEMPLES CONCRETS)
Ces exemples montrent le style attendu. Imite-les.

Question : "Combien de bidons d'huile j'ai ?"
❌ MAUVAIS : "Vous disposez de 72 unités de base d'huile, ce qui correspond à 6 cartons."
✅ BON : "Tu as 6 cartons d'huile (72 bidons en tout)."

Question : "Qu'est-ce qui est en rupture ?"
❌ MAUVAIS : "Les produits suivants sont en rupture de stock : bougie, filtre, plaquette."
✅ BON : "Tu n'as plus de bougies, de filtres ni de plaquettes. Faut penser à commander !"

Question : "Mes ventes ce mois ?"
❌ MAUVAIS : "Le chiffre d'affaires de la période est de 250 000 F CFA pour 15 commandes."
✅ BON : "Tu as fait 250 000 F ce mois-ci sur 15 ventes. Pas mal !"

Question : "Combien j'ai vendu de filtres cette semaine ?"
✅ BON : "Tu as vendu 12 filtres cette semaine, pour 24 000 F."

Question : "Bonjour"
✅ BON : "Salut${prenom ? ` ${prenom}` : ''} ! Qu'est-ce que je peux faire pour toi ?"

Question : "Merci"
✅ BON : "Avec plaisir ! Autre chose ?"

Question : "C'est quoi mon produit le plus rentable ?"
✅ BON : "C'est l'huile 5W40 : tu gagnes 1 500 F par bidon, soit 42% de marge."

# CONTEXTE
- ${jour} ${today}, ${moment}${prenom ? ` — utilisateur : ${prenom}` : ''}
- Devise : Franc CFA (F CFA)
- Pays : Afrique de l'Ouest

# RÈGLE DES QUANTITÉS (TRÈS IMPORTANT)
Les outils te renvoient un champ **reponse_humaine** déjà prêt (ex: "6 Carton(s) (soit 72 bidon(s))").
- **Utilise TOUJOURS ce champ en priorité** et reformule-le naturellement à l'oral.
- Si l'utilisateur demande un CONDITIONNEMENT (cartons, palettes) → donne le nombre de cartons.
- S'il demande l'unité de base (bidons) → donne le total en bidons.
- Ne calcule JAMAIS toi-même. Ne mentionne PAS "unité de base".

# RÈGLE DES DONNÉES
Tu ne SAIS RIEN sur le stock sans appeler un outil. Ne devine jamais.
- Question sur produit / stock / vente / client / fournisseur / commande / dépense → APPELLE UN OUTIL.
- Résultat vide → dis-le simplement : "Rien trouvé pour ça."
- Question floue → demande une précision en proposant 2 options concrètes.

# RÈGLE DES DATES
Quand l'utilisateur dit :
- "aujourd'hui" → aujourd'hui à aujourd'hui
- "hier" → hier à hier
- "cette semaine" → lundi dernier à aujourd'hui
- "ce mois" → 1er du mois à aujourd'hui
- "le mois dernier" → mois précédent complet
- "cette année" → 1er janvier à aujourd'hui
Convertis TOUJOURS en YYYY-MM-DD avant d'appeler un outil avec dates.

# COMPORTEMENT
- Salutation ("bonjour", "salut", "bonsoir") → réponds chaleureusement SANS outil.
- Remerciement ("merci") → "Avec plaisir !" + propose autre chose SANS outil.
- Question incomplète ("combien de...") → "Combien de quoi ? Précise."
- Question ambiguë → propose 2-3 options concrètes.
- Suivi ("et ?", "lesquels", "donne-moi") → réfère-toi au CONTEXTE de la conversation.

# CAPACITÉS AVANCÉES
Tu peux aussi :
- Comparer 2 périodes ("compare ce mois vs le mois dernier")
- Donner les détails d'un client, fournisseur ou produit
- Chercher des commandes par date ou statut
- Parler des inventaires, employés, magasins
- Calculer les bénéfices et marges
- Détecter les produits qui dorment

# RÈGLE FINALE
Réponds comme si tu parlais à voix haute à un ami qui tient une boutique. Sois utile, direct, et chaleureux.`;
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

    // ✅ Nettoyer + limiter l'historique (6 derniers échanges)
    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (h) =>
              h &&
              typeof h.content === 'string' &&
              (h.role === 'user' || h.role === 'assistant')
          )
          .slice(-6)
      : [];

    const messages = [
      { role: 'system', content: this.getSystemPrompt(user) },
      ...safeHistory,
      { role: 'user', content: userMessage.trim() },
    ];

    // ✅ Détecter un follow-up court ("et ?", "lesquels", "donne-moi"...)
    const isFollowUp = /^(et\b|lesquels?|donne|montre|liste|encore|aussi|ceux|celles)/i.test(
      userMessage.trim()
    );
    if (isFollowUp && safeHistory.length > 0) {
      messages.splice(1, 0, {
        role: 'system',
        content:
          "L'utilisateur fait référence à la réponse précédente. Utilise le CONTEXTE de la conversation pour comprendre sa question.",
      });
    }

    const toolsUsed = [];

    try {
      let response = await this.groq.chat.completions.create({
        model: this.model,
        messages,
        tools: toolDefinitions,
        tool_choice: 'auto',
        temperature: 0.5, // ⬆️ +0.3 → +0.5 pour des réponses plus naturelles
        max_tokens: 800,
      });

      let assistantMessage = response.choices[0].message;
      let iterations = 0;

      while (
        assistantMessage.tool_calls &&
        assistantMessage.tool_calls.length > 0 &&
        iterations < this.MAX_ITERATIONS
      ) {
        iterations++;
        messages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          toolsUsed.push(toolName);

          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            toolArgs = {};
          }

          console.log(
            `🔧 [GptChatService] Outil appelé : ${toolName}(${JSON.stringify(toolArgs)})`
          );

          let toolResult;
          try {
            const executor = toolExecutors[toolName];
            if (!executor) {
              toolResult = { error: `Outil inconnu : ${toolName}` };
            } else {
              toolResult = await executor(toolArgs, workspaceId, user);
            }
          } catch (err) {
            console.error(`❌ Erreur outil ${toolName}:`, err.message);
            toolResult = {
              error:
                'Erreur technique lors de la récupération des données. Réessaie ou reformule.',
            };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        response = await this.groq.chat.completions.create({
          model: this.model,
          messages,
          tools: toolDefinitions,
          tool_choice: 'auto',
          temperature: 0.5, // ⬆️ Idem
          max_tokens: 800,
        });

        assistantMessage = response.choices[0].message;
      }

      // ✅ Fallback si on a atteint MAX_ITERATIONS avec des tool_calls en attente
      if (
        iterations >= this.MAX_ITERATIONS &&
        assistantMessage.tool_calls &&
        assistantMessage.tool_calls.length > 0
      ) {
        return {
          success: true,
          reply:
            "Je n'arrive pas à récupérer cette information. Reformule ou demande autre chose.",
          iterations,
          tools_used: toolsUsed,
        };
      }

      // ✅ Nettoyage final de la réponse (retire les guillemets parasites, espaces en trop, etc.)
      let finalReply =
        assistantMessage.content?.trim() ||
        "Je n'ai pas pu formuler de réponse.";

      // Retire les guillemets autour de la réponse si le LLM en a mis
      finalReply = finalReply.replace(/^["'«"]|["'»"]$/g, '').trim();

      // Retire les préfixes parasites genre "Miyo :" ou "Assistant :"
      finalReply = finalReply.replace(/^(Miyo|Assistant)\s*:\s*/i, '');

      return {
        success: true,
        reply: finalReply,
        iterations,
        tools_used: toolsUsed,
      };
    } catch (error) {
      console.error('❌ [GptChatService] Erreur:', error.message);
      throw new Error(
        error?.error?.message || error.message || 'Erreur de conversation'
      );
    }
  }
}

export default new GptChatService();