// middleware/uploadImageDocument.js
// Image de cachet ou de signature (PNG de préférence, fond transparent).
// Rangée HORS du dossier public /uploads.
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_IMAGES_DOCUMENTS = path.join(__dirname, '..', 'prive', 'documents');
if (!fs.existsSync(DOSSIER_IMAGES_DOCUMENTS)) fs.mkdirSync(DOSSIER_IMAGES_DOCUMENTS, { recursive: true });

const TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const televerser = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, DOSSIER_IMAGES_DOCUMENTS),
        filename: (req, file, cb) => cb(null, `doc-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`),
    }),
    limits: { fileSize: 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (TYPES[ext] && (file.mimetype === TYPES[ext] || file.mimetype === 'application/octet-stream')) return cb(null, true);
        cb(Object.assign(new Error('Image refusée : PNG (fond transparent conseillé), WEBP ou JPG'), { statusCode: 400 }));
    },
}).single('image');

export const uploadImageDocument = (req, res, next) => televerser(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (1 Mo maximum)' : err.message;
    return res.status(400).json({ success: false, message });
});
