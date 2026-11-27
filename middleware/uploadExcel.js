// middleware/uploadExcel.js
// Fichier Excel (.xlsx) envoyé pour l'import de produits.
// Gardé en mémoire le temps de la requête : rien n'est écrit sur le disque du serveur.
import multer from 'multer';
import path from 'path';

const TYPES_XLSX = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
    'application/zip',
];

const televerser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ext === '.xlsx' && TYPES_XLSX.includes(file.mimetype)) return cb(null, true);
        cb(Object.assign(new Error('Fichier refusé : choisis un fichier Excel au format .xlsx'), { statusCode: 400 }));
    },
}).single('fichier');

// Les erreurs deviennent un message clair
export const uploadExcel = (req, res, next) => televerser(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (5 Mo maximum)' : err.message;
    return res.status(400).json({ success: false, message });
});
