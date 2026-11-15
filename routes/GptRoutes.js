// routes/GptRoutes.js — Fichier complet
import express from 'express';
import GptController from '../controllers/GptController.js';
import { authenticateToken } from '../middleware/middleware.js';
import upload from '../middleware/uploadAudio.js';

const router = express.Router();

// Transcription audio (existant)
router.post(
  '/transcribe',
  authenticateToken,
  upload.single('audio'),
  GptController.transcribe
);

// ✅ NOUVELLE ROUTE : Chat avec Miyo
router.post('/chat', authenticateToken, GptController.chat);

// Voix en une seule étape : écouter, chercher, répondre
router.post('/voix', authenticateToken, upload.single('audio'), GptController.voix);

// Réponses immédiates (gros boutons de l'assistant), sans IA
router.post('/rapide', authenticateToken, GptController.rapide);

export default router;