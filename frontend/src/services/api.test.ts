import { afterEach, expect, it, vi } from 'vitest';
import { ocrPage } from './api';
import { ocrConfig } from '../config/ocr';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
