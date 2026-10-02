// Services/GptService.js
// ⚠️ Ce fichier s'occupe UNIQUEMENT de la transcription audio (Whisper via Groq)
import fs from 'fs';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

class GptService {
  constructor() {
    if (!process.env.GROQ_API_KEY) {
      console.warn('⚠️ [GptService] GROQ_API_KEY manquant dans .env');
    }

    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  /**
   * Transcrit un fichier audio avec Groq Whisper
   * @param {string} filePath - Chemin absolu vers le fichier audio
   * @param {string} language - Code langue ISO (ex: 'fr')
   */
  async transcribe(filePath, language = 'fr') {
    if (!fs.existsSync(filePath)) {
      throw new Error('Fichier audio introuvable');
    }

    try {
      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-large-v3',
        language: language,
        response_format: 'verbose_json',
        temperature: 0.2,
      });

      return {
        text: transcription.text?.trim() || '',
        duration: transcription.duration || null,
        language: transcription.language || language,
      };
    } catch (error) {
      console.error('❌ [GptService] Erreur Whisper:', error.message);
      throw new Error(
        error?.error?.message ||
          error.message ||
          'Erreur lors de la transcription'
      );
    }
  }

  /**
   * Supprime un fichier audio après usage
   */
  deleteFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn('⚠️ Impossible de supprimer le fichier:', filePath, err.message);
    }
  }
}

export default new GptService();