// from openai import 
import openai from OpenAI


class GPTController {
  async generateResponse(req, res) {
    // récupérer le fichier audio depuis la requête
    const audioFile = req.file; 
    try {

    const client = OpenAI()
    const audio_file = open(audioFile.path, "rb")

    const transcription = client.audio.transcriptions.create(
        model="gpt-transcribe", file=audio_file
    )

    console.log(transcription.text)

    } catch (error) {
      console.error("Erreur lors de la génération de la réponse:", error);
      res.status(500).json({ error: "Erreur interne du serveur" });
    }
  }
}