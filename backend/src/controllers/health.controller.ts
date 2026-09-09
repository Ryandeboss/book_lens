import type { RequestHandler } from 'express';
import { getHealth } from '../services/health.service.js';
export const health: RequestHandler = (_req, res) => {
  res.json(getHealth());
};
