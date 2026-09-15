import { ocrRouter } from './ocr.routes.js';
import { proofreadRouter } from './proofread.routes.js';
import { speechRouter } from './speech.routes.js';
import { Router } from 'express';
import { health } from '../controllers/health.controller.js';
export const apiRouter = Router();
apiRouter.get('/health', health);

apiRouter.use('/ocr', ocrRouter);
apiRouter.use('/proofread', proofreadRouter);
apiRouter.use('/speech', speechRouter);
