import type { RequestHandler } from 'express';
import { z } from 'zod';
import { recognizeDocument } from '../services/documentOcr.service.js';
import { OcrError } from '../services/ocrError.js';
const fields = z.object({ pageId: z.uuid() }).strict();
export const ocr: RequestHandler = async (req, res) => {
  const parsed = fields.safeParse(req.body);
  if (!parsed.success)
    throw new OcrError(400, 'INVALID_PAGE_ID', 'Provide a valid pageId UUID.');
  if (!req.file)
    throw new OcrError(400, 'IMAGE_REQUIRED', 'Provide one image.');
  const { buffer, mimetype, size } = req.file;
  const png = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    buffer.length >= 3 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255;
  if (!(
    (mimetype === 'image/png' && png) ||
    (mimetype === 'image/jpeg' && jpeg)
  )) {
    req.file = undefined;
    throw new OcrError(
      415,
      'UNSUPPORTED_IMAGE',
      'Provide a PNG or JPEG image.',
    );
  }
  const started = performance.now();
  let success = false;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await recognizeDocument(buffer, mimetype);
    success = true;
    if (!res.destroyed) res.json(result);
  } finally {
    req.log.info(
      {
        pageId: parsed.data.pageId,
        provider: 'google-document-ai',
        durationMs: Math.round(performance.now() - started),
        inputBytes: size,
        success,
      },
      'OCR request completed',
    );
    req.file = undefined;
  }
};
