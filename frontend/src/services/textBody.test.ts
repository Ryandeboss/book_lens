import { expect, it } from 'vitest';
import {
  estimateTextBody,
  canCaptureTextBody,
  textMarginInk,
} from './textBody';
it('groups the main paragraph without an isolated page number or a large illustration', () => {
  const lines = Array.from({ length: 8 }, (_, i) => ({
    x: 0.15,
    y: 0.3 + i * 0.045,
    width: 0.7,
    height: 0.025,
  }));
  const body = estimateTextBody([
    ...lines,
    { x: 0.48, y: 0.94, width: 0.04, height: 0.02 },
    { x: 0.2, y: 0.05, width: 0.6, height: 0.2 },
  ]);
  expect(body).not.toBeNull();
  expect(body!.y).toBeGreaterThan(0.25);
  expect(body!.y + body!.height).toBeLessThan(0.7);
});
it('supports a sparse heading and returns no region when evidence is absent', () => {
  expect(
    estimateTextBody([{ x: 0.2, y: 0.2, width: 0.6, height: 0.04 }]),
  ).not.toBeNull();
  expect(estimateTextBody([])).toBeNull();
});

it('permits a clear multi-line text block without page edges but rejects clipped or sparse evidence', () => {
  const lines = Array.from({ length: 6 }, (_, i) => ({
    x: 0.2,
    y: 0.2 + i * 0.05,
    width: 0.6,
    height: 0.025,
  }));
  expect(canCaptureTextBody(lines, estimateTextBody(lines))).toBe(true);
  expect(
    canCaptureTextBody(lines.slice(0, 1), estimateTextBody(lines.slice(0, 1))),
  ).toBe(false);
  expect(
    canCaptureTextBody(lines, { x: 0.01, y: 0.2, width: 0.8, height: 0.4 }),
  ).toBe(false);
  expect(canCaptureTextBody([], null)).toBe(false);
  expect(
    canCaptureTextBody(
      [...lines, { x: 0, y: 0.65, width: 0.6, height: 0.025 }],
      estimateTextBody(lines),
    ),
  ).toBe(false);
});

it('measures actual clear whitespace on all four sides instead of assuming a padded box is clear', () => {
  const pixels = new Uint8Array(100 * 100),
    body = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
  expect(textMarginInk(pixels, 100, 100, body)).toBe(0);
  for (let x = 20; x < 80; x++)
    for (let y = 20; y < 23; y++) pixels[y * 100 + x] = 255;
  expect(textMarginInk(pixels, 100, 100, body)).toBeGreaterThan(0.9);
  expect(textMarginInk(pixels, 100, 100, { ...body, x: 0 })).toBe(1);
});
