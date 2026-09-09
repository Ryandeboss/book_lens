import { Router } from 'express';
import { health } from '../controllers/health.controller.js';
export const apiRouter = Router();
apiRouter.get('/health', health);
