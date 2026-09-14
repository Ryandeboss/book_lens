import type { PageFingerprint } from '../types/scanner';
import { ocrConfig } from '../config/ocr';
import { computed, ref } from 'vue';
import { scannerConfig as config } from '../config/scanner';
import type { OcrResult } from '../types/Page';
import { meetsOcrConfidence } from './ocrAcceptance';
import type { useScanStore } from '../stores/scan';

export interface OcrEngine {
  recognize(
    image: Blob,
    pageId: string,
    signal?: AbortSignal,
  ): Promise<OcrResult | null>;
  inspect?(
    image: Blob,
    pageId: string,
    signal?: AbortSignal,
  ): Promise<OcrResult | null>;
  refine?(result: OcrResult, pageId: string): Promise<OcrResult | null>;
  terminate(): Promise<void>;
}
export interface InspectedShot {
  id: string;
  result: OcrResult | null;
}
export function createOcrQueue(
  session: ReturnType<typeof useScanStore>,
  engine: OcrEngine,
  concurrency: number = ocrConfig.concurrency,
) {
  const pendingCount = ref(0),
    pendingBytes = ref(0),
    retryVersion = ref(0);
  const checking = ref(false);
  let inspection: AbortController | null = null;
  type Job = { id: string; blob: Blob; result?: OcrResult };
  let jobs: Job[] = [];
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
  async function run(job: Job, current: number) {
    try {
      if (session.pages.some((p) => p.id === job.id)) {
        session.setProcessing(job.id);
        if (!job.result && engine.inspect) {
          const raw = await engine.inspect(job.blob, job.id);
          if (
            current !== generation ||
            !session.pages.some((p) => p.id === job.id)
          )
            return;
          if (!raw) {
            session.failPage(job.id, 'OCR failed. Retry or rescan this page.');
            retainRetry(job.id, job.blob);
            return;
          }
          job.result = raw;
          session.recordOcr(job.id, raw);
        }
        const duplicate = session.pages.find((p) => p.id === job.id);
        const result = job.result
          ? duplicate?.duplicateOf && !duplicate.keepDuplicate
            ? { ...job.result, cleanupStatus: 'disabled' as const }
            : engine.refine
              ? await engine.refine(job.result, job.id)
              : job.result
          : await engine.recognize(job.blob, job.id);
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
  function submit(id: string, blob: Blob, result?: OcrResult) {
    session.setQueued(id);
    jobs.push({ id, blob, result });
    pendingCount.value++;
    pendingBytes.value += blob.size;
    void pump();
  }
  function enqueue(
    blob: Blob,
    fingerprint: number[],
    visualFingerprint?: PageFingerprint,
    inspected?: InspectedShot,
  ) {
    if (
      !hasCapacity.value ||
      pendingBytes.value + blob.size > config.maxPendingBytes
    )
      return null;
    if (inspected && !meetsOcrConfidence(inspected.result)) return null;
    const id = session.reservePage(
      fingerprint,
      visualFingerprint,
      inspected?.id,
    );
    if (inspected?.result) session.recordOcr(id, inspected.result);
    submit(id, blob, inspected?.result ?? undefined);
    return id;
  }
  async function inspect(blob: Blob): Promise<InspectedShot> {
    const id = crypto.randomUUID();
    if (disposed || checking.value) return { id, result: null };
    const controller = new AbortController();
    inspection = controller;
    checking.value = true;
    const current = generation;
    try {
      const result = await (engine.inspect ?? engine.recognize)(
        blob,
        id,
        controller.signal,
      );
      return {
        id,
        result:
          current === generation && !controller.signal.aborted ? result : null,
      };
    } catch {
      return { id, result: null };
    } finally {
      if (inspection === controller) {
        checking.value = false;
        inspection = null;
      }
    }
  }
  function cancelInspection() {
    inspection?.abort();
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
    cancelInspection();
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
    checking,
    inspect,
    cancelInspection,
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
