import { describe, expect, it } from 'vitest';
import {
  visualSignature,
  findRecentDuplicate,
  contentChanged,
  featureSimilarity,
} from './pageFingerprint';
import type { PageFingerprint } from '../types/scanner';
const fixture = (seed = 1) =>
  visualSignature(
    Array.from({ length: 40 * 56 }, (_, i) =>
      i % 40 < 4 || i % 40 > 35 ? 240 : ((i * seed * 73) % 210) + 30,
    ),
    40,
    56,
  );
describe('conservative recent-page matching', () => {
  it('finds an earlier page among eight recent pages and tolerates exposure shifts', () => {
    const a = fixture();
    const same = visualSignature(
      Array.from(
        { length: 40 * 56 },
        (_, i) =>
          (i % 40 < 4 || i % 40 > 35 ? 240 : ((i * 73) % 210) + 30) - 10,
      ),
      40,
      56,
    );
    expect(
      findRecentDuplicate(same, [
        { id: 'one', pageNumber: 1, fingerprint: a },
        { id: 'two', pageNumber: 2, fingerprint: fixture(3) },
      ]),
    ).toMatchObject({ duplicate: true, pageNumber: 1 });
    expect(
      findRecentDuplicate(
        a,
        Array.from({ length: 9 }, (_, i) => ({
          id: String(i),
          pageNumber: i + 1,
          fingerprint: i === 0 ? a : fixture(3),
        })),
      )?.duplicate,
    ).toBe(false);
  });
  it('accepts different text with a similar overall layout and uncertain/blank content', () => {
    expect(
      findRecentDuplicate(fixture(3), [
        { id: 'one', pageNumber: 1, fingerprint: fixture() },
      ])?.duplicate,
    ).toBe(false);
    const blank = visualSignature(Array(40 * 56).fill(255), 40, 56);
    expect(
      findRecentDuplicate(blank, [
        { id: 'blank', pageNumber: 1, fingerprint: blank },
      ])?.duplicate,
    ).toBe(false);
  });
  it('requires multiple independent changes to rearm', () => {
    const a = fixture();
    expect(contentChanged(a, { ...a, hash: 'ffffffffffffffff' }).changed).toBe(
      false,
    );
    expect(contentChanged(a, fixture(3)).changed).toBe(true);
  });
  it('uses bounded mutual descriptor matches with spatial coverage and rejects invalid features', () => {
    let seed = 42;
    const descriptors = Uint8Array.from({ length: 32 * 32 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed >>> 24;
    });
    const features: NonNullable<PageFingerprint['features']> = {
      descriptors,
      points: Array.from({ length: 32 }, (_, i) => ({
        x: 0.2 + (i % 4) * 0.2,
        y: 0.15 + Math.floor(i / 4) * 0.1,
      })),
    };
    expect(featureSimilarity(features, features)).toBe(1);
    expect(
      featureSimilarity(features, {
        ...features,
        points: features.points.map((p) => ({ ...p, x: p.x + 0.15 })),
      }),
    ).toBe(0);
    expect(
      featureSimilarity(features, {
        ...features,
        descriptors: new Uint8Array(3),
      }),
    ).toBeNull();
    const a = fixture();
    expect(
      findRecentDuplicate({ ...a, features }, [
        {
          id: 'other',
          pageNumber: 1,
          fingerprint: {
            ...a,
            features: {
              ...features,
              points: features.points.map((p) => ({ ...p, x: p.x + 0.15 })),
            },
          },
        },
      ])?.duplicate,
    ).toBe(false);
  });
});
