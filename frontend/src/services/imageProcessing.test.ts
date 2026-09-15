// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type * as CV from '@techstark/opencv-js';
import { analyzePage } from './imageProcessing';
import type { PixelFrame } from '../types/scanner';

let cv: typeof CV;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  cv = await (require('@techstark/opencv-js') as Promise<typeof CV>);
});

function page({
  clipped = false,
  blurred = false,
  blank = false,
} = {}): PixelFrame {
  const image = new cv.Mat(
    640,
    480,
    cv.CV_8UC4,
    new cv.Scalar(245, 245, 245, 255),
  );
  try {
    if (!blank) {
      for (let y = 80; y < 580; y += 32) {
        cv.putText(
          image,
          'The words on this book page',
          new cv.Point(clipped ? -40 : 30, y),
          cv.FONT_HERSHEY_SIMPLEX,
          0.75,
          new cv.Scalar(15, 15, 15, 255),
          2,
        );
      }
    }
    if (blurred) cv.GaussianBlur(image, image, new cv.Size(31, 31), 8);
    return {
      width: image.cols,
      height: image.rows,
      data: new Uint8ClampedArray(image.data),
    };
  } finally {
    image.delete();
  }
}

it.each([false, true])(
  'accepts focused borderless text without requiring line-end margins (clipped=%s)',
  (clipped) => {
    const result = analyzePage(cv, page({ clipped }));
    expect(result).toMatchObject({
      aligned: true,
      gate: 'ready',
      textPresent: true,
    });
    expect(result.captureCorners).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  },
);

it('waits for focus and does not capture an empty camera view', () => {
  expect(analyzePage(cv, page({ blurred: true }))).toMatchObject({
    aligned: false,
    gate: 'sharpness',
  });
  expect(analyzePage(cv, page({ blank: true })).aligned).toBe(false);
});
