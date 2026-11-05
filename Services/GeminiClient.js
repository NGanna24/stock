// Services/GeminiClient.js
// ============================================================
// GOOGLE GEMINI (formule gratuite) pour l'assistant Miyo
// - discussion avec outils, au même format que Groq / OpenAI
//   (GptChatService n'a presque rien à changer)
// - transcription de la voix : Gemini écoute directement l'audio
// Clé gratuite : https://aistudio.google.com/apikey  → GEMINI_API_KEY dans .env
// ============================================================
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const API = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

// Si un modèle n'existe plus (Google en retire régulièrement), on essaie le suivant
const MODELES_SECOURS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

const MIME_AUDIO = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.caf': 'audio/x-caf',
  '.3gp': 'audio/3gpp',
};

class ErreurGemini extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class GeminiClient {
  constructor() {
    this.cle = process.env.GEMINI_API_KEY || '';
    const choisi = (process.env.GEMINI_MODEL || '').trim();
    this.modeles = [...new Set([choisi, ...MODELES_SECOURS].filter(Boolean))];
    this.modeleActif = this.modeles[0];
    if (!this.cle) console.warn('[Gemini] GEMINI_API_KEY manquant dans .env');
  }

  disponible() {
    return Boolean(this.cle);
  }

  // ------------------------------------------------------------
  // Appel brut, avec bascule de modèle si Google répond 404
  // ------------------------------------------------------------
  async generer(corps, { modele } = {}) {
    if (!this.cle) throw new ErreurGemini("Clé Gemini absente : ajoute GEMINI_API_KEY dans le fichier .env du serveur.", 401);

    const essais = modele ? [modele] : [this.modeleActif, ...this.modeles.filter((m) => m !== this.modeleActif)];
    let derniere;
    for (const m of essais) {
      const rep = await fetch(`${API}/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cle },
        body: JSON.stringify(corps(m)),
      });
      const texte = await rep.text();
      let json = {};
      try {
        json = JSON.parse(texte);
      } catch {
        json = {};
      }
      if (rep.ok) {
        if (m !== this.modeleActif) {
          console.warn(`[Gemini] modèle ${this.modeleActif} indisponible, on utilise ${m}`);
          this.modeleActif = m;
        }
        return json;
      }
      const msg = json?.error?.message || texte.slice(0, 300) || `HTTP ${rep.status}`;
      derniere = new ErreurGemini(msg, rep.status);
      // 404 = modèle inconnu → on essaie le suivant ; le reste est une vraie erreur
      if (rep.status !== 404) break;
    }
    if (derniere?.status === 429) {
      throw new ErreurGemini("Miyo a atteint la limite gratuite de Google pour le moment. Réessaie dans une minute.", 429);
    }
    if (derniere?.status === 400 && /api key/i.test(derniere.message)) {
      throw new ErreurGemini('La clé Gemini est invalide. Vérifie GEMINI_API_KEY dans le .env du serveur.', 400);
    }
    throw derniere || new ErreurGemini('Gemini ne répond pas', 500);
  }

  // Réglages de réflexion : courts pour répondre vite à la voix
  static reglages(modele, maxTokens) {
    const g = { maxOutputTokens: maxTokens };
    if (/gemini-3|flash-latest/.test(modele)) {
      g.thinkingConfig = { thinkingLevel: 'low' };
    } else if (/gemini-2\.5/.test(modele)) {
      g.thinkingConfig = { thinkingBudget: 512 };
      g.temperature = 0.3;
    }
    return g;
  }

  // ------------------------------------------------------------
  // Conversion : messages façon OpenAI → contenus Gemini
  // ------------------------------------------------------------
  static versGemini(messages) {
    let systeme = '';
    const contenus = [];
    // id d'appel → nom de l'outil (le message « tool » ne porte que l'id)
    const appels = new Map();
    const pousser = (role, parts) => {
      const dernier = contenus[contenus.length - 1];
      // Gemini veut des rôles qui alternent : on fusionne les suites
      if (dernier && dernier.role === role) dernier.parts.push(...parts);
      else contenus.push({ role, parts: [...parts] });
    };

    for (const m of messages) {
      if (m.role === 'system') {
        systeme += (systeme ? '\n\n' : '') + m.content;
      } else if (m.role === 'user') {
        pousser('user', [{ text: String(m.content ?? '') }]);
      } else if (m.role === 'assistant') {
        for (const t of m.tool_calls || []) {
          appels.set(t.id, { name: t.function?.name, gid: t._gemini_id });
        }
        if (Array.isArray(m._gemini_parts) && m._gemini_parts.length) {
          // On renvoie la réponse telle quelle (avec la « signature de pensée » exigée par Gemini 3)
          pousser('model', m._gemini_parts);
        } else if (m.tool_calls?.length) {
          pousser(
            'model',
            m.tool_calls.map((t) => ({
              functionCall: { name: t.function.name, args: JSON.parse(t.function.arguments || '{}') },
            }))
          );
        } else if (m.content) {
          pousser('model', [{ text: String(m.content) }]);
        }
      } else if (m.role === 'tool') {
        let resultat;
        try {
          resultat = JSON.parse(m.content);
        } catch {
          resultat = { texte: m.content };
        }
        if (resultat === null || typeof resultat !== 'object' || Array.isArray(resultat)) {
          resultat = { resultat };
        }
        const appel = appels.get(m.tool_call_id) || {};
        const reponse = { name: m.name || appel.name || 'outil', response: resultat };
        if (appel.gid) reponse.id = appel.gid;
        pousser('user', [{ functionResponse: reponse }]);
      }
    }
    return { systeme, contenus };
  }

  static outils(tools = []) {
    const declarations = tools
      .filter((t) => t?.type === 'function' && t.function?.name)
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || '',
        // JSON Schema complet accepté tel quel
        parametersJsonSchema: t.function.parameters || { type: 'object', properties: {} },
      }));
    return declarations.length ? [{ functionDeclarations: declarations }] : undefined;
  }

  // ------------------------------------------------------------
  // Discussion avec outils, réponse au format OpenAI
  // ------------------------------------------------------------
  async discuter({ messages, tools, max_tokens = 2500 }) {
    const { systeme, contenus } = GeminiClient.versGemini(messages);
    const outils = GeminiClient.outils(tools);

    const json = await this.generer((modele) => ({
      ...(systeme ? { systemInstruction: { parts: [{ text: systeme }] } } : {}),
      contents: contenus,
      ...(outils ? { tools: outils, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      generationConfig: GeminiClient.reglages(modele, max_tokens),
    }));

    const candidat = json?.candidates?.[0];
    const parts = candidat?.content?.parts || [];
    if (!candidat) {
      const raison = json?.promptFeedback?.blockReason;
      return { choices: [{ message: { role: 'assistant', content: raison ? "Je ne peux pas répondre à ça." : '' } }] };
    }

    const texte = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();

    const appels = parts.filter((p) => p.functionCall);
    const tool_calls = appels.map((p, i) => ({
      id: p.functionCall.id || `appel_${Date.now()}_${i}`,
      type: 'function',
      _gemini_id: p.functionCall.id,
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
    }));

    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: texte || null,
            ...(tool_calls.length ? { tool_calls } : {}),
            // pour renvoyer la réponse intacte au tour suivant
            _gemini_parts: parts,
          },
          finish_reason: candidat.finishReason,
        },
      ],
    };
  }

  // ------------------------------------------------------------
  // Transcription : Gemini écoute l'enregistrement
  // ------------------------------------------------------------
  async transcrire(filePath, { vocabulaire = '', mimetype = '' } = {}) {
    if (!fs.existsSync(filePath)) throw new Error('Fichier audio introuvable');
    const ext = path.extname(filePath).toLowerCase();
    let mime = MIME_AUDIO[ext] || (mimetype && mimetype.startsWith('audio/') ? mimetype : 'audio/mp4');
    if (mime === 'audio/m4a' || mime === 'audio/x-m4a') mime = 'audio/mp4';
    const data = fs.readFileSync(filePath).toString('base64');

    const consigne = `Tu es un transcripteur pour une boutique de pièces détachées et lubrifiants pour motos en Côte d'Ivoire.
Écris EXACTEMENT ce que dit la personne, en français, mot pour mot. Les nombres en chiffres (« cinq cartons » → « 5 cartons », « cinq litres » → « 5L »).
Accents ivoiriens et bruit de boutique possibles : choisis les mots qui ont du sens dans ce commerce.
${vocabulaire ? `Noms utilisés dans cette boutique (produits, marques, clients) : ${vocabulaire.slice(0, 1500)}\n` : ''}N'ajoute rien, ne réponds pas à la question, ne traduis pas. Si on n'entend aucune parole, réponds exactement : [silence]`;

    const json = await this.generer((modele) => ({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data } }, { text: consigne }] }],
      generationConfig: {
        ...GeminiClient.reglages(modele, 1024),
        ...(/gemini-2\.5/.test(modele) ? { thinkingConfig: { thinkingBudget: 0 }, temperature: 0 } : {}),
      },
    }));

    const texte = (json?.candidates?.[0]?.content?.parts || [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim()
      .replace(/^["«]|["»]$/g, '')
      .trim();

    return { text: /^\[?silence\]?\.?$/i.test(texte) ? '' : texte, duration: null, language: 'fr' };
  }
}

export default new GeminiClient();
export { GeminiClient };
