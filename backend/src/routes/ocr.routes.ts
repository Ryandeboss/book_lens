import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { ocr } from '../controllers/ocr.controller.js';
import { googleDocumentAiConfigured } from '../services/documentOcr.service.js';
import { OcrError } from '../services/ocrError.js';
export const ocrRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 1,
    fields: 1,
    parts: 3, // Busboy signals the parts limit when the boundary is reached.
    fieldSize: 128,
  },
  fileFilter: (_req, file, done) => {
    if (['image/png', 'image/jpeg'].includes(file.mimetype)) done(null, true);
    else
      done(
        new OcrError(415, 'UNSUPPORTED_IMAGE', 'Provide a PNG or JPEG image.'),
      );
  },
});
let uploads = 0,
  windowStart = Date.now(),
  requests = 0;
ocrRouter.get('/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ googleDocumentAiConfigured: googleDocumentAiConfigured() });
});
ocrRouter.post(
  '/',
  (req, res, next) => {
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      requests = 0;
    }
    if (
      uploads >= env.OCR_MAX_CONCURRENT_REQUESTS ||
      requests >= env.OCR_REQUESTS_PER_MINUTE
    ) {
      res.setHeader('Retry-After', '60');
      return next(new OcrError(429, 'OCR_BUSY', 'Cloud OCR is busy.'));
    }
    requests++;
    uploads++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        uploads--;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  },
  upload.single('image'),
  ocr,
);
