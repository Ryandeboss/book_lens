import { afterEach, expect, it, vi } from 'vitest';
import {
  ocrPage,
  proofreadPage,
  cleanupFailure,
  getProofreadStatus,
  normalizeApiUrl,
} from './api';
import { ocrConfig } from '../config/ocr';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each([
  [' https://book-lens.onrender.com/ ', 'https://book-lens.onrender.com/api'],
  ['https://book-lens.onrender.com/api/', 'https://book-lens.onrender.com/api'],
  ['/api/', '/api'],
])('normalizes API base %s', (input, expected) => {
  expect(normalizeApiUrl(input)).toBe(expected);
});
it.each(['status', 'cleanup'])(
  'distinguishes an HTML response from a network failure for %s',
  async (kind) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>Frontend</html>', { status: 200 }),
        ),
    );
    const call =
      kind === 'status'
        ? getProofreadStatus()
        : proofreadPage('raw', 'id', new AbortController().signal);
    await expect(call).rejects.toThrow(
      'did not return a valid cleanup response',
    );
  },
);
it('reports missing routes, malformed status and successful key detection', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"configured":"true"}'))
      .mockResolvedValueOnce(new Response('{"configured":true}')),
  );
  await expect(getProofreadStatus()).rejects.toThrow('endpoint was not found');
  await expect(getProofreadStatus()).rejects.toThrow('valid cleanup response');
  await expect(getProofreadStatus()).resolves.toBe(true);
});
it('distinguishes browser connection failures from timeout without exposing errors', () => {
  expect(cleanupFailure(new TypeError('private details'))).toContain(
    'allowed website origin',
  );
  expect(
    cleanupFailure(new DOMException('private details', 'AbortError')),
  ).toContain('timed out');
});
it('shows safe cleanup diagnostics instead of upstream text or credentials', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'CLEANUP_QUOTA',
        error: 'private upstream data',
      }),
    }),
  );
  try {
    await proofreadPage('raw', 'id', new AbortController().signal);
    throw new Error('Expected failure');
  } catch (error) {
    expect(cleanupFailure(error)).toContain('credits or quota');
    expect(cleanupFailure(error)).not.toContain('private upstream data');
  }
});
it('passes the Google OCR percentage through without confusing paragraph confidence', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: 'google-document-ai',
        text: 'Hello',
        confidence: 85,
        paragraphs: [{ text: 'Hello', confidence: 0.92 }],
        detectedLanguages: ['en'],
      }),
    }),
  );
  expect(await ocrPage(new Blob(), 'page')).toMatchObject({
    confidence: 85,
    paragraphs: [{ confidence: 0.92 }],
  });
});
it('uploads FormData with a browser-generated boundary and validates the compact result', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      provider: 'google-document-ai',
      text: 'Hello',
      paragraphs: [{ text: 'Hello', confidence: 0.9 }],
      detectedLanguages: ['en'],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  expect(
    (await ocrPage(new Blob(['image'], { type: 'image/jpeg' }), 'page-id'))
      .text,
  ).toBe('Hello');
  const options = fetchMock.mock.calls[0]![1];
  expect(options.headers).toBeUndefined();
  expect(options.body.get('pageId')).toBe('page-id');
  expect(options.body.get('image').type).toBe('image/jpeg');
});
it('rejects errors and malformed cloud responses', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: 'google-document-ai',
        text: 'x',
        paragraphs: [{ text: 3 }],
        detectedLanguages: [],
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  await expect(ocrPage(new Blob(), 'id')).rejects.toThrow('503');
  await expect(ocrPage(new Blob(), 'id')).rejects.toThrow('Unexpected');
});
it.each(['cancel', 'timeout'])('aborts uploads on %s', async (mode) => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  const pending = ocrPage(new Blob(), 'id', controller.signal);
  const rejection = expect(pending).rejects.toThrow('Aborted');
  if (mode === 'cancel') controller.abort();
  else await vi.advanceTimersByTimeAsync(ocrConfig.cloudTimeoutMs);
  await rejection;
  expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
});
