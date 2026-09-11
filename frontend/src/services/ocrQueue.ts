import { ocrConfig } from '../config/ocr';
import { computed, ref } from 'vue';
import { scannerConfig as config } from '../config/scanner';
import type { OcrResult } from '../types/Page';
import type { useScanStore } from '../stores/scan';

export interface OcrEngine {
  recognize(image: Blob, pageId: string): Promise<OcrResult | null>;
  terminate(): Promise<void>;
}
export function createOcrQueue(
  session: ReturnType<typeof useScanStore>,
  engine: OcrEngine,
  concurrency: number = ocrConfig.concurrency,
) {
  const pendingCount = ref(0),
    pendingBytes = ref(0),
    retryVersion = ref(0);
  let jobs: { id: string; blob: Blob }[] = [];
  const retries = new Map<string, Blob>();
  const maxActive = Math.max(1, Math.min(2, Math.floor(concurrency) || 1));
  let active = 0,
    generation = 0,
    disposed = false;
  const idleWaiters: (() => void)[] = [];
  const hasCapacity = computed(
    () =>
      !disposed &&
      pendingCount.value < config.maxPendingImages &&
      pendingBytes.value < config.maxPendingBytes,
  );
  function retainRetry(id: string, blob: Blob) {
    retries.set(id, blob);
    while (
      retries.size > config.maxRetryImages ||
      [...retries.values()].reduce((n, b) => n + b.size, 0) >
        config.maxRetryBytes
    )
      retries.delete(retries.keys().next().value!);
    retryVersion.value++;
  }
  function pump() {
    if (disposed) return;
    while (jobs.length && active < maxActive) {
      const job = jobs.shift()!;
      active++;
      void run(job, generation);
    }
  }
  async function run(job: { id: string; blob: Blob }, current: number) {
    try {
      if (session.pages.some((p) => p.id === job.id)) {
        session.setProcessing(job.id);
        const result = await engine.recognize(job.blob, job.id);
        if (
          current === generation &&
          session.pages.some((p) => p.id === job.id)
        ) {
          if (result) session.completePage(job.id, result);
          else {
            session.failPage(job.id, 'OCR failed. Retry or rescan this page.');
            retainRetry(job.id, job.blob);
          }
        }
      }
    } catch {
      if (
        current === generation &&
        session.pages.some((p) => p.id === job.id)
      ) {
        session.failPage(job.id, 'OCR failed. Retry or rescan this page.');
        retainRetry(job.id, job.blob);
      }
    } finally {
      if (current === generation) {
        active--;
        pendingCount.value--;
        pendingBytes.value -= job.blob.size;
        pump();
        if (!pendingCount.value)
          idleWaiters.splice(0).forEach((resolve) => resolve());
      }
    }
  }
  function submit(id: string, blob: Blob) {
    session.setQueued(id);
    jobs.push({ id, blob });
    pendingCount.value++;
    pendingBytes.value += blob.size;
    void pump();
  }
  function enqueue(blob: Blob, fingerprint: number[]) {
    if (
      !hasCapacity.value ||
      pendingBytes.value + blob.size > config.maxPendingBytes
    )
      return null;
    const id = session.reservePage(fingerprint);
    submit(id, blob);
    return id;
  }
  function canRetry(id: string) {
    void retryVersion.value;
    return retries.has(id);
  }
  function retry(id: string) {
    const blob = retries.get(id);
    if (
      !blob ||
      !hasCapacity.value ||
      pendingBytes.value + blob.size > config.maxPendingBytes
    )
      return false;
    retries.delete(id);
    retryVersion.value++;
    submit(id, blob);
    return true;
  }
  function forget(id: string) {
    retries.delete(id);
    retryVersion.value++;
  }
  function waitUntilIdle(): Promise<void> {
    return pendingCount.value === 0
      ? Promise.resolve()
      : new Promise((resolve) => idleWaiters.push(resolve));
  }
  async function reset() {
    generation++;
    jobs = [];
    retries.clear();
    retryVersion.value++;
    active = 0;
    pendingCount.value = 0;
    pendingBytes.value = 0;
    idleWaiters.splice(0).forEach((resolve) => resolve());
    await engine.terminate();
  }
  async function dispose() {
    disposed = true;
    await reset();
  }
  return {
    pendingCount,
    pendingBytes,
    hasCapacity,
    retryVersion,
    enqueue,
    canRetry,
    retry,
    forget,
    waitUntilIdle,
    reset,
    dispose,
    releaseWorker: () => engine.terminate(),
  };
}
export type OcrQueue = ReturnType<typeof createOcrQueue>;
