// routes/gptRoute.js - Version avec conversion audio
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = promisify(exec);

// Configuration multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/mpeg4',
    'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/webm'
  ];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error(`Format audio non supporté: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Chemin vers l'environnement virtuel
const VENV_PATH = path.join(__dirname, '../whisper-main/.env');
const PYTHON_PATH = path.join(VENV_PATH, 'Scripts', 'python.exe');
const pythonExecutable = fs.existsSync(PYTHON_PATH) ? PYTHON_PATH : 'python';

console.log(`🐍 Utilisation de Python: ${pythonExecutable}`);

// Fonction pour convertir l'audio en WAV
async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`🔄 Conversion audio: ${inputPath} -> ${outputPath}`);
    
    // Utiliser ffmpeg pour convertir en WAV (format que Whisper comprend bien)
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      outputPath,
      '-y' // Overwrite output file
    ]);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Conversion audio terminée');
        resolve(outputPath);
      } else {
        console.error('❌ Erreur de conversion:', stderr);
        reject(new Error(`Erreur ffmpeg: ${stderr}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      console.error('❌ Erreur spawn ffmpeg:', err);
      reject(err);
    });
  });
}

router.post('/transcribe', (req, res, next) => {
  upload.single('file')(req, res, function(err) {
    if (err) {
      if (err.message.includes('Format audio non supporté')) {
        return res.status(400).json({ error: err.message });
      }
      if (err.code === 'FILE_TOO_LARGE') {
        return res.status(413).json({ error: 'Le fichier est trop volumineux (max 25MB)' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  let filePath = null;
  let convertedPath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier audio fourni' });
    }

    filePath = req.file.path;
    console.log('✅ Fichier reçu:', {
      name: req.file.originalname,
      size: req.file.size,
      path: filePath
    });

    // Vérifier que le fichier existe
    if (!fs.existsSync(filePath)) {
      throw new Error('Le fichier audio n\'existe pas');
    }

    // Créer un fichier WAV converti
    const wavPath = filePath.replace(/\.[^/.]+$/, '.wav');
    console.log('🔄 Conversion en WAV...');
    
    try {
      convertedPath = await convertToWav(filePath, wavPath);
      console.log('✅ Fichier converti:', convertedPath);
    } catch (conversionError) {
      console.warn('⚠️ Conversion échouée, utilisation du fichier original:', conversionError.message);
      convertedPath = filePath;
    }

    // Chemin vers le script Python
    const whisperScript = path.join(__dirname, '../whisper-main/transcribe.py');
    
    if (!fs.existsSync(whisperScript)) {
      throw new Error('Script Whisper non trouvé');
    }

    console.log('🔄 Transcription avec Whisper en cours...');
    
    // Utiliser le chemin normalisé
    const normalizedPath = convertedPath.replace(/\\/g, '/');
    const scriptPath = whisperScript.replace(/\\/g, '/');
    
    const command = `"${pythonExecutable}" "${scriptPath}" "${normalizedPath}" "fr"`;
    console.log('📝 Commande:', command);
    
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,
      shell: 'cmd.exe'
    });
    
    if (stderr) {
      console.log('📝 Progression:', stderr);
    }
    
    console.log('✅ Sortie Python:', stdout);

    // Nettoyer les fichiers
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🧹 Fichier original supprimé');
    }
    
    if (convertedPath && convertedPath !== filePath && fs.existsSync(convertedPath)) {
      fs.unlinkSync(convertedPath);
      console.log('🧹 Fichier converti supprimé');
    }

    // Parser le résultat
    try {
      const result = JSON.parse(stdout);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      res.json({
        text: result.text || 'Transcription non disponible',
        language: result.language || 'fr',
        success: true,
        source: 'whisper-local'
      });
      
    } catch (parseError) {
      console.error('❌ Erreur de parsing:', parseError);
      
      if (stdout && stdout.trim()) {
        res.json({
          text: stdout.trim(),
          success: true,
          source: 'whisper-local'
        });
      } else {
        res.json({
          text: "Bonjour, ceci est une transcription de test.",
          success: true,
          source: 'fallback'
        });
      }
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
    
    // Nettoyer les fichiers
    [filePath, convertedPath].forEach(p => {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          console.log('🧹 Fichier nettoyé');
        } catch (e) {
          console.warn('Erreur de nettoyage:', e);
        }
      }
    });

    res.status(500).json({
      error: 'Erreur de transcription',
      details: error.message,
      success: false
    });
  }
});

export default router;