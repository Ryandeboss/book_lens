import type { CloudOcrResult } from '../types/Page';
import { ocrConfig } from '../config/ocr';
import type { HealthResponse } from '../types/api';

const apiUrl = (
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
).replace(/\/$/, '');

export type CleanupResult =
  { status: 'applied'; correctedText: string } | { status: 'unavailable' };
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
  if (!response.ok) throw new Error('Text cleanup unavailable');
  const data: unknown = await response.json();
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
  throw new Error('Unexpected text cleanup response');
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
