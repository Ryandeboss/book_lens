// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type * as CV from '@techstark/opencv-js';
import { analyzePage } from './imageProcessing';
import type { PixelFrame } from '../types/scanner';
import { scannerConfig } from '../config/scanner';

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

it.each(['object', 'stripes', 'skin'] as const)(
  'does not mistake a focused %s with no printed text for a page',
  (scene) => {
    const image = new cv.Mat(
      640,
      480,
      cv.CV_8UC4,
      new cv.Scalar(240, 230, 220, 255),
    );
    try {
      // A high-contrast rectangular object deliberately triggers paper contours.
      cv.rectangle(
        image,
        new cv.Point(45, 35),
        new cv.Point(435, 605),
        new cv.Scalar(40, 40, 40, 255),
        4,
      );
      if (scene === 'object') {
        cv.circle(
          image,
          new cv.Point(240, 320),
          65,
          new cv.Scalar(60, 60, 60, 255),
          6,
        );
      } else if (scene === 'stripes') {
        for (let y = 80; y < 580; y += 32)
          cv.line(
            image,
            new cv.Point(65, y),
            new cv.Point(415, y),
            new cv.Scalar(30, 30, 30, 255),
            3,
          );
      } else {
        // Deterministic short diagonal hair-like marks on a skin-colored surface.
        for (let i = 0; i < 180; i++) {
          const x = 70 + ((i * 97) % 340),
            y = 70 + ((i * 137) % 490);
          cv.line(
            image,
            new cv.Point(x, y),
            new cv.Point(x + 3, y + 7),
            new cv.Scalar(70, 55, 45, 255),
            1,
          );
        }
      }
      const result = analyzePage(cv, {
        width: image.cols,
        height: image.rows,
        data: new Uint8ClampedArray(image.data),
      });
      expect(result.sharpness).toBeGreaterThan(scannerConfig.minSharpness);
      expect(result).toMatchObject({
        aligned: false,
        gate: 'text',
        textPresent: false,
      });
    } finally {
      image.delete();
    }
  },
);
