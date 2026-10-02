// middleware/uploadAudio.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const audioDir = path.join(process.cwd(), 'uploads', 'audio');

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, audioDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.m4a';
    const uniqueName = `audio_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
    'audio/wav', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/x-m4a',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Format audio non supporté : ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

export default upload;