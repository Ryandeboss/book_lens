import type { CloudOcrResult } from '../types/Page';
import { ocrConfig } from '../config/ocr';
import type { HealthResponse } from '../types/api';

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  // Accept a Render service URL with or without the API prefix.
  if (/^https?:\/\/[^/]+$/i.test(trimmed)) return `${trimmed}/api`;
  return trimmed;
}
export const apiUrl = normalizeApiUrl(
  import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api'),
);
export const cleanupStatusTimeoutMs = 60000;

export type CleanupResult =
  { status: 'applied'; correctedText: string } | { status: 'unavailable' };
const cleanupMessages: Record<string, string> = {
  CLEANUP_CONNECTION:
    'Cannot reach AI cleanup. Check the API address and allowed website origin in Connection details. Original OCR is kept.',
  CLEANUP_TIMEOUT:
    'The cleanup connection timed out. Render may be waking up; wait a moment and check again. Original OCR is kept.',
  CLEANUP_RESPONSE:
    'The server did not return a valid cleanup response. Check the API address and redeploy the backend. Original OCR is kept.',
  CLEANUP_ROUTE:
    'The cleanup endpoint was not found. Check that the API address ends in /api and the latest backend is deployed.',
  INVALID_TEXT:
    'Cleanup requires a valid page ID and between 1 and 20,000 characters of OCR text.',
  CLEANUP_AUTH:
    'OpenAI rejected the server API key. Check the key in Render and redeploy.',
  CLEANUP_ACCESS: 'The OpenAI project does not have access to this model.',
  CLEANUP_MODEL:
    'The configured OpenAI model is unavailable. Check OPENAI_PROOFREAD_MODEL in Render.',
  CLEANUP_CONFIG:
    'OpenAI rejected the model configuration. Check the Render model setting.',
  CLEANUP_QUOTA:
    'OpenAI API credits or quota are exhausted. Check API billing.',
  CLEANUP_BUSY: 'AI cleanup is busy or rate limited. Try again shortly.',
  CLEANUP_UNAVAILABLE:
    'AI cleanup is temporarily unavailable. Try again; original OCR is kept.',
};
export class CleanupApiError extends Error {
  constructor(code: string) {
    super(cleanupMessages[code] ?? cleanupMessages.CLEANUP_UNAVAILABLE);
  }
}
export const cleanupFailure = (error: unknown) =>
  error instanceof CleanupApiError
    ? error.message
    : error &&
        typeof error === 'object' &&
        'name' in error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ? cleanupMessages.CLEANUP_TIMEOUT!
      : cleanupMessages.CLEANUP_CONNECTION!;

async function cleanupJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new CleanupApiError(
      data &&
        typeof data === 'object' &&
        'code' in data &&
        typeof data.code === 'string'
        ? data.code
        : response.status === 404
          ? 'CLEANUP_ROUTE'
          : 'CLEANUP_UNAVAILABLE',
    );
  }
  try {
    return await response.json();
  } catch {
    throw new CleanupApiError('CLEANUP_RESPONSE');
  }
}
export async function getProofreadStatus(
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await fetch(`${apiUrl}/proofread/status`, {
    signal: signal ?? AbortSignal.timeout(cleanupStatusTimeoutMs),
    cache: 'no-store',
  });
  const data = await cleanupJson(response);
  if (
    !data ||
    typeof data !== 'object' ||
    !('configured' in data) ||
    typeof data.configured !== 'boolean'
  )
    throw new CleanupApiError('CLEANUP_RESPONSE');
  return data.configured;
}
export async function proofreadPage(
  text: string,
  pageId: string,
  signal: AbortSignal,
): Promise<CleanupResult> {
  const response = await fetch(`${apiUrl}/proofread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, pageId }),
    signal,
  });
  const data = await cleanupJson(response);
  if (data && typeof data === 'object' && 'status' in data) {
    if (data.status === 'unavailable') return { status: 'unavailable' };
    if (
      data.status === 'applied' &&
      'correctedText' in data &&
      typeof data.correctedText === 'string' &&
      data.correctedText.trim() &&
      data.correctedText.length <= 30000
    )
      return { status: 'applied', correctedText: data.correctedText };
  }
  throw new CleanupApiError('CLEANUP_RESPONSE');
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiUrl}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('status' in data) ||
    data.status !== 'ok' ||
    !('service' in data) ||
    data.service !== 'booklens-api'
  ) {
    throw new Error('Unexpected health response');
  }
  return { status: data.status, service: data.service };
}

export async function ocrPage(
  image: Blob,
  pageId: string,
  signal?: AbortSignal,
): Promise<CloudOcrResult> {
  if (image.size > ocrConfig.maxUploadBytes)
    throw new Error('OCR image exceeds upload limit');
  const form = new FormData();
  form.append(
    'image',
    image,
    image.type === 'image/jpeg' ? 'page.jpg' : 'page.png',
  );
  form.append('pageId', pageId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, ocrConfig.cloudTimeoutMs);
  try {
    const response = await fetch(`${apiUrl}/ocr`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Cloud OCR returned ${response.status}`);
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('provider' in data) ||
      data.provider !== 'google-document-ai' ||
      !('text' in data) ||
      typeof data.text !== 'string' ||
      ('confidence' in data &&
        (typeof data.confidence !== 'number' ||
          !Number.isFinite(data.confidence) ||
          data.confidence < 0 ||
          data.confidence > 100)) ||
      !('paragraphs' in data) ||
      !Array.isArray(data.paragraphs) ||
      !data.paragraphs.every(
        (p) =>
          p &&
          typeof p.text === 'string' &&
          (p.confidence === undefined ||
            (typeof p.confidence === 'number' &&
              Number.isFinite(p.confidence) &&
              p.confidence >= 0 &&
              p.confidence <= 1)),
      ) ||
      !('detectedLanguages' in data) ||
      !Array.isArray(data.detectedLanguages) ||
      !data.detectedLanguages.every((l) => typeof l === 'string')
    )
      throw new Error('Unexpected OCR response');
    return {
      provider: data.provider,
      ...('confidence' in data
        ? { confidence: data.confidence as number }
        : {}),
      text: data.text,
      paragraphs: data.paragraphs,
      detectedLanguages: data.detectedLanguages,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
