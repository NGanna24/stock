# whisper-main/transcribe_advanced.py
import whisper
import json
import sys
import os
import subprocess
import tempfile

def convert_audio_to_wav(input_path):
    """
    Convertir l'audio en WAV 16kHz mono
    """
    try:
        # Créer un fichier temporaire
        temp_wav = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        temp_wav.close()
        
        # Commande ffmpeg
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-acodec', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            temp_wav.name,
            '-y'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"Erreur ffmpeg: {result.stderr}", file=sys.stderr)
            return None
            
        return temp_wav.name
        
    except Exception as e:
        print(f"Erreur de conversion: {str(e)}", file=sys.stderr)
        return None

def transcribe_audio(file_path, language='fr'):
    """
    Transcrire un fichier audio avec Whisper
    """
    try:
        # Vérifier si le fichier existe
        if not os.path.exists(file_path):
            return {"error": f"Fichier non trouvé: {file_path}"}
        
        # Vérifier l'extension
        file_ext = os.path.splitext(file_path)[1].lower()
        audio_to_process = file_path
        
        # Convertir si ce n'est pas WAV
        if file_ext not in ['.wav', '.mp3']:
            print(f"🔄 Conversion du fichier {file_ext} en WAV...", file=sys.stderr)
            wav_path = convert_audio_to_wav(file_path)
            if wav_path and os.path.exists(wav_path):
                audio_to_process = wav_path
                print(f"✅ Conversion terminée: {wav_path}", file=sys.stderr)
            else:
                print(f"⚠️ Échec de conversion, utilisation du fichier original", file=sys.stderr)
        
        print(f"🔄 Chargement du modèle Whisper...", file=sys.stderr)
        model = whisper.load_model("base")
        
        print(f"🔄 Transcription de: {audio_to_process}", file=sys.stderr)
        
        result = model.transcribe(
            audio_to_process,
            language=language,
            task='transcribe',
            fp16=False,
            verbose=False
        )
        
        # Nettoyer le fichier temporaire
        if audio_to_process != file_path and os.path.exists(audio_to_process):
            try:
                os.unlink(audio_to_process)
                print(f"🧹 Fichier temporaire supprimé", file=sys.stderr)
            except:
                pass
        
        return {
            "text": result["text"].strip(),
            "language": result.get("language", language)
        }
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Chemin du fichier audio requis"}))
        sys.exit(1)
    
    file_path = sys.argv[1].strip('"\'')
    language = sys.argv[2] if len(sys.argv) > 2 else 'fr'
    
    # Normaliser le chemin
    file_path = file_path.replace('\\', '/')
    
    result = transcribe_audio(file_path, language)
    print(json.dumps(result))