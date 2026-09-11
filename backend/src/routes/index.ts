import { ocrRouter } from './ocr.routes.js';
import { Router } from 'express';
import { health } from '../controllers/health.controller.js';
export const apiRouter = Router();
apiRouter.get('/health', health);

apiRouter.use('/ocr', ocrRouter);
