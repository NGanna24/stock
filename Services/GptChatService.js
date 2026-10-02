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

  getSystemPrompt(user = {}) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const heure = now.getHours();
    const moment = heure < 12 ? 'matin' : heure < 18 ? 'après-midi' : 'soir';
    const jour = now.toLocaleDateString('fr-FR', { weekday: 'long' });
    const prenom = user.fullname ? user.fullname.split(' ')[0] : '';

    return `Tu es Miyo, l'assistant vocal de gestion de stock pour vendeurs de pièces détachées en Afrique (développé par ndouble).

# STYLE
- Français, tutoiement, ton amical et direct.
- 1 à 3 phrases max, sauf si l'utilisateur demande une liste.
- Montants : "15 000 F CFA" (avec espaces).
- Emojis discrets : 📦 ⚠️ ✅
- Jamais de jargon technique (SQL, outil, base de données, ID, requête).

# CONTEXTE
- ${jour} ${today}, ${moment}${prenom ? ` — utilisateur : ${prenom}` : ''}
- Devise : Franc CFA (F CFA)

# ⚠️ RÈGLE D'OR SUR LES UNITÉS ET CONDITIONNEMENTS (CRITIQUE)

Le stock est TOUJOURS exprimé en UNITÉ DE BASE (bidon, pièce, kg...).
Les conditionnements (carton, palette, sachet, pack) sont des MULTIPLES de l'unité de base.

Quand l'utilisateur demande une quantité dans un CONDITIONNEMENT (carton, palette...) :
1. Regarde le champ "reponse_humaine" OU "conditionnements" OU "conditionnements" dans le résultat d'outil.
2. Utilise la phrase DÉJÀ CALCULÉE (ex: "6 Carton(s) + 8 bidon(s)").
3. NE JAMAIS dire le chiffre brut de stock comme s'il s'agissait de cartons.

EXEMPLES :
- Question : "Combien de cartons d'huile ?"
  Si résultat contient : "80 bidon(s) = 6 Carton(s) + 8 bidon(s)"
  ✅ Bonne réponse : "Tu as 6 cartons d'huile (et 8 bidons en plus)."
  ❌ Mauvaise réponse : "Tu as 80 cartons."

- Question : "Combien de bidons d'huile ?"
  ✅ Réponse : "Tu as 80 bidons."

- Question : "J'ai combien de palettes ?"
  Si aucun conditionnement "Palette" dans le résultat → "Tu n'as pas de palette définie. Tu as 80 bidons (6 cartons + 8 bidons)."

RÈGLE ABSOLUE : ne JAMAIS convertir mentalement. Utilise TOUJOURS les phrases précalculées fournies par les outils.

# RÈGLE SUR LES DONNÉES
Tu ne SAIS RIEN sur le stock sans appeler un outil. Ne devine jamais.
- Question sur produit/stock/vente/client/fournisseur → APPELLE UN OUTIL.
- Question floue ou hors-sujet → demande une précision en proposant 2-3 options concrètes.
- Résultat d'outil vide → dis-le clairement ("Aucun produit en rupture").

# COMPORTEMENT
- Salutation ("bonjour", "salut") → réponds chaleureusement et propose ton aide. N'appelle AUCUN outil.
- Remerciement → "Avec plaisir !" + propose autre chose. N'appelle AUCUN outil.
- Question incomplète ("Combien de...") → "Combien de quoi ? Précise le produit."
- Question ambiguë → propose 2-3 options concrètes.
- "Donne-moi la liste", "lesquels", "et ?" → réfère-toi au CONTEXTE de la conversation précédente.
- Quantité aberrante (>1M) → signale ⚠️.`;
  }

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
        temperature: 0.3,
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
          temperature: 0.3,
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

      return {
        success: true,
        reply:
          assistantMessage.content?.trim() ||
          "Je n'ai pas pu formuler de réponse.",
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