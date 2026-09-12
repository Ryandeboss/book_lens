import { createHybridOcr } from '../services/hybridOcr';
import { createProofreadingOcr } from '../services/proofreadingOcr';
import { inject, onUnmounted, provide } from 'vue';
import type { InjectionKey } from 'vue';
import { useOcr } from './useOcr';
import { useScanStore } from '../stores/scan';
import { createOcrQueue } from '../services/ocrQueue';
import type { OcrQueue } from '../services/ocrQueue';

export const ocrQueueKey: InjectionKey<OcrQueue> = Symbol('ocr-queue');
export function provideOcrQueue() {
  const engine = useOcr();
  const session = useScanStore();
  const queue = createOcrQueue(
    session,
    createProofreadingOcr(
      createHybridOcr(engine),
      () => session.cleanupEnabled,
    ),
  );
  provide(ocrQueueKey, queue);
  onUnmounted(() => {
    void queue.dispose();
  });
  return queue;
}
export function useOcrQueue() {
  const queue = inject(ocrQueueKey);
  if (!queue) throw new Error('OCR queue must be provided by App');
  return queue;
}
