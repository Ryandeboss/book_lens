import { expect, it } from 'vitest';
import { estimateTextBody } from './textBody';
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
