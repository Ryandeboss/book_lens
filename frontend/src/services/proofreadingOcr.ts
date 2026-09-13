import { proofreadPage, cleanupFailure } from './api';
import type { OcrEngine } from './ocrQueue';
import type { OcrResult } from '../types/Page';

// Cleanup stays in the background job so Done waits for both stages. Failure
// never turns a successfully transcribed page into an OCR error.
export function createProofreadingOcr(
  engine: OcrEngine,
  enabled: () => boolean,
  request = proofreadPage,
): OcrEngine {
  let generation = 0,
    unavailableUntil = 0;
  const controllers = new Set<AbortController>();
  async function refine(
    result: OcrResult,
    pageId: string,
    shouldClean = enabled(),
  ): Promise<OcrResult | null> {
    const current = generation;
    if (!shouldClean || !result.rawText.trim() || result.rawText.length > 20000)
      return { ...result, cleanupStatus: 'disabled' };
    if (Date.now() < unavailableUntil)
      return { ...result, cleanupStatus: 'unavailable' };
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const cleanup = await request(result.rawText, pageId, controller.signal);
      if (current !== generation) return null;
      if (cleanup.status === 'unavailable')
        unavailableUntil = Date.now() + 60000;
      return {
        ...result,
        cleanupStatus: cleanup.status,
        correctedText:
          cleanup.status === 'applied' ? cleanup.correctedText : undefined,
      };
    } catch (error) {
      if (current !== generation) return null;
      unavailableUntil = Date.now() + 60000;
      return {
        ...result,
        cleanupStatus: 'failed',
        cleanupError: cleanupFailure(error),
      };
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  return {
    inspect: (image, pageId, signal) => engine.recognize(image, pageId, signal),
    refine,
    async recognize(image, pageId) {
      const current = generation,
        shouldClean = enabled();
      const result = await engine.recognize(image, pageId);
      if (current !== generation || !result) return null;
      return refine(result, pageId, shouldClean);
    },
    async terminate() {
      generation++;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      await engine.terminate();
    },
  };
}
