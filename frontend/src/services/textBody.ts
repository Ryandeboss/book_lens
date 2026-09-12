import { scannerConfig as config } from '../config/scanner';
import type { Guide } from '../types/scanner';
// Rectangles are normalized line candidates from the worker, never word OCR.
export function estimateTextBody(lines: Guide[]): Guide | null {
  const candidates = lines
    .filter(
      (r) =>
        r.width >= config.textLineMinWidth &&
        r.height > 0 &&
        r.height <= config.textLineMaxHeight &&
        r.x > 0.015 &&
        r.y > 0.015 &&
        r.x + r.width < 0.985 &&
        r.y + r.height < 0.985,
    )
    .sort((a, b) => a.y - b.y);
  const groups: { box: Guide; lines: number }[] = [];
  for (const line of candidates) {
    const group = groups.find(
      (g) =>
        line.y <= g.box.y + g.box.height + config.textLineMergeGap &&
        Math.min(g.box.x + g.box.width, line.x + line.width) -
          Math.max(g.box.x, line.x) >
          Math.min(g.box.width, line.width) * 0.2,
    );
    if (!group) {
      groups.push({ box: { ...line }, lines: 1 });
      continue;
    }
    const x = Math.min(group.box.x, line.x),
      y = Math.min(group.box.y, line.y);
    group.box = {
      x,
      y,
      width: Math.max(group.box.x + group.box.width, line.x + line.width) - x,
      height:
        Math.max(group.box.y + group.box.height, line.y + line.height) - y,
    };
    group.lines++;
  }
  const best = groups.sort(
    (a, b) =>
      b.box.width * b.box.height * Math.min(b.lines, 5) -
      a.box.width * a.box.height * Math.min(a.lines, 5),
  )[0];
  if (!best || best.box.width * best.box.height < config.textBodyMinArea)
    return null;
  const margin = config.textBodyMargin,
    x = Math.max(0, best.box.x - margin),
    y = Math.max(0, best.box.y - margin);
  return {
    x,
    y,
    width: Math.min(1, best.box.x + best.box.width + margin) - x,
    height: Math.min(1, best.box.y + best.box.height + margin) - y,
  };
}

// A missing paper edge may not veto a clearly visible block of printed lines.
// Require several lines with breathing room; never auto-crop text at the guide edge.
export function canCaptureTextBody(
  lines: Guide[],
  body: Guide | null,
): boolean {
  if (
    !body ||
    body.width < config.textCaptureMinWidth ||
    body.height < config.textCaptureMinHeight
  )
    return false;
  // A shorter central paragraph must not hide other lines cut by the crop.
  if (
    lines.some(
      (r) =>
        r.width >= config.textLineMinWidth &&
        r.height > 0 &&
        r.height <= config.textLineMaxHeight &&
        (r.x <= 0.012 ||
          r.y <= 0.012 ||
          r.x + r.width >= 0.988 ||
          r.y + r.height >= 0.988),
    )
  )
    return false;
  const margin = config.textCaptureMargin;
  if (
    body.x < margin ||
    body.y < margin ||
    body.x + body.width > 1 - margin ||
    body.y + body.height > 1 - margin
  )
    return false;
  const rows = lines
    .filter(
      (r) =>
        r.width >= config.textLineMinWidth &&
        r.height > 0 &&
        r.height <= config.textLineMaxHeight &&
        r.width / r.height >= 3 &&
        r.x >= body.x &&
        r.y >= body.y &&
        r.x + r.width <= body.x + body.width &&
        r.y + r.height <= body.y + body.height,
    )
    .sort((a, b) => a.y - b.y);
  let count = 0,
    lastBottom = -1;
  for (const row of rows) {
    if (row.y >= lastBottom) {
      count++;
      lastBottom = row.y + row.height;
    }
  }
  return count >= config.textCaptureMinLines;
}

/** Check real ink in four bands around the detected rectangle, not just its position. */
export function textMarginInk(
  binary: Uint8Array,
  width: number,
  height: number,
  body: Guide,
): number {
  const x0 = Math.floor(body.x * width),
    y0 = Math.floor(body.y * height);
  const x1 = Math.ceil((body.x + body.width) * width),
    y1 = Math.ceil((body.y + body.height) * height);
  const pad = Math.max(
    3,
    Math.round(Math.min(width, height) * config.textClearMargin),
  );
  if (x0 < pad || y0 < pad || x1 + pad >= width || y1 + pad >= height) return 1;
  // estimateTextBody already pads the ink bounds. Inspect that surrounding
  // whitespace rather than reaching beyond it into a gutter or paper edge.
  const bands = [
    [x0, y0, x1, y0 + pad],
    [x0, y1 - pad, x1, y1],
    [x0, y0 + pad, x0 + pad, y1 - pad],
    [x1 - pad, y0 + pad, x1, y1 - pad],
  ];
  return Math.max(
    ...bands.map(([left, top, right, bottom]) => {
      let ink = 0,
        total = 0;
      for (let y = top!; y < bottom!; y++)
        for (let x = left!; x < right!; x++) {
          total++;
          if (binary[y * width + x]) ink++;
        }
      return ink / Math.max(1, total);
    }),
  );
}
