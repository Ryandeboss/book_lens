import { Router } from 'express';
import { env } from '../config/env.js';
import { proofread } from '../controllers/proofread.controller.js';
import { proofreadConfigured } from '../services/proofread.service.js';
import { OcrError } from '../services/ocrError.js';
export const proofreadRouter = Router();
let windowStart = Date.now(),
  requests = 0;
proofreadRouter.get('/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ configured: proofreadConfigured() });
});
proofreadRouter.post(
  '/',
  (_req, res, next) => {
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      requests = 0;
    }
    if (requests >= env.PROOFREAD_REQUESTS_PER_MINUTE) {
      res.setHeader('Retry-After', '60');
      return next(new OcrError(429, 'CLEANUP_BUSY', 'Text cleanup is busy.'));
    }
    requests++;
    next();
  },
  proofread,
);
