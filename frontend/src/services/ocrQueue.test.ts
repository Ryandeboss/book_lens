import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { useScanStore } from '../stores/scan';
import { createOcrQueue } from './ocrQueue';
import { scannerConfig as config } from '../config/scanner';
import type { OcrResult } from '../types/Page';
beforeEach(() => setActivePinia(createPinia()));
function setup() {
  const engine = {
    recognize: vi.fn<(image: Blob) => Promise<OcrResult | null>>(),
    terminate: vi.fn(async () => {}),
  };
  const store = useScanStore(),
    queue = createOcrQueue(store, engine);
  return { engine, store, queue };
}
describe('bounded background OCR queue', () => {
  it('publishes raw background OCR before cleanup, skips duplicate cleanup and keeps low confidence for review', async () => {
    const rawText = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    let finish!: (r: OcrResult) => void;
    const engine = {
      inspect: vi.fn(async () => ({ rawText, confidence: 72 })),
      refine: vi.fn(
        () =>
          new Promise<OcrResult>((resolve) => {
            finish = resolve;
          }),
      ),
      recognize: vi.fn(),
      terminate: vi.fn(async () => {}),
    };
    const store = useScanStore(),
      queue = createOcrQueue(store, engine);
    const first = queue.enqueue(new Blob(['one']), [])!;
    queue.enqueue(new Blob(['two']), []);
    await flushPromises();
    expect(store.pages[0]).toMatchObject({
      id: first,
      rawText,
      confidence: 72,
      status: 'processing',
    });
    finish({
      rawText,
      confidence: 72,
      correctedText: rawText,
      cleanupStatus: 'applied',
    });
    await queue.waitUntilIdle();
    expect(store.pages[1]?.duplicateOf).toBe(first);
    expect(engine.inspect).toHaveBeenCalledTimes(2);
    expect(engine.refine).toHaveBeenCalledOnce();
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(store.pages.map((p) => p.status)).toEqual(['ready', 'ready']);
    expect(queue.pendingBytes.value).toBe(0);
  });
  it('assigns capture order immediately, processes sequentially, and Done waits for every job', async () => {
    const { engine, store, queue } = setup();
    const resolve: ((r: OcrResult | null) => void)[] = [];
    engine.recognize.mockImplementation(
      () => new Promise((done) => resolve.push(done)),
    );
    const first = queue.enqueue(new Blob(['one']), [1])!,
      second = queue.enqueue(new Blob(['two']), [2])!;
    expect(store.pages.map((p) => [p.id, p.pageNumber, p.status])).toEqual([
      [first, 1, 'processing'],
      [second, 2, 'queued'],
    ]);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    const done = vi.fn();
    void queue.waitUntilIdle().then(done);
    resolve[0]!({ rawText: 'raw first', confidence: 92 });
    await flushPromises();
    expect(done).not.toHaveBeenCalled();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    resolve[1]!({ rawText: 'raw second' });
    await flushPromises();
    expect(done).toHaveBeenCalledOnce();
    expect(store.pages.map((p) => p.rawText)).toEqual([
      'raw first',
      'raw second',
    ]);
    expect(queue.pendingCount.value).toBe(0);
    expect(queue.pendingBytes.value).toBe(0);
    store.updatePage(first, 'edited');
    expect(store.pages[0]?.rawText).toBe('raw first');
  });
  it('applies count and byte backpressure before reserving a page', () => {
    const { engine, store, queue } = setup();
    engine.recognize.mockReturnValue(new Promise(() => {}));
    for (let i = 0; i < config.maxPendingImages; i++)
      expect(queue.enqueue(new Blob(['image']), [i])).toBeTruthy();
    expect(queue.hasCapacity.value).toBe(false);
    expect(queue.enqueue(new Blob(), [])).toBeNull();
    expect(store.pages.length).toBe(config.maxPendingImages);
    const other = setup();
    expect(
      other.queue.enqueue(
        new Blob([new Uint8Array(config.maxPendingBytes + 1)]),
        [],
      ),
    ).toBeNull();
  });
  it('retains bounded failed images, preserves good pages, and retries in place', async () => {
    const { engine, store, queue } = setup();
    engine.recognize.mockResolvedValue(null);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(queue.enqueue(new Blob(['failed']), [i])!);
      await queue.waitUntilIdle();
    }
    expect(queue.canRetry(ids[0]!)).toBe(false);
    expect(queue.canRetry(ids[3]!)).toBe(true);
    engine.recognize.mockResolvedValue({ rawText: 'recovered' });
    expect(queue.retry(ids[3]!)).toBe(true);
    await queue.waitUntilIdle();
    expect(store.pages[3]?.pageNumber).toBe(4);
    expect(store.pages[3]?.rawText).toBe('recovered');
    expect(store.pages[0]?.status).toBe('error');
    expect(queue.canRetry(ids[3]!)).toBe(false);
  });
  it('ignores deleted pages and stale results after session reset, and releases worker', async () => {
    const { engine, store, queue } = setup();
    let complete!: (r: OcrResult) => void;
    engine.recognize.mockReturnValue(
      new Promise((done) => {
        complete = done;
      }),
    );
    const id = queue.enqueue(new Blob(['a']), [])!;
    store.removePage(id);
    complete({ rawText: 'late' });
    await queue.waitUntilIdle();
    expect(store.pages).toEqual([]);
    engine.recognize.mockReturnValue(
      new Promise((done) => {
        complete = done;
      }),
    );
    queue.enqueue(new Blob(['b']), []);
    await queue.reset();
    store.clearSession();
    complete({ rawText: 'stale' });
    await flushPromises();
    expect(store.pages).toEqual([]);
    expect(queue.pendingCount.value).toBe(0);
    expect(engine.terminate).toHaveBeenCalledOnce();
    await queue.dispose();
    expect(queue.enqueue(new Blob(), [])).toBeNull();
  });
  it('continues after thrown OCR errors', async () => {
    const { engine, store, queue } = setup();
    engine.recognize
      .mockRejectedValueOnce(new Error('worker'))
      .mockResolvedValue({ rawText: 'second' });
    queue.enqueue(new Blob(['a']), []);
    queue.enqueue(new Blob(['b']), []);
    await queue.waitUntilIdle();
    expect(store.pages.map((p) => p.status)).toEqual(['error', 'ready']);
  });
});
