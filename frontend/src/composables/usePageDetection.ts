import { onUnmounted } from 'vue';
import type {
  Detection,
  RecentPage,
  Quad,
  ProcessedImage,
  VisionResponse,
} from '../types/scanner';
import { scannerConfig } from '../config/scanner';

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
    bitmap: ImageBitmap,
    corners: Quad | null = null,
    recent: RecentPage[] = [],
    textBody: Quad | null = null,
  ): Promise<Detection | ProcessedImage> {
    if (!worker) {
      try {
        worker = new Worker(
          new URL('../workers/imageProcessing.worker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch (cause) {
        bitmap.close();
        throw cause;
      }
      worker.onmessage = (event: MessageEvent<VisionResponse>) => {
        const job = pending.get(event.data.id);
        if (!job) return;
        clearTimeout(job.timer);
        pending.delete(event.data.id);
        if (event.data.error || !event.data.result)
          job.reject(new Error(event.data.error ?? 'Page processing failed'));
        else job.resolve(event.data.result);
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
        worker!.postMessage({ id, type, bitmap, corners, recent, textBody }, [
          bitmap,
        ]);
      } catch (cause) {
        clearTimeout(timer);
        pending.delete(id);
        bitmap.close();
        reject(cause);
      }
    });
  }
  onUnmounted(terminate);
  return {
    analyze: (bitmap: ImageBitmap) =>
      request('analyze', bitmap) as Promise<Detection>,
    process: (
      bitmap: ImageBitmap,
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
