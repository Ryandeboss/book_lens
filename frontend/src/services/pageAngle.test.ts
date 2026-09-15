import { expect, it } from 'vitest';
import { pageIsOblique, textIsOblique, type TextLineShape } from './pageAngle';
import type { Quad } from '../types/scanner';

const front: Quad = [
  { x: 0.15, y: 0.08 },
  { x: 0.85, y: 0.08 },
  { x: 0.85, y: 0.92 },
  { x: 0.15, y: 0.92 },
];
it('allows a front-facing page regardless of image aspect, in-plane rotation, position or margins', () => {
  expect(pageIsOblique(front, 480, 640)).toBe(false);
  const rotate = (radians: number): Quad =>
    front.map(({ x, y }) => {
      const px = (x - 0.5) * 480,
        py = (y - 0.5) * 640;
      return {
        x: (px * Math.cos(radians) - py * Math.sin(radians)) / 800 + 0.5,
        y: (px * Math.sin(radians) + py * Math.cos(radians)) / 600 + 0.5,
      };
    }) as Quad;
  expect(pageIsOblique(rotate(Math.PI / 3), 800, 600)).toBe(false);
  expect(pageIsOblique(rotate(Math.PI / 2), 800, 600)).toBe(false);
  expect(
    pageIsOblique(
      front.map((p) => ({ x: p.x - 0.15, y: p.y - 0.08 })) as Quad,
      480,
      640,
    ),
  ).toBe(false);
});
it('rejects converging edges, corner skew and extreme foreshortening', () => {
  expect(
    pageIsOblique(
      [
        { x: 0.4, y: 0.1 },
        { x: 0.6, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      480,
      640,
    ),
  ).toBe(true);
  expect(
    pageIsOblique(
      [
        { x: 0.4, y: 0.1 },
        { x: 0.95, y: 0.1 },
        { x: 0.6, y: 0.9 },
        { x: 0.05, y: 0.9 },
      ],
      640,
      480,
    ),
  ).toBe(true);
  expect(
    pageIsOblique(
      [
        { x: 0.4, y: 0.1 },
        { x: 0.6, y: 0.1 },
        { x: 0.6, y: 0.9 },
        { x: 0.4, y: 0.9 },
      ],
      480,
      640,
    ),
  ).toBe(true);
});
const rows = (): TextLineShape[] =>
  Array.from({ length: 12 }, (_, i) => ({
    x: 200,
    y: 40 + 25 * i,
    thickness: 12,
    angle: 0,
  }));
it('allows uniform text, mild perspective, and an isolated heading', () => {
  expect(textIsOblique(rows())).toBe(false);
  expect(
    textIsOblique(
      rows()
        .slice(0, 8)
        .map((r, i) => ({ ...r, thickness: i < 2 ? 25 : 12 })),
    ),
  ).toBe(false);
  expect(
    textIsOblique(
      rows().map((r, i) => ({
        ...r,
        thickness: i === 0 ? 25 : 12 - i * 0.15,
        angle: i * 0.3,
      })),
    ),
  ).toBe(false);
});
it('rejects text scale gradients and converging lines without a paper boundary', () => {
  expect(
    textIsOblique(rows().map((r, i) => ({ ...r, thickness: 6 + i }))),
  ).toBe(true);
  expect(
    textIsOblique(rows().map((r, i) => ({ ...r, angle: -10 + 2 * i }))),
  ).toBe(true);
});
it('ignores common text rotation and multiple words on one row', () => {
  expect(textIsOblique(rows().map((r) => ({ ...r, angle: 15 })))).toBe(false);
  expect(
    textIsOblique(
      Array.from({ length: 12 }, (_, i) => ({
        x: i * 30,
        y: 100,
        thickness: i + 5,
        angle: 0,
      })),
    ),
  ).toBe(false);
});
