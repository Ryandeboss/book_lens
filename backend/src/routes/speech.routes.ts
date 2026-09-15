import { Router } from 'express';
import { env } from '../config/env.js';
import { speech } from '../controllers/speech.controller.js';
import {
  speechConfigured,
  speechMaxBytes,
} from '../services/speech.service.js';
import { OcrError } from '../services/ocrError.js';

export const speechRouter = Router();
let windowStart = Date.now(),
  requests = 0;
speechRouter.get('/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    configured: speechConfigured(),
    language: env.TTS_LANGUAGE_CODE,
    maxBytes: speechMaxBytes,
  });
});
speechRouter.post(
  '/',
  (_req, res, next) => {
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      requests = 0;
    }
    if (requests >= env.TTS_REQUESTS_PER_MINUTE) {
      res.setHeader('Retry-After', '60');
      return next(
        new OcrError(
          429,
          'SPEECH_BUSY',
          'Audio export is busy. Try again shortly.',
        ),
      );
    }
    requests++;
    next();
  },
  speech,
);
