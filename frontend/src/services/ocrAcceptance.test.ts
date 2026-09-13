import { expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { meetsOcrConfidence } from './ocrAcceptance';
import { createOcrQueue } from './ocrQueue';
import { createProofreadingOcr } from './proofreadingOcr';
import { useScanStore } from '../stores/scan';
import type { OcrResult } from '../types/Page';
it.each([0, 1, 79, 79.9999, undefined, NaN, Infinity, 101])(
  'rejects invalid/below-80 scores (%s)',
  (confidence) => {
    expect(meetsOcrConfidence({ rawText: 'page', confidence })).toBe(false);
  },
);
it.each([80, 80.01, 99, 100])(
  'accepts unrounded scores at or above 80 (%s)',
  (confidence) => {
    expect(meetsOcrConfidence({ rawText: 'page', confidence })).toBe(true);
  },
);
it('rejects blank OCR even with high confidence', () => {
  expect(meetsOcrConfidence({ rawText: ' \n', confidence: 99 })).toBe(false);
  expect(meetsOcrConfidence(null)).toBe(false);
});
it('inspects before reserving a page, reuses accepted OCR and only then starts cleanup', async () => {
  setActivePinia(createPinia());
  const store = useScanStore();
  const primary = {
    recognize: vi.fn(async () => ({ rawText: 'original', confidence: 80 })),
    terminate: vi.fn(async () => {}),
  };
  const cleanup = vi.fn(async () => ({
    status: 'applied' as const,
    correctedText: 'corrected',
  }));
  const queue = createOcrQueue(
    store,
    createProofreadingOcr(primary, () => true, cleanup),
  );
  const blob = new Blob(['photo']);
  const checked = await queue.inspect(blob);
  expect(store.pages).toHaveLength(0);
  expect(cleanup).not.toHaveBeenCalled();
  expect(queue.enqueue(blob, [], undefined, checked)).toBe(checked.id);
  await queue.waitUntilIdle();
  expect(primary.recognize).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(store.pages[0]).toMatchObject({
    id: checked.id,
    pageNumber: 1,
    capturePosition: 1,
    rawText: 'original',
    editedText: 'corrected',
    confidence: 80,
  });
  expect(queue.pendingBytes.value).toBe(0);
  await queue.dispose();
});
it('does not reserve a number or run cleanup for a rejected candidate', async () => {
  setActivePinia(createPinia());
  const store = useScanStore();
  const primary = {
    recognize: vi.fn(async () => ({ rawText: 'bad', confidence: 79.99 })),
    terminate: vi.fn(async () => {}),
  };
  const cleanup = vi.fn();
  const queue = createOcrQueue(
    store,
    createProofreadingOcr(primary, () => true, cleanup),
  );
  const checked = await queue.inspect(new Blob());
  expect(queue.enqueue(new Blob(), [], undefined, checked)).toBeNull();
  expect(store.currentPageNumber).toBe(1);
  expect(store.pages).toHaveLength(0);
  expect(cleanup).not.toHaveBeenCalled();
  expect(queue.pendingBytes.value).toBe(0);
  await queue.dispose();
});
it('cancels inspection without accepting late results', async () => {
  setActivePinia(createPinia());
  let complete!: (r: OcrResult) => void;
  let signal!: AbortSignal;
  const primary = {
    recognize: vi.fn((_image: Blob, _id: string, abort?: AbortSignal) => {
      signal = abort!;
      return new Promise<OcrResult>((resolve) => {
        complete = resolve;
      });
    }),
    terminate: vi.fn(async () => {}),
  };
  const store = useScanStore(),
    queue = createOcrQueue(store, primary);
  const pending = queue.inspect(new Blob());
  expect(queue.checking.value).toBe(true);
  queue.cancelInspection();
  expect(signal.aborted).toBe(true);
  complete({ rawText: 'late', confidence: 99 });
  expect((await pending).result).toBeNull();
  expect(store.pages).toHaveLength(0);
  expect(queue.checking.value).toBe(false);
  await queue.dispose();
});
