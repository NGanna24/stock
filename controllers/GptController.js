// controllers/GptController.js
import GptService from '../Services/GptService.js';
import GptChatService from '../Services/GptChatService.js';
import { vocabulaireMagasin } from '../Services/toolss/Recherche.js';
import Gemini from '../Services/GeminiClient.js';
import { reponseRapide, INTENTIONS } from '../Services/ReponsesRapides.js';

// Historique envoyé par l'application (JSON en texte quand il y a un fichier audio)
const lireHistorique = (brut) => {
  let h = brut;
  if (typeof h === 'string') {
    try { h = JSON.parse(h); } catch { h = []; }
  }
  return Array.isArray(h)
    ? h.filter((x) => x && typeof x.content === 'string' && (x.role === 'user' || x.role === 'assistant')).slice(-8)
    : [];
};

class GptController {
  static async transcribe(req, res) {
    const filePath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Aucun fichier audio fourni',
        });
      }

      const language = (req.body?.language || 'fr').slice(0, 5);
      console.log(`🎤 [GptController] Transcription : ${req.file.originalname}`);

      let vocabulaire = '';
      try {
        vocabulaire = await vocabulaireMagasin(req.workspaceId);
      } catch {
        // sans vocabulaire, la dictée marche quand même
      }
      const result = await GptService.transcribe(filePath, language, vocabulaire, req.file.mimetype);
      GptService.deleteFile(filePath);

      if (!result.text || result.text.trim() === '') {
        return res.status(200).json({
          success: false,
          message: 'Aucune parole détectée',
          text: '',
        });
      }

      return res.status(200).json({
        success: true,
        text: result.text,
        duration: result.duration,
        language: result.language,
      });
    } catch (error) {
      console.error('❌ Erreur transcribe:', error);
      if (filePath) GptService.deleteFile(filePath);
      return res.status(500).json({
        success: false,
        message: error.message || 'Erreur transcription',
      });
    }
  }

  static async chat(req, res) {
    try {
      const { message, history = [] } = req.body;

      if (!message || typeof message !== 'string' || message.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Le champ "message" est requis',
        });
      }

      // Valider l'historique
      const safeHistory = Array.isArray(history)
        ? history
            .filter(
              (h) =>
                h &&
                typeof h.content === 'string' &&
                (h.role === 'user' || h.role === 'assistant')
            )
            .slice(-8)
        : [];

      console.log(
        `💬 [GptController] Question : "${message}" (user ${req.workspaceId}, hist: ${safeHistory.length})`
      );

      // ✅ On passe bien safeHistory en 4e argument
      const result = await GptChatService.chat(
        message,
        req.workspaceId,
        req.user,
        safeHistory
      );

      console.log(
        `✅ [GptController] Réponse : "${result.reply}" (tools: ${result.tools_used?.join(', ') || 'aucun'}, iter: ${result.iterations})`
      );

      return res.status(200).json({
        success: true,
        reply: result.reply,
        // Brouillon à confirmer dans l'application (vente préparée par la voix)
        action: result.action || null,
        // Données trouvées, rejouées par l'application dans l'historique
        memo: result.memo || null,
      });
    } catch (error) {
      console.error('❌ Erreur chat:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Erreur de conversation',
      });
    }
  }
}

/**
 * POST /api/gpt/voix (fichier « audio » + « historique »)
 * Une seule étape : Gemini écoute la voix, cherche dans la boutique et répond.
 * Si Google est saturé : dictée (Whisper) puis réponse, comme avant.
 */
GptController.voix = async (req, res) => {
  const filePath = req.file?.path;
  const debut = Date.now();
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun enregistrement reçu' });
    const historique = lireHistorique(req.body?.historique);
    let vocabulaire = '';
    try { vocabulaire = await vocabulaireMagasin(req.workspaceId); } catch { /* facultatif */ }

    let result = null;
    if (Gemini.disponible()) {
      try {
        const audio = Gemini.audioDepuisFichier(filePath, req.file.mimetype);
        result = await GptChatService.chat('', req.workspaceId, req.user, historique, { audio, vocabulaire });
      } catch (e) {
        console.warn('[GptController.voix] voix directe impossible, passage par la dictée :', e.message);
        result = null;
      }
    }
    if (!result) {
      const t = await GptService.transcribe(filePath, 'fr', vocabulaire, req.file.mimetype);
      if (!t.text || !t.text.trim()) {
        return res.json({ success: false, message: "Je n'ai rien entendu. Parle plus près du téléphone." });
      }
      result = await GptChatService.chat(t.text, req.workspaceId, req.user, historique);
      result.question = t.text;
    }
    if (result.question === '') {
      return res.json({ success: false, message: "Je n'ai rien entendu. Parle plus près du téléphone." });
    }
    console.log(`🎤 [GptController.voix] ${Date.now() - debut} ms · « ${result.question || '?'} » → « ${result.reply} »`);
    return res.json({
      success: true,
      question: result.question || null,
      reply: result.reply,
      action: result.action || null,
      memo: result.memo || null,
    });
  } catch (error) {
    console.error('❌ Erreur voix:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erreur de conversation' });
  } finally {
    if (filePath) GptService.deleteFile(filePath);
  }
};

/** POST /api/gpt/rapide { intention } : réponse immédiate, sans IA */
GptController.rapide = async (req, res) => {
  try {
    const intention = String(req.body?.intention || '');
    if (!INTENTIONS.includes(intention)) return res.status(400).json({ success: false, message: 'Question inconnue' });
    const r = await reponseRapide(req, intention);
    return res.json({ success: true, reply: r.reply, carte: r.carte || null });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    console.error('❌ Erreur réponse rapide:', error);
    return res.status(500).json({ success: false, message: 'Miyo a un souci. Réessaie.' });
  }
};

export default GptController;