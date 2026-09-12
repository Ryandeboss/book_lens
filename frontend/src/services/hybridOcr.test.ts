import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { createHybridOcr } from './hybridOcr';
import { createOcrQueue } from './ocrQueue';
import { useScanStore } from '../stores/scan';
import type { CloudOcrResult, OcrResult } from '../types/Page';
const result = (text = 'Google text'): CloudOcrResult => ({
  provider: 'google-document-ai',
  text,
  paragraphs: [{ text }],
  detectedLanguages: ['en'],
});
function setup(concurrency = 1) {
  const cloud = vi
    .fn<
      (image: Blob, id: string, signal?: AbortSignal) => Promise<CloudOcrResult>
    >()
    .mockResolvedValue(result());
  const fallback = {
    recognize: vi
      .fn<(image: Blob) => Promise<OcrResult | null>>()
      .mockResolvedValue({ rawText: 'Fallback text', confidence: 80 }),
    terminate: vi.fn(async () => {}),
  };
  const engine = createHybridOcr(fallback, cloud),
    store = useScanStore(),
    queue = createOcrQueue(store, engine, concurrency);
  return { cloud, fallback, engine, store, queue };
}
beforeEach(() => setActivePinia(createPinia()));
it('records Google structure and provider on the captured page without running Tesseract', async () => {
  const { queue, store, cloud, fallback } = setup();
  const image = new Blob(['page']);
  const id = queue.enqueue(image, [])!;
  await queue.waitUntilIdle();
  expect(cloud).toHaveBeenCalledWith(image, id, expect.any(AbortSignal));
  expect(store.pages[0]).toMatchObject({
    id,
    pageNumber: 1,
    rawText: 'Google text',
    editedText: 'Google text',
    ocrProvider: 'google-document-ai',
    paragraphs: [{ text: 'Google text' }],
  });
  expect(fallback.recognize).not.toHaveBeenCalled();
  expect(queue.pendingBytes.value).toBe(0);
  store.updatePage(id, 'Edited');
  expect(store.pages[0]?.rawText).toBe('Google text');
});
it('falls back once and skips cloud during cooldown without reserving duplicate pages', async () => {
  const { queue, store, cloud, fallback } = setup();
  cloud.mockRejectedValue(new Error('503'));
  queue.enqueue(new Blob(['one']), []);
  queue.enqueue(new Blob(['two']), []);
  await queue.waitUntilIdle();
  expect(
    store.pages.map((p) => [p.pageNumber, p.ocrProvider, p.status]),
  ).toEqual([
    [1, 'tesseract', 'ready'],
    [2, 'tesseract', 'ready'],
  ]);
  expect(cloud).toHaveBeenCalledOnce();
  expect(fallback.recognize).toHaveBeenCalledTimes(2);
  expect(queue.pendingBytes.value).toBe(0);
});
it('both engines failing retains only the failed image for Retry and preserves good pages', async () => {
  const { queue, store, cloud, fallback } = setup();
  cloud.mockRejectedValueOnce(new Error('network'));
  fallback.recognize.mockResolvedValueOnce(null);
  const id = queue.enqueue(new Blob(['bad']), [])!;
  await queue.waitUntilIdle();
  queue.enqueue(new Blob(['good']), []);
  await queue.waitUntilIdle();
  expect(store.pages.map((p) => p.status)).toEqual(['error', 'ready']);
  expect(queue.canRetry(id)).toBe(true);
  expect(queue.retry(id)).toBe(true);
  await queue.waitUntilIdle();
  expect(store.pages[0]?.pageNumber).toBe(1);
  expect(queue.canRetry(id)).toBe(false);
});
it('two cloud jobs finishing out of order still preserve capture order and capacity', async () => {
  const { queue, store, cloud } = setup(2);
  const finish: ((r: CloudOcrResult) => void)[] = [];
  cloud.mockImplementation(() => new Promise((done) => finish.push(done)));
  queue.enqueue(new Blob(['1']), []);
  queue.enqueue(new Blob(['2']), []);
  queue.enqueue(new Blob(['3']), []);
  expect(cloud).toHaveBeenCalledTimes(2);
  expect(queue.hasCapacity.value).toBe(true); // Photo backlog can grow while two jobs run.
  finish[1]!(result('second'));
  await flushPromises();
  expect(cloud).toHaveBeenCalledTimes(3);
  finish[2]!(result('third'));
  finish[0]!(result('first'));
  await queue.waitUntilIdle();
  expect(store.pages.map((p) => p.rawText)).toEqual([
    'first',
    'second',
    'third',
  ]);
});
it('serializes Tesseract fallback even when two cloud requests fail together', async () => {
  const { queue, cloud, fallback } = setup(2);
  cloud.mockRejectedValue(new Error('offline'));
  const finish: ((r: OcrResult) => void)[] = [];
  fallback.recognize.mockImplementation(
    () => new Promise((done) => finish.push(done)),
  );
  queue.enqueue(new Blob(['1']), []);
  queue.enqueue(new Blob(['2']), []);
  await flushPromises();
  expect(fallback.recognize).toHaveBeenCalledOnce();
  finish[0]!({ rawText: 'one' });
  await flushPromises();
  expect(fallback.recognize).toHaveBeenCalledTimes(2);
  finish[1]!({ rawText: 'two' });
  await queue.waitUntilIdle();
});
it('reset aborts cloud and ignores late results without invoking fallback', async () => {
  const { queue, cloud, fallback, store } = setup();
  let finish!: (r: CloudOcrResult) => void;
  cloud.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  queue.enqueue(new Blob(['1']), []);
  const signal = cloud.mock.calls[0]![2]!;
  await queue.reset();
  store.clearSession();
  expect(signal.aborted).toBe(true);
  finish(result('late'));
  await flushPromises();
  expect(store.pages).toEqual([]);
  expect(fallback.recognize).not.toHaveBeenCalled();
  expect(queue.pendingBytes.value).toBe(0);
});
