import { expect, it } from 'vitest';
import {
  estimateTextBody,
  canCaptureTextBody,
  hasClippedTextLines,
} from './textBody';
it('flags repeated truncated line ends on either side and text touching top/bottom', () => {
  const row = { x: 0, y: 0.4, width: 0.6, height: 0.03 };
  expect(hasClippedTextLines([row, { ...row, y: 0.5 }], 640, 480)).toBe(true);
  expect(
    hasClippedTextLines(
      [
        { ...row, x: 0.4 },
        { ...row, x: 0.4, y: 0.5 },
      ],
      640,
      480,
    ),
  ).toBe(true);
  expect(hasClippedTextLines([{ ...row, x: 0.2, y: 0 }], 640, 480)).toBe(true);
  expect(hasClippedTextLines([{ ...row, x: 0.2, y: 0.97 }], 640, 480)).toBe(
    true,
  );
});
it('requires no paper margin and ignores isolated marks, duplicate contours and frame borders', () => {
  const row = { x: 0.01, y: 0.4, width: 0.98, height: 0.03 };
  expect(hasClippedTextLines([row, { ...row, y: 0.5 }], 640, 480)).toBe(false);
  expect(
    hasClippedTextLines(
      [
        { ...row, x: 0 },
        { ...row, x: 0 },
      ],
      640,
      480,
    ),
  ).toBe(false);
  expect(
    hasClippedTextLines([{ x: 0, y: 0, width: 1, height: 1 / 480 }], 640, 480),
  ).toBe(false);
  expect(hasClippedTextLines([], 640, 480)).toBe(false);
});
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

it('permits a clear multi-line text block without page edges and near-edge text but rejects sparse evidence', () => {
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
  ).toBe(true);
  expect(canCaptureTextBody([], null)).toBe(false);
  expect(
    canCaptureTextBody(
      [...lines, { x: 0, y: 0.65, width: 0.6, height: 0.025 }],
      estimateTextBody(lines),
    ),
  ).toBe(true);
});

it('accepts text rows at the image boundary without a whitespace margin', () => {
  const lines = Array.from({ length: 6 }, (_, i) => ({
    x: 0,
    y: i * 0.05,
    width: 1,
    height: 0.025,
  }));
  const body = estimateTextBody(lines);
  expect(body?.x).toBe(0);
  expect(canCaptureTextBody(lines, body)).toBe(true);
});
