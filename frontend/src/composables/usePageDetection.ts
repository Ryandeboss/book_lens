import { onUnmounted } from 'vue';
import type {
  Detection,
  RecentPage,
  Quad,
  ProcessedImage,
  VisionResponse,
  VisionFrame,
} from '../types/scanner';
import { scannerConfig } from '../config/scanner';
import { encodePixels } from '../services/stillCapture';

export function usePageDetection() {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: Detection | ProcessedImage) => void;
      reject: (cause: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function terminate() {
    worker?.terminate();
    worker = null;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error('Page analysis stopped'));
    }
    pending.clear();
  }
  async function request(
    type: 'analyze' | 'process',
    bitmap: VisionFrame,
    corners: Quad | null = null,
    recent: RecentPage[] = [],
    textBody: Quad | null = null,
    still = false,
  ): Promise<Detection | ProcessedImage> {
    if (!worker) {
      try {
        worker = new Worker(
          new URL('../workers/imageProcessing.worker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch (cause) {
        if ('close' in bitmap) bitmap.close();
        throw cause;
      }
      worker.onmessage = (event: MessageEvent<VisionResponse>) => {
        const job = pending.get(event.data.id);
        if (!job) return;
        // Keep fallback encoding cancellable and covered by the same watchdog.
        const finish = (
          result?: Detection | ProcessedImage,
          cause?: unknown,
        ) => {
          if (pending.get(event.data.id) !== job) return;
          clearTimeout(job.timer);
          pending.delete(event.data.id);
          if (cause || !result)
            job.reject(
              cause instanceof Error
                ? cause
                : new Error('Page processing failed'),
            );
          else job.resolve(result);
        };
        if (event.data.error || !event.data.result)
          finish(
            undefined,
            new Error(event.data.error ?? 'Page processing failed'),
          );
        else if ('pixels' in event.data.result) {
          const { pixels, ...result } = event.data.result;
          void encodePixels(pixels).then(
            (blob) => finish({ ...result, blob }),
            (cause) => finish(undefined, cause),
          );
        } else finish(event.data.result);
      };
      worker.onerror = () => terminate();
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => terminate(),
        scannerConfig.workerTimeoutMs,
      );
      pending.set(id, { resolve, reject, timer });
      try {
        worker!.postMessage(
          { id, type, bitmap, corners, recent, textBody, still },
          ['data' in bitmap ? bitmap.data.buffer : bitmap],
        );
      } catch (cause) {
        clearTimeout(timer);
        pending.delete(id);
        if ('close' in bitmap) bitmap.close();
        reject(cause);
      }
    });
  }
  onUnmounted(terminate);
  return {
    analyze: (bitmap: VisionFrame, still = false) =>
      request('analyze', bitmap, null, [], null, still) as Promise<Detection>,
    process: (
      bitmap: VisionFrame,
      corners: Quad | null,
      recent: RecentPage[] = [],
      textBody: Quad | null = null,
    ) =>
      request(
        'process',
        bitmap,
        corners,
        recent,
        textBody,
      ) as Promise<ProcessedImage>,
    terminate,
  };
}
