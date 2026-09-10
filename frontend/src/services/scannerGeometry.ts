import { scannerConfig as config } from '../config/scanner';
import type { Point, Quad, Guide } from '../types/scanner';

export function guideForFrame(width: number, height: number): Guide {
  let h = config.guideCoverage;
  let w = (h * height * config.guideAspect) / width;
  if (w > config.guideCoverage) {
    w = config.guideCoverage;
    h = (w * width) / config.guideAspect / height;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
}
export function guideCorners(guide: Guide): Quad {
  return [
    { x: guide.x, y: guide.y },
    { x: guide.x + guide.width, y: guide.y },
    { x: guide.x + guide.width, y: guide.y + guide.height },
    { x: guide.x, y: guide.y + guide.height },
  ];
}
export function polygonArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length]!;
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}
export function orderCorners(points: Point[]): Quad {
  const center = {
    x: points.reduce((s, p) => s + p.x, 0) / 4,
    y: points.reduce((s, p) => s + p.y, 0) / 4,
  };
  const sorted = [...points].sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) -
      Math.atan2(b.y - center.y, b.x - center.x),
  );
  const first = sorted.reduce(
    (best, p, i) => (p.x + p.y < sorted[best]!.x + sorted[best]!.y ? i : best),
    0,
  );
  return [...sorted.slice(first), ...sorted.slice(0, first)] as Quad;
}
export function cornerDistance(a: Quad, b: Quad) {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));
}
export function alignmentFor(corners: Quad, guide: Guide) {
  const tolerance = config.alignmentTolerance;
  const within = corners.every(
    (p) =>
      p.x >= guide.x - guide.width * tolerance &&
      p.x <= guide.x + guide.width * (1 + tolerance) &&
      p.y >= guide.y - guide.height * tolerance &&
      p.y <= guide.y + guide.height * (1 + tolerance),
  );
  const area = polygonArea(corners) / (guide.width * guide.height);
  const center = corners.reduce(
    (s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }),
    { x: 0, y: 0 },
  );
  const centered =
    Math.abs(center.x - guide.x - guide.width / 2) < guide.width * tolerance &&
    Math.abs(center.y - guide.y - guide.height / 2) < guide.height * tolerance;
  const visible = corners.every(
    (p) =>
      p.x > config.edgeMargin &&
      p.y > config.edgeMargin &&
      p.x < 1 - config.edgeMargin &&
      p.y < 1 - config.edgeMargin,
  );
  return {
    aligned: within && centered && visible && area >= config.minGuideCoverage,
    score: Math.min(1, area) * (within && centered && visible ? 1 : 0.5),
  };
}
export function outputSize(corners: Quad, width: number, height: number) {
  const p = corners.map((p) => ({ x: p.x * width, y: p.y * height }));
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.max(distance(p[0]!, p[1]!), distance(p[3]!, p[2]!));
  const h = Math.max(distance(p[0]!, p[3]!), distance(p[1]!, p[2]!));
  const scale = Math.min(1, config.correctedMaxEdge / Math.max(w, h));
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
  };
}
