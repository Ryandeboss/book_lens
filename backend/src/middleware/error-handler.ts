import { MulterError } from 'multer';
import { OcrError } from '../services/ocrError.js';
import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  // Express uses the four-argument signature to recognize error middleware.
  void _next;
  if (error instanceof OcrError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof MulterError) {
    res
      .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      .json({ error: 'Invalid image upload.', code: error.code });
    return;
  }
  if (_req.path.startsWith('/api/speech')) {
    logger.warn('Audio request failed');
    res
      .status(400)
      .json({ error: 'Invalid audio request.', code: 'INVALID_REQUEST' });
    return;
  }
  if (
    _req.path.startsWith('/api/ocr') ||
    _req.path.startsWith('/api/proofread')
  ) {
    logger.warn('OCR request failed');
    res
      .status(400)
      .json({ error: 'Invalid OCR request.', code: 'INVALID_REQUEST' });
    return;
  }
  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;
  if (status === 500) logger.error({ err: error }, 'Request failed');
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : 'Invalid request',
  });
};
