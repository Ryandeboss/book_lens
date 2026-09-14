import { scannerConfig as config } from '../config/scanner';
import type { Detection, Quad } from '../types/scanner';

// A closed contour alone can be a paragraph or an illustration. Check that all
// four edges separate bright paper from its surroundings, with room in frame.
export function hasPaperBoundary(
  gray: Uint8Array,
  width: number,
  height: number,
  quad: Quad,
): boolean {
  if (
    quad.some(
      (p) =>
        p.x <= config.edgeMargin ||
        p.y <= config.edgeMargin ||
        p.x >= 1 - config.edgeMargin ||
        p.y >= 1 - config.edgeMargin,
    )
  )
    return false;
  const center = quad.reduce(
    (c, p) => ({ x: c.x + (p.x * width) / 4, y: c.y + (p.y * height) / 4 }),
    { x: 0, y: 0 },
  );
  const probe = Math.max(
    2,
    Math.min(width, height) * config.fullPageProbeDistance,
  );
  const pixel = (x: number, y: number) => {
    const px = Math.round(x),
      py = Math.round(y);
    return px >= 0 && py >= 0 && px < width && py < height
      ? (gray[py * width + px] ?? NaN)
      : NaN;
  };
  return quad.every((point, edge) => {
    const next = quad[(edge + 1) % 4]!;
    const a = { x: point.x * width, y: point.y * height },
      b = { x: next.x * width, y: next.y * height };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return false;
    let nx = -(b.y - a.y) / length,
      ny = (b.x - a.x) / length;
    if (nx * (center.x - a.x) + ny * (center.y - a.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    let supported = 0;
    for (let i = 1; i <= 10; i++) {
      const t = i / 11,
        x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t;
      const inside = pixel(x + nx * probe, y + ny * probe);
      const outside = pixel(x - nx * probe, y - ny * probe);
      if (
        inside >= config.minBrightness &&
        inside - outside >= config.fullPageEdgeContrast
      )
        supported++;
    }
    return supported / 10 >= config.fullPageEdgeSupport;
  });
}

export function fullPageReady(d: Detection): boolean {
  return d.fullPage === true && d.source === 'page' && !!d.corners && d.aligned;
}

export function requireFullPage(d: Detection): Detection {
  // Keep focus/light/motion guidance when those checks fail first.
  if (
    fullPageReady(d) ||
    ['motion', 'lighting', 'sharpness'].includes(d.gate ?? '')
  )
    return d;
  return { ...d, aligned: false, gate: 'page', hint: 'wholePage' };
}
