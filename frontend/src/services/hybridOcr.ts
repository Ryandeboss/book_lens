import { ocrPage } from './api';
import { ocrConfig } from '../config/ocr';
import type { OcrEngine } from './ocrQueue';
export function createHybridOcr(
  fallback: OcrEngine,
  cloud = ocrPage,
): OcrEngine {
  let generation = 0,
    unavailableUntil = 0;
  const requests = new Set<AbortController>();
  let fallbackTail: Promise<void> = Promise.resolve();
  async function recognize(image: Blob, pageId: string) {
    const current = generation;
    if (Date.now() >= unavailableUntil) {
      const controller = new AbortController();
      requests.add(controller);
      try {
        const result = await cloud(image, pageId, controller.signal);
        if (current !== generation) return null;
        return {
          rawText: result.text,
          ocrProvider: result.provider,
          paragraphs: result.paragraphs,
          detectedLanguages: result.detectedLanguages,
        };
      } catch {
        if (current !== generation || controller.signal.aborted) return null;
        unavailableUntil = Date.now() + ocrConfig.cloudCooldownMs;
      } finally {
        requests.delete(controller);
      }
    }
    // Even with two cloud jobs, only one job can use the browser OCR worker.
    const previous = fallbackTail;
    let release!: () => void;
    fallbackTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (current !== generation) return null;
      const result = await fallback.recognize(image, pageId);
      return current === generation && result
        ? { ...result, ocrProvider: 'tesseract' as const }
        : null;
    } finally {
      release();
    }
  }
  async function terminate() {
    generation++;
    requests.forEach((request) => request.abort());
    requests.clear();
    fallbackTail = Promise.resolve();
    await fallback.terminate();
  }
  return { recognize, terminate };
}
