import { scannerConfig as config } from '../config/scanner';
import type { Quad } from '../types/scanner';

// These are perspective cues, not a calibrated physical angle measurement.
// Use source pixels: normalized x/y have different scales on a portrait camera.
export function pageIsOblique(
  quad: Quad,
  width: number,
  height: number,
): boolean {
  const p = quad.map((p) => ({ x: p.x * width, y: p.y * height }));
  const edges = p.map((a, i) => ({
    x: p[(i + 1) % 4]!.x - a.x,
    y: p[(i + 1) % 4]!.y - a.y,
  }));
  const lengths = edges.map((e) => Math.hypot(e.x, e.y));
  if (lengths.some((n) => n < 1)) return true;
  const ratio = (a: number, b: number) => Math.min(a, b) / Math.max(a, b);
  if (
    ratio(lengths[0]!, lengths[2]!) < config.angleMinOppositeRatio ||
    ratio(lengths[1]!, lengths[3]!) < config.angleMinOppositeRatio
  )
    return true;
  if (
    edges.some((e, i) => {
      const next = edges[(i + 1) % 4]!;
      return (
        Math.abs(e.x * next.x + e.y * next.y) /
          (lengths[i]! * lengths[(i + 1) % 4]!) >
        config.angleMaxCornerCosine
      );
    })
  )
    return true;
  return (
    ratio(lengths[0]! + lengths[2]!, lengths[1]! + lengths[3]!) <
    config.angleMinShapeRatio
  );
}

export interface TextLineShape {
  x: number;
  y: number;
  thickness: number;
  angle: number; // Long axis, in degrees, in the unrectified preview.
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

// Borderless fallback. Compare separate text rows, not ragged line lengths or
// page margins. A common rotation in the image plane is deliberately ignored.
export function textIsOblique(lines: TextLineShape[]): boolean {
  if (lines.length < config.angleMinTextRows) return false;
  const reference = lines[0]!.angle;
  const angleOf = (angle: number) =>
    reference + ((angle - reference + 270) % 180) - 90;
  const angle = (median(lines.map((r) => angleOf(r.angle))) * Math.PI) / 180;
  const ordered = lines
    .map((r) => ({
      ...r,
      position: -r.x * Math.sin(angle) + r.y * Math.cos(angle),
    }))
    .sort((a, b) => a.position - b.position);
  const rows: typeof ordered = [];
  for (const row of ordered) {
    const last = rows.at(-1);
    // Several word contours from the same line must not count as multiple rows.
    if (
      !last ||
      row.position - last.position >
        Math.max(row.thickness, last.thickness) * 0.75
    )
      rows.push(row);
  }
  if (rows.length < config.angleMinTextRows) return false;
  const band = Math.max(2, Math.floor(rows.length / 3));
  const first = rows.slice(0, band),
    last = rows.slice(-band);
  const a = median(first.map((r) => r.thickness)),
    b = median(last.map((r) => r.thickness));
  const middle = median(rows.slice(band, -band).map((r) => r.thickness));
  // An abrupt title/body font change is not perspective: scale must change
  // across the middle of the page as well as between its ends.
  const scaleGradient =
    Math.min(a, b) / Math.max(a, b) < config.angleMinTextScaleRatio &&
    middle > Math.min(a, b) * 1.1 &&
    middle < Math.max(a, b) / 1.1;
  return (
    scaleGradient ||
    Math.abs(
      median(first.map((r) => angleOf(r.angle))) -
        median(last.map((r) => angleOf(r.angle))),
    ) > config.angleMaxTextDivergence
  );
}
