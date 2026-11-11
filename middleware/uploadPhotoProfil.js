// middleware/uploadPhotoProfil.js
// Photo de profil (patron ou employé). Rangée dans /uploads/profils sous un nom
// aléatoire impossible à deviner, pour pouvoir l'afficher dans une simple balise image.
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_PHOTOS = path.join(__dirname, '..', 'uploads', 'profils');
if (!fs.existsSync(DOSSIER_PHOTOS)) fs.mkdirSync(DOSSIER_PHOTOS, { recursive: true });

const TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const televerser = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, DOSSIER_PHOTOS),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase();
            cb(null, `p-${crypto.randomBytes(16).toString('hex')}${ext === '.jpeg' ? '.jpg' : ext}`);
        },
    }),
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (TYPES[ext] && (file.mimetype === TYPES[ext] || file.mimetype === 'application/octet-stream')) return cb(null, true);
        cb(Object.assign(new Error('Photo refusée : JPG, PNG ou WEBP'), { statusCode: 400 }));
    },
}).single('photo');

export const uploadPhotoProfil = (req, res, next) => televerser(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde (3 Mo maximum)' : err.message;
    return res.status(400).json({ success: false, message });
});

export const urlPhoto = (fichier) => `/uploads/profils/${fichier}`;

/** Supprime l'ancienne photo (seulement si elle est bien dans /uploads/profils). */
export function supprimerPhoto(url) {
    if (!url || !url.startsWith('/uploads/profils/')) return;
    const nom = path.basename(url);
    if (!/^p-[a-f0-9]{32}\.(png|webp|jpg)$/.test(nom)) return;
    fs.promises.unlink(path.join(DOSSIER_PHOTOS, nom)).catch(() => {});
}
