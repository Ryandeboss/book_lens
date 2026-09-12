import { scannerConfig as config } from '../config/scanner';
import type {
  VisualSignature,
  PageFingerprint,
  RecentPage,
  DuplicateMatch,
} from '../types/scanner';
// Mean-centered grayscale signatures tolerate small exposure changes.
// Strict duplicate threshold protects adjacent pages with similar layouts.
export function normalizeSignature(values: number[]): number[] {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.map((v) => (v - mean) / 255);
}
export function signatureDifference(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 1;
  return (
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0) / a.length
  );
}

export function visualSignature(
  values: number[],
  width: number,
  height: number,
): VisualSignature {
  // Normalize modest global exposure/contrast changes before comparing layout.
  // Do not amplify almost-blank sensor noise into a strong signature.
  const low = Math.min(...values),
    high = Math.max(...values);
  const range = high - low;
  if (range > 16) values = values.map((v) => ((v - low) * 255) / range);
  const gray = normalizeSignature(values);
  const sample = (x: number, y: number) =>
    values[
      Math.min(height - 1, Math.floor(y * height)) * width +
        Math.min(width - 1, Math.floor(x * width))
    ] ?? 255;
  let hash = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++)
      byte =
        (byte << 1) |
        (sample(x / 9, (y + 0.5) / 8) > sample((x + 1) / 9, (y + 0.5) / 8)
          ? 1
          : 0);
    hash += byte.toString(16).padStart(2, '0');
  }
  const edges: number[] = [],
    density = Array<number>(24).fill(0),
    counts = Array<number>(24).fill(0);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x,
        value = values[index]!;
      edges.push(
        (Math.abs(value - values[y * width + Math.min(x + 1, width - 1)]!) +
          Math.abs(value - values[Math.min(y + 1, height - 1) * width + x]!)) /
          510,
      );
      const cell =
        Math.min(5, Math.floor((y / height) * 6)) * 4 +
        Math.min(3, Math.floor((x / width) * 4));
      counts[cell]!++;
      if (value < mean - 12) density[cell]!++;
    }
  return {
    gray,
    hash,
    edges,
    density: density.map((n, i) => n / Math.max(1, counts[i]!)),
  };
}
const bits = (value: number) => {
  let n = value,
    count = 0;
  while (n) {
    n &= n - 1;
    count++;
  }
  return count;
};
export function hashDifference(a: string, b: string) {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return 1;
  let count = 0;
  for (let i = 0; i < 16; i++)
    count += bits(parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16));
  return count / 64;
}
export function compareVisual(a: VisualSignature, b: VisualSignature) {
  return {
    gray: signatureDifference(a.gray, b.gray),
    hash: hashDifference(a.hash, b.hash),
    edges: signatureDifference(a.edges, b.edges),
    density: signatureDifference(a.density, b.density),
  };
}
export function contentChanged(a: VisualSignature, b: VisualSignature) {
  const d = compareVisual(a, b);
  return {
    score: Math.max(
      d.gray / config.pageChangeGray,
      d.edges / config.pageChangeEdges,
      d.hash / config.pageChangeHash,
      d.density / config.pageChangeDensity,
    ),
    changed:
      [
        d.gray >= config.pageChangeGray,
        d.edges >= config.pageChangeEdges,
        d.hash >= config.pageChangeHash,
        d.density >= config.pageChangeDensity,
      ].filter(Boolean).length >= 2,
  };
}
export function featureSimilarity(
  a: PageFingerprint['features'],
  b: PageFingerprint['features'],
): number | null {
  if (
    !a ||
    !b ||
    a.descriptors.length !== a.points.length * 32 ||
    b.descriptors.length !== b.points.length * 32 ||
    a.points.length < config.orbMinMatches ||
    b.points.length < config.orbMinMatches
  )
    return null;
  const nearest = (from: typeof a, to: typeof a) =>
    from.points.map((point, i) => {
      let best = 257,
        second = 257,
        index = -1;
      for (let j = 0; j < to.points.length; j++) {
        let distance = 0;
        for (let k = 0; k < 32; k++)
          distance += bits(
            (from.descriptors[i * 32 + k] ?? 0) ^
              (to.descriptors[j * 32 + k] ?? 0),
          );
        if (distance < best) {
          second = best;
          best = distance;
          index = j;
        } else if (distance < second) second = distance;
      }
      return best <= config.orbMaxHamming &&
        best < second * config.orbMatchRatio &&
        index >= 0 &&
        Math.hypot(
          point.x - to.points[index]!.x,
          point.y - to.points[index]!.y,
        ) <= config.orbPositionTolerance
        ? index
        : -1;
    });
  const forward = nearest(a, b),
    reverse = nearest(b, a),
    quadrants = new Set<number>();
  let matches = 0;
  forward.forEach((j, i) => {
    if (j >= 0 && reverse[j] === i) {
      matches++;
      const p = a.points[i]!;
      quadrants.add((p.x >= 0.5 ? 1 : 0) + (p.y >= 0.5 ? 2 : 0));
    }
  });
  return matches >= config.orbMinMatches && quadrants.size >= 3
    ? matches / Math.max(a.points.length, b.points.length)
    : 0;
}
export function findRecentDuplicate(
  candidate: PageFingerprint,
  recent: RecentPage[],
): DuplicateMatch | null {
  let closest: DuplicateMatch | null = null;
  for (const page of recent.slice(-config.recentFingerprints)) {
    const scores = compareVisual(candidate, page.fingerprint);
    const strict =
      scores.gray <= config.duplicateDifference &&
      scores.hash <= config.duplicateHash &&
      scores.edges <= config.duplicateEdges &&
      scores.density <= config.duplicateDensity;
    const featureGate =
      scores.gray <= config.orbGrayGate &&
      scores.hash <= config.orbHashGate &&
      scores.edges <= config.orbEdgeGate &&
      scores.density <= config.orbDensityGate;
    const featureScore = featureGate
      ? featureSimilarity(candidate.features, page.fingerprint.features)
      : null;
    const meaningful = candidate.gray.some((v) => Math.abs(v) > 0.03);
    // Feature disagreement vetoes a deceptively similar low-resolution layout.
    const duplicate =
      meaningful &&
      ((strict &&
        (featureScore === null || featureScore >= config.orbDuplicateScore)) ||
        (featureGate &&
          featureScore !== null &&
          featureScore >= config.orbDuplicateScore));
    const result = {
      id: page.id,
      pageNumber: page.pageNumber,
      ...scores,
      featureScore,
      duplicate,
    };
    if (duplicate) return result;
    if (!closest || scores.gray < closest.gray) closest = result;
  }
  return closest;
}
