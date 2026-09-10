import cvModule from '@techstark/opencv-js';
import type * as CV from '@techstark/opencv-js';
import { analyzePage, preparePage } from '../services/imageProcessing';
import type { VisionRequest, VisionResponse } from '../types/scanner';

// This distribution packages the upstream OpenCV build and types, not a scanner wrapper.
const ready = Promise.resolve(cvModule).then(async (module) => {
  if (module.Mat) return module;
  await new Promise<void>((resolve) => {
    module.onRuntimeInitialized = resolve;
  });
  return module;
});
self.onmessage = async (event: MessageEvent<VisionRequest>) => {
  const { id, bitmap } = event.data;
  try {
    const cv = (await ready) as typeof CV;
    const result =
      event.data.type === 'analyze'
        ? analyzePage(cv, bitmap)
        : await preparePage(cv, bitmap, event.data.corners);
    self.postMessage({ id, result } satisfies VisionResponse);
  } catch {
    self.postMessage({
      id,
      error:
        'Page processing could not finish. Try again with the page in the guide.',
    } satisfies VisionResponse);
  } finally {
    bitmap.close();
  }
};
