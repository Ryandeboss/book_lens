// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type * as CV from '@techstark/opencv-js';
import { analyzePage } from './imageProcessing';
import type { PixelFrame } from '../types/scanner';
import { scannerConfig } from '../config/scanner';
import type { Quad } from '../types/scanner';

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

function projectedPage(corners: Quad, borderless = false): PixelFrame {
  const src = cv.matFromImageData(page());
  const from = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    [0, 0, 479, 0, 479, 639, 0, 639],
  );
  const to = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    corners.flatMap((p) => [p.x * 640, p.y * 640]),
  );
  const transform = cv.getPerspectiveTransform(from, to),
    result = new cv.Mat();
  try {
    cv.warpPerspective(
      src,
      result,
      transform,
      new cv.Size(640, 640),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      borderless
        ? new cv.Scalar(245, 245, 245, 255)
        : new cv.Scalar(30, 30, 30, 255),
    );
    return {
      width: 640,
      height: 640,
      data: new Uint8ClampedArray(result.data),
    };
  } finally {
    result.delete();
    transform.delete();
    to.delete();
    from.delete();
    src.delete();
  }
}
it.each([
  [
    { x: 0.3, y: 0.1 },
    { x: 0.65, y: 0.3 },
    { x: 0.65, y: 0.65 },
    { x: 0.3, y: 0.95 },
  ],
  [
    { x: 0.4, y: 0.15 },
    { x: 0.6, y: 0.15 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ],
  [
    { x: 0.4, y: 0.1 },
    { x: 0.6, y: 0.1 },
    { x: 0.6, y: 0.9 },
    { x: 0.4, y: 0.9 },
  ],
] as Quad[])(
  'rejects an oblique page before perspective normalization can hide its angle',
  (...corners) => {
    const result = analyzePage(cv, projectedPage(corners as Quad));
    expect(result).toMatchObject({ aligned: false, gate: 'angle' });
  },
);
it.each([false, true])(
  'keeps a mildly tilted page eligible (borderless=%s)',
  (borderless) => {
    expect(
      analyzePage(
        cv,
        projectedPage(
          [
            { x: 0.15, y: 0.12 },
            { x: 0.8, y: 0.15 },
            { x: 0.84, y: 0.9 },
            { x: 0.12, y: 0.92 },
          ],
          borderless,
        ),
      ),
    ).toMatchObject({ aligned: true, gate: 'ready' });
  },
);
it.each([false, true])(
  'rejects strongly converging text lines (borderless=%s)',
  (borderless) => {
    expect(
      analyzePage(
        cv,
        projectedPage(
          [
            { x: 0.1, y: 0.08 },
            { x: 0.85, y: 0.3 },
            { x: 0.85, y: 0.65 },
            { x: 0.1, y: 0.95 },
          ],
          borderless,
        ),
      ),
    ).toMatchObject({ aligned: false, gate: 'angle' });
  },
);
it('rejects strong near/far text-size changes without visible paper edges', () => {
  expect(
    analyzePage(
      cv,
      projectedPage(
        [
          { x: 0.4, y: 0.15 },
          { x: 0.6, y: 0.15 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
        true,
      ),
    ),
  ).toMatchObject({ aligned: false, gate: 'angle' });
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
