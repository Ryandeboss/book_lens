import cvModule from '@techstark/opencv-js';
import type * as CV from '@techstark/opencv-js';
import { analyzePage, preparePage } from '../services/imageProcessing';
import type { VisionRequest, VisionResponse } from '../types/scanner';
import { FrameMotion } from '../services/frameMotion';
const motion = new FrameMotion();

// This distribution packages the upstream OpenCV build and types, not a scanner wrapper.
const ready = Promise.resolve(cvModule).then(async (module) => {
  if (module.Mat) return module;
  await new Promise<void>((resolve) => {
    module.onRuntimeInitialized = resolve;
  });
  return module;
});
// Report failed initialization to the requesting UI rather than leaving an
// unhandled rejection and a permanently rejected worker behind on Resume.
void ready.catch(() => {});
self.onmessage = async (event: MessageEvent<VisionRequest>) => {
  const { id, bitmap } = event.data;
  let errorStage: NonNullable<VisionResponse['errorStage']> = 'initialization';
  try {
    const cv = (await ready) as typeof CV;
    errorStage = event.data.type === 'analyze' ? 'analysis' : 'processing';
    const result =
      event.data.type === 'analyze'
        ? analyzePage(cv, bitmap, event.data.still ? undefined : motion)
        : await preparePage(
            cv,
            bitmap,
            event.data.corners,
            event.data.recent,
            event.data.textBody,
          );
    self.postMessage({ id, result } satisfies VisionResponse, {
      transfer:
        'pixels' in result ? [result.pixels.data.buffer as ArrayBuffer] : [],
    });
  } catch {
    self.postMessage({
      id,
      errorStage,
      error:
        'Page processing could not finish. Try again with the page in the guide.',
    } satisfies VisionResponse);
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
};
