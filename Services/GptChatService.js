// Services/GptChatService.js
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
// ✅ Chemin correct : dossier "toolss" (avec 2 "s") dans Services/
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

  getSystemPrompt() {
    const today = new Date().toISOString().slice(0, 10);
    return `Tu es Miyo, l'assistant vocal intelligent de l'application de gestion de stock pour vendeurs de pièces détachées en Afrique.

Ton rôle :
- Répondre aux questions de l'utilisateur sur SON stock (produits, ventes, clients, factures...)
- Utiliser les outils (functions) disponibles pour récupérer des données RÉELLES
- Répondre en français, de manière concise et naturelle, comme un humain
- Utiliser un ton amical et professionnel

Règles IMPORTANTES :
1. Ne JAMAIS inventer de données. Si tu ne sais pas, appelle un outil.
2. Les montants sont en francs CFA. Formate-les avec des espaces : 15 000 F CFA.
3. Aujourd'hui nous sommes le ${today}. Utilise cette date pour les questions relatives.
4. Ne donne PAS de détails techniques (SQL, noms d'outils, IDs...).
5. Si la question n'a aucun rapport avec la gestion de stock, réponds poliment que tu es spécialisé dans le stock.
6. Sois bref : 1 à 3 phrases maximum, sauf si l'utilisateur demande une liste explicite.
7. Si un outil retourne un tableau vide, dis-le clairement.
8. Si l'utilisateur demande une liste, formate-la clairement (numérotée ou avec des tirets).

Exemples :
- "Il vous reste 12 bougies en stock, dont 3 en stock bas."
- "Vous avez 5 produits en rupture de stock."
- "Votre chiffre d'affaires de ce mois est de 250 000 F CFA pour 15 commandes."`;
  }

  async chat(userMessage, workspaceId, user = {}) {
    if (!userMessage || typeof userMessage !== 'string') {
      throw new Error('Message utilisateur requis');
    }

    if (!workspaceId) {
      throw new Error("workspaceId manquant (problème d'authentification)");
    }

    const messages = [
      { role: 'system', content: this.getSystemPrompt() },
      { role: 'user', content: userMessage.trim() },
    ];

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
            toolResult = { error: err.message || 'Erreur outil' };
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

      return {
        success: true,
        reply:
          assistantMessage.content?.trim() ||
          "Je n'ai pas pu formuler de réponse.",
        iterations,
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