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
