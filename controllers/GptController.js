// controllers/GptController.js
import GptService from '../Services/GptService.js';
import GptChatService from '../Services/GptChatService.js';

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

      const result = await GptService.transcribe(filePath, language);
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
            .slice(-10)
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

export default GptController;