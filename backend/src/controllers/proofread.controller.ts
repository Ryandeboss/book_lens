import type { RequestHandler } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { proofreadText } from '../services/proofread.service.js';
import { OcrError } from '../services/ocrError.js';

const input = z
  .object({
    pageId: z.uuid(),
    text: z
      .string()
      .min(1)
      .max(20000)
      .refine((value) => value.trim().length > 0),
  })
  .strict();
export const proofread: RequestHandler = async (req, res, next) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success)
    return next(
      new OcrError(
        400,
        'INVALID_TEXT',
        'Provide a page ID and 1–20000 characters of OCR text.',
      ),
    );
  const start = Date.now();
  const controller = new AbortController();
  const closed = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', closed);
  try {
    const result = await proofreadText(parsed.data.text, controller.signal);
    logger.info(
      {
        pageId: parsed.data.pageId,
        duration: Date.now() - start,
        status: result.status,
      },
      'Text cleanup finished',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    logger.warn(
      { pageId: parsed.data.pageId, duration: Date.now() - start },
      'Text cleanup unavailable',
    );
    next(error);
  } finally {
    res.removeListener('close', closed);
  }
};
