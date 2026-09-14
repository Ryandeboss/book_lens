import { expect, it } from 'vitest';
import { hasPaperBoundary, requireFullPage } from './fullPage';
import type { Quad } from '../types/scanner';
const quad: Quad = [
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.1 },
  { x: 0.8, y: 0.9 },
  { x: 0.2, y: 0.9 },
];
function frame(background = 35, clipped = false) {
  const gray = new Uint8Array(400 * 500).fill(background);
  for (let y = 50; y < (clipped ? 500 : 450); y++)
    for (let x = 80; x < 320; x++) gray[y * 400 + x] = 240;
  return gray;
}
it('requires supported physical edges and rejects a missing bottom edge or plain background', () => {
  expect(hasPaperBoundary(frame(), 400, 500, quad)).toBe(true);
  expect(hasPaperBoundary(frame(240), 400, 500, quad)).toBe(false);
  expect(hasPaperBoundary(frame(35, true), 400, 500, quad)).toBe(false);
});
it('does not mistake a text block on a sheet for the paper boundary', () => {
  const gray = new Uint8Array(400 * 500).fill(240);
  for (let y = 60; y < 450; y += 20)
    for (let x = 80; x < 320; x++) gray[y * 400 + x] = 20;
  expect(hasPaperBoundary(gray, 400, 500, quad)).toBe(false);
});
it('rejects edges cut off at the frame and incomplete geometry', () => {
  const cropped = quad.map((p) => ({ ...p, y: p.y === 0.9 ? 1 : p.y })) as Quad;
  expect(hasPaperBoundary(frame(35, true), 400, 500, cropped)).toBe(false);
  expect(
    requireFullPage({
      corners: quad,
      source: 'guide',
      aligned: true,
      alignment: 1,
      sharpness: 90,
      brightness: 160,
      signature: [],
    }),
  ).toMatchObject({ aligned: false, hint: 'wholePage' });
});
