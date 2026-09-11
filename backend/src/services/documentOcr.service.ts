import { v1 } from '@google-cloud/documentai';
import { env } from '../config/env.js';
import { OcrError } from './ocrError.js';
import { normalizeDocument } from './documentText.js';
let client: v1.DocumentProcessorServiceClient | undefined;
let active = 0;
export function googleDocumentAiConfigured() {
  return Boolean(
    env.GOOGLE_CLOUD_PROJECT_ID &&
    env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID &&
    env.GOOGLE_DOCUMENT_AI_LOCATION,
  );
}
export async function recognizeDocument(image: Buffer, mimeType: string) {
  if (!googleDocumentAiConfigured())
    throw new OcrError(503, 'OCR_UNAVAILABLE', 'Cloud OCR is not configured.');
  if (active >= env.OCR_MAX_CONCURRENT_REQUESTS)
    throw new OcrError(429, 'OCR_BUSY', 'Cloud OCR is busy.');
  active++;
  // Hold the slot until the SDK settles, even if auth initialization outlives our
  // response deadline. This keeps timed-out requests from growing memory unbounded.
  const operation = processImage(image, mimeType).finally(() => {
    active--;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new OcrError(504, 'OCR_TIMEOUT', 'Cloud OCR timed out.')),
          env.OCR_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function processImage(image: Buffer, mimeType: string) {
  try {
    client ??= new v1.DocumentProcessorServiceClient({
      apiEndpoint: `${env.GOOGLE_DOCUMENT_AI_LOCATION}-documentai.googleapis.com`,
    });
    const name = client.processorPath(
      env.GOOGLE_CLOUD_PROJECT_ID,
      env.GOOGLE_DOCUMENT_AI_LOCATION,
      env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    );
    const [result] = await client.processDocument(
      {
        name,
        rawDocument: { content: image, mimeType },
        fieldMask: {
          paths: ['text', 'pages.paragraphs', 'pages.detected_languages'],
        },
      },
      { timeout: env.OCR_TIMEOUT_MS, retry: null },
    );
    if (!result.document)
      throw new OcrError(502, 'OCR_FAILED', 'Cloud OCR returned no document.');
    return normalizeDocument(result.document);
  } catch (cause) {
    if (cause instanceof OcrError) throw cause;
    // Do not log or expose SDK errors: they may contain request/auth details.
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? cause.code
        : undefined;
    throw code === 4
      ? new OcrError(504, 'OCR_TIMEOUT', 'Cloud OCR timed out.')
      : new OcrError(
          503,
          'OCR_UNAVAILABLE',
          'Cloud OCR is temporarily unavailable.',
        );
  }
}
