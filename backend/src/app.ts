import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { allowedOrigins } from './config/env.js';
import { logger } from './config/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';

export const app = express();
app.disable('x-powered-by');
app.use(pinoHttp({ logger }));
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => {
  res.json({ service: 'booklens-api', health: '/api/health' });
});
app.use('/api', apiRouter);
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use(errorHandler);
