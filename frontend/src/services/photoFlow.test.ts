import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { AutoScanMachine } from './autoScanMachine';
import { createOcrQueue } from './ocrQueue';
import { createProofreadingOcr } from './proofreadingOcr';
import { duplicateTextScore } from './textDuplicates';
import { useScanStore } from '../stores/scan';
import type { Detection } from '../types/scanner';
import type { CleanupResult } from './api';
const raw = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
beforeEach(() => setActivePinia(createPinia()));
it('requires two seconds after saving, then fresh focus/stability without a page-change lock', () => {
  const machine = new AutoScanMachine();
  const page: Detection = {
    source: 'guide',
    corners: null,
    captureCorners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    textPresent: false,
    aligned: true,
    alignment: 1,
    sharpness: 100,
    brightness: 180,
    signature: [1],
  };
  machine.savedShot(100, 'Shot saved');
  expect(machine.state).toBe('captured');
  machine.endFlash(601);
  expect(machine.state).toBe('cooldown');
  for (let t = 700; t < 2100; t += 100)
    expect(machine.sample(page, t)).toBe(false);
  expect(machine.sample({ ...page, sharpness: 0 }, 2100)).toBe(false);
  expect(machine.sample(page, 2200)).toBe(false);
  expect(machine.sample(page, 2540)).toBe(true);
  machine.savedShot(2600, 'Second shot');
  machine.finish();
  expect(machine.sample(page, 6000)).toBe(false);
});
it('excludes duplicates in original capture order even when OCR finishes backwards; restores and promotes safely', () => {
  const store = useScanStore();
  const first = store.reservePage([]),
    second = store.reservePage([]),
    third = store.reservePage([]);
  store.completePage(second, {
    rawText: raw,
    correctedText: 'Cleaned duplicate',
  });
  store.completePage(third, { rawText: 'A different page' });
  store.completePage(first, {
    rawText: raw,
    correctedText: 'Cleaned original',
  });
  expect(store.duplicatePages.map((p) => p.id)).toEqual([second]);
  expect(store.combinedText).toBe('Cleaned original\n\n\nA different page');
  expect(store.pages[1]?.capturePosition).toBe(2);
  store.keepDuplicate(second, true);
  expect(store.combinedText).toContain('Cleaned duplicate');
  store.keepDuplicate(second, false);
  store.removePage(first);
  expect(store.duplicatePages).toHaveLength(0);
  expect(store.pages[0]?.capturePosition).toBe(2);
  store.reservePage([]);
  expect(store.pages.at(-1)?.capturePosition).toBe(4);
});
it('ignores short/shared headings and tolerates a small OCR number difference', () => {
  expect(duplicateTextScore('Preface', 'Preface')).toBeNull();
  expect(
    duplicateTextScore(raw, raw.replace('word50', 'word500')),
  ).toBeGreaterThan(0.9);
  expect(duplicateTextScore(raw, raw.slice(0, 150))).toBeNull();
  expect(duplicateTextScore(raw, raw.replaceAll(' ', '\n'))).toBe(1);
  const words =
    'The garden contained many flowers and trees beside the winding path. '.repeat(
      25,
    );
  expect(
    duplicateTextScore(words, words.replace('flowers', 'flowcrs')),
  ).toBeGreaterThan(0.96);
});
it('captures while cleanup is pending, waits on Done, retains raw OCR and frees images', async () => {
  const store = useScanStore();
  let complete!: (result: CleanupResult) => void;
  const request = vi.fn(
    () =>
      new Promise<CleanupResult>((resolve) => {
        complete = resolve;
      }),
  );
  const engine = createProofreadingOcr(
    {
      recognize: vi.fn(async () => ({
        rawText: 'makes 70 sense',
        ocrProvider: 'google-document-ai' as const,
      })),
      terminate: vi.fn(async () => {}),
    },
    () => true,
    request,
  );
  const queue = createOcrQueue(store, engine);
  queue.enqueue(new Blob(['photo1']), []);
  await flushPromises();
  queue.enqueue(new Blob(['photo2']), []);
  expect(store.pages.map((p) => p.status)).toEqual(['processing', 'queued']);
  const done = vi.fn();
  void queue.waitUntilIdle().then(done);
  complete({ status: 'applied', correctedText: 'makes no sense' });
  await flushPromises();
  expect(store.pages[0]).toMatchObject({
    rawText: 'makes 70 sense',
    editedText: 'makes no sense',
    ocrProvider: 'google-document-ai',
  });
  expect(done).not.toHaveBeenCalled();
  complete({ status: 'unavailable' });
  await queue.waitUntilIdle();
  expect(queue.pendingBytes.value).toBe(0);
  expect(store.pages[1]?.editedText).toBe('makes 70 sense');
  await queue.dispose();
});
it('cleanup errors retain fallback OCR; disabling it makes no request', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Unavailable'));
  const base = {
    recognize: vi.fn(async () => ({
      rawText: 'hello',
      ocrProvider: 'tesseract' as const,
    })),
    terminate: vi.fn(async () => {}),
  };
  const engine = createProofreadingOcr(base, () => true, request);
  expect(await engine.recognize(new Blob(), 'page')).toMatchObject({
    rawText: 'hello',
    cleanupStatus: 'failed',
    ocrProvider: 'tesseract',
  });
  expect(await engine.recognize(new Blob(), 'next')).toMatchObject({
    cleanupStatus: 'unavailable',
  });
  expect(request).toHaveBeenCalledOnce();
  const disabled = createProofreadingOcr(base, () => false, request);
  expect(await disabled.recognize(new Blob(), 'off')).toMatchObject({
    cleanupStatus: 'disabled',
  });
  expect(request).toHaveBeenCalledOnce();
});
it('cancels pending cleanup and rejects late results after reset', async () => {
  let complete!: (result: CleanupResult) => void;
  let signal!: AbortSignal;
  const request = vi.fn((_text: string, _id: string, abort: AbortSignal) => {
    signal = abort;
    return new Promise<CleanupResult>((resolve) => {
      complete = resolve;
    });
  });
  const base = {
    recognize: vi.fn(async () => ({ rawText: 'original' })),
    terminate: vi.fn(async () => {}),
  };
  const engine = createProofreadingOcr(base, () => true, request);
  const result = engine.recognize(new Blob(), 'page');
  await flushPromises();
  await engine.terminate();
  expect(signal.aborted).toBe(true);
  complete({ status: 'applied', correctedText: 'late' });
  expect(await result).toBeNull();
});
