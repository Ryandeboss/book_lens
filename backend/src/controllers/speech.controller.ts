import type { RequestHandler } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { OcrError } from '../services/ocrError.js';
import {
  speechMaxBytes,
  synthesizeSpeech,
} from '../services/speech.service.js';

const input = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .refine((text) => Buffer.byteLength(text, 'utf8') <= speechMaxBytes),
  })
  .strict();
export const speech: RequestHandler = async (req, res, next) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success)
    return next(
      new OcrError(400, 'SPEECH_TEXT', 'Provide 1–4500 UTF-8 bytes of text.'),
    );
  const start = Date.now();
  const controller = new AbortController();
  const closed = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', closed);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const audio = await synthesizeSpeech(parsed.data.text, controller.signal);
    logger.info(
      { duration: Date.now() - start, bytes: audio.length },
      'Audio part generated',
    );
    if (!controller.signal.aborted) res.type('audio/mpeg').send(audio);
  } catch (error) {
    logger.warn(
      {
        duration: Date.now() - start,
        code: error instanceof OcrError ? error.code : 'SPEECH_UNAVAILABLE',
      },
      'Audio export failed',
    );
    if (!controller.signal.aborted) next(error);
  } finally {
    res.removeListener('close', closed);
  }
};
