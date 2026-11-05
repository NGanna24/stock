// Services/GptService.js
// Ce fichier s'occupe UNIQUEMENT de la transcription audio :
// Gemini écoute l'audio (gratuit) ; Groq Whisper si IA_FOURNISSEUR=groq
import fs from 'fs';
import Groq from 'groq-sdk';
import Gemini from './GeminiClient.js';
import dotenv from 'dotenv';

dotenv.config();

class GptService {
  constructor() {
    this.fournisseur = (process.env.IA_FOURNISSEUR || (Gemini.disponible() ? 'gemini' : 'groq')).toLowerCase();
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  /**
   * Transcrit un fichier audio avec Groq Whisper
   * @param {string} filePath - Chemin absolu vers le fichier audio
   * @param {string} language - Code langue ISO (ex: 'fr')
   */
  async transcribe(filePath, language = 'fr', vocabulaire = '', mimetype = '') {
    if (!fs.existsSync(filePath)) {
      throw new Error('Fichier audio introuvable');
    }

    if (this.fournisseur === 'gemini') {
      try {
        return await Gemini.transcrire(filePath, { vocabulaire, mimetype });
      } catch (error) {
        console.error('[GptService] Erreur transcription Gemini:', error.message);
        throw new Error(error.message || 'Erreur lors de la transcription');
      }
    }

    try {
      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-large-v3',
        language: language,
        response_format: 'verbose_json',
        temperature: 0,
        // Noms de produits, marques et clients du magasin : Whisper les écrit
        // correctement au lieu d'un mot qui sonne pareil
        ...(vocabulaire ? { prompt: vocabulaire.slice(0, 700) } : {}),
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