import { describe, expect, it } from 'vitest';
import {
  guideForFrame,
  guideCorners,
  alignmentFor,
  outputSize,
  orderCorners,
} from './scannerGeometry';
import { normalizeSignature, signatureDifference } from './pageFingerprint';
import { scannerConfig as config } from '../config/scanner';
describe('scanner geometry and fingerprinting', () => {
  it.each([
    [900, 1200],
    [1920, 1080],
    [1080, 1920],
  ])('fits portrait guide into %s x %s camera coordinates', (w, h) => {
    const guide = guideForFrame(w, h);
    expect(guide.x).toBeGreaterThanOrEqual(0);
    expect(guide.y).toBeGreaterThanOrEqual(0);
    expect((guide.width * w) / (guide.height * h)).toBeCloseTo(
      config.guideAspect,
    );
    expect(alignmentFor(guideCorners(guide), guide).aligned).toBe(true);
    const size = outputSize(guideCorners(guide), w, h);
    expect(size.width / size.height).toBeCloseTo(config.guideAspect, 2);
  });
  it('rejects clipped/small/off-center candidates and orders corners before warping', () => {
    const g = guideForFrame(900, 1200),
      p = guideCorners(g);
    expect(orderCorners([p[2], p[0], p[3], p[1]])).toEqual(p);
    expect(alignmentFor([{ x: 0, y: 0 }, p[1], p[2], p[3]], g).aligned).toBe(
      false,
    );
    expect(
      alignmentFor(
        p.map((p) => ({ x: p.x * 0.2, y: p.y * 0.2 })) as typeof p,
        g,
      ).aligned,
    ).toBe(false);
    expect(outputSize(p, 10000, 12000).height).toBeLessThanOrEqual(
      config.correctedMaxEdge,
    );
  });
  it('tolerates exposure shifts but distinguishes page content conservatively', () => {
    const a = normalizeSignature([220, 30, 210, 50, 230, 20]);
    const same = normalizeSignature([230, 40, 220, 60, 240, 30]);
    const different = normalizeSignature([30, 220, 40, 210, 20, 230]);
    expect(signatureDifference(a, same)).toBeCloseTo(0);
    expect(signatureDifference(a, different)).toBeGreaterThan(
      config.pageChangeDifference,
    );
    expect(signatureDifference(a, [])).toBe(1);
  });
});
