// middleware/uploadJustificatif.js
// Photo de reçu / facture jointe à une opération de compte fournisseur.
// Rangée HORS du dossier public /uploads : elle n'est servie qu'après contrôle du compte.
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_JUSTIFICATIFS = path.join(__dirname, '..', 'prive', 'comptes-fournisseurs');
if (!fs.existsSync(DOSSIER_JUSTIFICATIFS)) fs.mkdirSync(DOSSIER_JUSTIFICATIFS, { recursive: true });

const EXTENSIONS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };

const stockage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, DOSSIER_JUSTIFICATIFS),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, `cf-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
});

const televerser = multer({
    storage: stockage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (EXTENSIONS[ext] && (file.mimetype === EXTENSIONS[ext] || file.mimetype === 'application/octet-stream')) return cb(null, true);
        cb(Object.assign(new Error('Justificatif refusé : photo (JPG, PNG, WEBP) ou PDF seulement'), { statusCode: 400 }));
    },
}).single('justificatif');

// Le fichier est facultatif ; les erreurs deviennent un message clair
export const uploadJustificatif = (req, res, next) => televerser(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Justificatif trop lourd (5 Mo maximum)' : err.message;
    return res.status(400).json({ success: false, message });
});

export const typeJustificatif = (nom) => EXTENSIONS[path.extname(nom || '').toLowerCase()] || 'application/octet-stream';

export const supprimerJustificatif = (nom) => {
    try { if (nom) fs.unlinkSync(path.join(DOSSIER_JUSTIFICATIFS, path.basename(nom))); } catch { /* déjà absent */ }
};
