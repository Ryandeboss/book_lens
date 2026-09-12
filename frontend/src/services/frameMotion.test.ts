import { expect, it } from 'vitest';
import { FrameMotion, motionDifference } from './frameMotion';
import { scannerConfig } from '../config/scanner';
const frame = Uint8Array.from({ length: 4096 }, (_, i) =>
  i % 64 < 32 ? 40 : 200,
);
it('ignores identical samples and modest exposure shifts without amplifying noise', () => {
  expect(motionDifference(frame, frame)).toBe(0);
  expect(
    motionDifference(
      frame,
      frame.map((x) => x + 15),
    ),
  ).toBe(0);
  expect(
    motionDifference(
      new Uint8Array(4096).fill(240),
      new Uint8Array(4096).fill(241),
    ),
  ).toBe(0);
});
it('blocks real motion and requires a fresh baseline after resolution changes', () => {
  const motion = new FrameMotion();
  expect(motion.sample(frame, '640x480').moving).toBe(true);
  expect(motion.sample(frame, '640x480').moving).toBe(false);
  const shifted = Uint8Array.from(
    frame,
    (_, i) => frame[(i + 12) % frame.length]!,
  );
  expect(motionDifference(frame, shifted)).toBeGreaterThan(
    scannerConfig.motionDifference,
  );
  expect(motion.sample(shifted, '640x480').moving).toBe(true);
  expect(motion.sample(shifted, '480x640').moving).toBe(true);
});
