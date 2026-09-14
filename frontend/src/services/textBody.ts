import { scannerConfig as config } from '../config/scanner';
import type { Guide } from '../types/scanner';
// Only flag text-like rows actually touching the image boundary. No minimum
// paper margin, page outline or dense text block is required.
export function hasClippedTextLines(
  lines: Guide[],
  width: number,
  height: number,
): boolean {
  const rows = lines
    .filter(
      (r) =>
        r.width >= 0.08 &&
        r.height >= 2 / height &&
        r.height <= config.textLineMaxHeight &&
        r.width / r.height >= 3,
    )
    .sort((a, b) => a.y - b.y);
  const distinct = rows.filter(
    (r, i) =>
      !rows
        .slice(0, i)
        .some((p) => Math.abs(p.y - r.y) < Math.min(p.height, r.height) / 2),
  );
  const left = distinct.filter((r) => r.x <= 1 / width).length;
  const right = distinct.filter((r) => r.x + r.width >= 1 - 1 / width).length;
  return (
    left >= 2 ||
    right >= 2 ||
    distinct.some((r) => r.y <= 1 / height || r.y + r.height >= 1 - 1 / height)
  );
}
// Rectangles are normalized line candidates from the worker, never word OCR.
export function estimateTextBody(lines: Guide[]): Guide | null {
  const candidates = lines
    .filter(
      (r) =>
        r.width >= config.textLineMinWidth &&
        r.height > 0 &&
        r.height <= config.textLineMaxHeight &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.width <= 1.000001 &&
        r.y + r.height <= 1.000001,
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
// Require several printed rows; whitespace around the block is not required.
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
