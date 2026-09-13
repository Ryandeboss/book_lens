import { onUnmounted, ref } from 'vue';
import type { Worker, LoggerMessage } from 'tesseract.js';
import type { OcrResult } from '../types/Page';

const language = 'eng';

export function useOcr() {
  const isInitializing = ref(false);
  const isProcessing = ref(false);
  const progress = ref<number | null>(null);
  const status = ref('Ready to read a page');
  const error = ref<string | null>(null);
  let worker: Worker | null = null;
  let initialization: Promise<Worker> | null = null;
  let generation = 0;
  let disposed = false;
  let cancelJob: (() => void) | null = null;
  let failJob: (() => void) | null = null;

  function report(message: LoggerMessage, current: number) {
    if (current !== generation || disposed) return;
    const labels: Record<string, string> = {
      'loading tesseract core': 'Loading OCR engine',
      'initializing tesseract': 'Initializing OCR engine',
      'loading language traineddata': 'Loading English language data',
      'initializing api': 'Preparing English recognition',
      'recognizing text': 'Recognizing text',
    };
    status.value = labels[message.status] ?? 'Preparing OCR';
    progress.value = Number.isFinite(message.progress)
      ? Math.round(Math.min(1, Math.max(0, message.progress)) * 100)
      : null;
  }

  function initialize(): Promise<Worker> {
    if (disposed) return Promise.reject(new Error('OCR has been closed'));
    if (worker) return Promise.resolve(worker);
    if (initialization) return initialization;
    const current = generation;
    isInitializing.value = true;
    error.value = null;
    progress.value = null;
    status.value = 'Loading OCR engine';
    const pending = (async () => {
      // Import and language downloads happen only on the first Use Page action.
      const { createWorker } = await import('tesseract.js');
      if (current !== generation || disposed) throw new Error('OCR cancelled');
      const created = await createWorker(language, 1, {
        logger: (message) => report(message, current),
        errorHandler: () => {
          if (current === generation) failJob?.();
        },
      });
      if (current !== generation || disposed) {
        await created.terminate();
        throw new Error('OCR cancelled');
      }
      worker = created;
      return created;
    })();
    initialization = pending;
    // Attach both handlers so cleanup never creates an unhandled rejection.
    void pending.then(
      () => {
        if (current === generation) {
          isInitializing.value = false;
          initialization = null;
        }
      },
      () => {
        if (current === generation) {
          isInitializing.value = false;
          initialization = null;
        }
      },
    );
    return pending;
  }

  async function terminate() {
    generation++;
    cancelJob?.();
    cancelJob = null;
    failJob = null;
    const active = worker;
    worker = null;
    initialization = null;
    isInitializing.value = false;
    isProcessing.value = false;
    progress.value = null;
    status.value = 'OCR stopped';
    // A worker still initializing is released by initialize() when it becomes available.
    if (active) await active.terminate().catch(() => {});
  }

  async function recognize(
    image: Blob,
    _pageId?: string,
    signal?: AbortSignal,
  ): Promise<OcrResult | null> {
    if (disposed || isProcessing.value || signal?.aborted) return null;
    const current = generation;
    isProcessing.value = true;
    error.value = null;
    progress.value = null;
    status.value = 'Preparing OCR';
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancelJob = () => reject(new Error('OCR cancelled'));
      failJob = () => reject(new Error('OCR worker failed'));
      // A failed resource download or worker crash must not leave the UI stuck forever.
      timeout = setTimeout(() => reject(new Error('OCR timed out')), 180000);
    });
    const abort = () => cancelJob?.();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const operation = (async () => {
        const active = await initialize();
        if (current !== generation) throw new Error('OCR cancelled');
        progress.value = null;
        status.value = 'Recognizing text';
        const { data } = await active.recognize(image, {}, { text: true });
        return {
          rawText: data.text,
          confidence: Number.isFinite(data.confidence)
            ? data.confidence
            : undefined,
        };
      })();
      const result = await Promise.race([operation, interrupted]);
      if (current !== generation || disposed) return null;
      status.value = 'Page read';
      return result;
    } catch {
      if (current === generation && !disposed) {
        await terminate();
        error.value =
          "BookLens couldn't read this page. Check your connection for OCR resources, then try again or rescan.";
        status.value = 'Could not read page';
      }
      return null;
    } finally {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
      if (current === generation) {
        isProcessing.value = false;
        cancelJob = null;
        failJob = null;
      }
    }
  }
  onUnmounted(() => {
    disposed = true;
    void terminate();
  });
  return {
    isInitializing,
    isProcessing,
    progress,
    status,
    error,
    initialize,
    recognize,
    terminate,
  };
}
