// config/upload.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== DOSSIERS ====================
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'magasins');

// Créer le dossier s'il n'existe pas
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ==================== STORAGE ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const timestamp = Date.now();
        const userId = req.user?.id_utilisateur || 'unknown';
        cb(null, `magasin-${userId}-${timestamp}${ext}`);
    }
});

// ==================== FILTRE ====================
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|svg/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);

    if (ext && mime) {
        cb(null, true);
    } else {
        cb(new Error('Format non autorisé. Formats acceptés : JPG, PNG, WEBP, SVG'));
    }
};

// ==================== MIDDLEWARE ====================
export const uploadLogo = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2 Mo max
    }
}).single('logo');

// ==================== HELPER : SUPPRIMER UN FICHIER ====================
export const deleteFile = (filepath) => {
    try {
        if (filepath && fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`🗑️ Fichier supprimé : ${filepath}`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('❌ Erreur suppression fichier:', err);
        return false;
    }
};

// ==================== HELPER : EXTRAIRE LE PATH D'UNE URL ====================
export const getFilePathFromUrl = (url) => {
    if (!url) return null;
    // URL = "/uploads/magasins/magasin-1-123456.png"
    // → path = "backend/uploads/magasins/magasin-1-123456.png"
    const filename = url.split('/').pop();
    return path.join(UPLOAD_DIR, filename);
};