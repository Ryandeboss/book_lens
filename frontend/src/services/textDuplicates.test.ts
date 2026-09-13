import { expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { duplicateTextScore } from './textDuplicates';
import { useScanStore } from '../stores/scan';
import { createOcrQueue } from './ocrQueue';
const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
it('matches the later repeated sequence with typos, insertions and missing words', () => {
  const changed = [...words];
  changed[25] = 'misread';
  changed[75] = 'typo';
  changed.splice(50, 1);
  changed.splice(60, 0, 'extra');
  expect(
    duplicateTextScore(words.join(' '), changed.join(' ')),
  ).toBeGreaterThanOrEqual(0.9);
  expect(
    duplicateTextScore(
      words.slice(0, 25).join(' '),
      words.slice(0, 25).join('\n'),
    ),
  ).toBe(1);
});
it('does not match the same words in a different order or a short shared extract', () => {
  expect(
    duplicateTextScore(words.join(' '), [...words].reverse().join(' ')),
  ).toBeNull();
  expect(
    duplicateTextScore(
      words.join(' '),
      [...words.slice(50), ...words.slice(0, 50)].join(' '),
    ),
  ).toBeNull();
  expect(
    duplicateTextScore(words.join(' '), words.slice(0, 40).join(' ')),
  ).toBeNull();
  expect(duplicateTextScore('Contents', 'Contents')).toBeNull();
});
it('sets duplicates aside before cleanup finishes and avoids cleaning the excluded copy', async () => {
  setActivePinia(createPinia());
  const session = useScanStore();
  let finish!: (r: { rawText: string; confidence: number }) => void;
  const engine = {
    recognize: vi.fn(),
    refine: vi.fn(
      () =>
        new Promise<{ rawText: string; confidence: number }>((resolve) => {
          finish = resolve;
        }),
    ),
    terminate: vi.fn(async () => {}),
  };
  const queue = createOcrQueue(session, engine);
  const result = { rawText: words.join(' '), confidence: 90 };
  const first = queue.enqueue(new Blob(), [], undefined, {
    id: 'first',
    result,
  });
  const later = queue.enqueue(new Blob(), [], undefined, {
    id: 'later',
    result: { ...result, rawText: result.rawText.replace('word30', 'typo') },
  });
  expect(first).toBe('first');
  expect(later).toBe('later');
  expect(session.duplicatePages.map((p) => p.id)).toEqual(['later']);
  expect(session.combinedText).toBe(result.rawText);
  finish(result);
  await queue.waitUntilIdle();
  expect(engine.refine).toHaveBeenCalledOnce();
  session.keepDuplicate('later', true);
  expect(session.combinedText).toContain('typo');
  expect(session.pages[1]?.capturePosition).toBe(2);
  await queue.dispose();
});
