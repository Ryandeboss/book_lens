import { scannerConfig as config } from '../config/scanner';
import type { Guide } from '../types/scanner';

// Probe the original thresholded pixels, before morphology joins letters into
// lines. Multiple separated ink strokes distinguish text from solid edges.
// The rectangle is in pixels; only three short rows are read, with no OCR.
export function hasPrintedStrokes(
  binary: Uint8Array,
  imageWidth: number,
  box: Guide,
): boolean {
  if (box.height < 3) return false;
  let qualifyingRows = 0;
  for (const fraction of [0.3, 0.5, 0.7]) {
    const y = box.y + Math.floor((box.height - 1) * fraction);
    let runs = 0,
      previousInk = false;
    for (let x = box.x; x < box.x + box.width; x++) {
      const ink = (binary[y * imageWidth + x] ?? 0) > 0;
      if (ink && !previousInk) runs++;
      previousInk = ink;
      if (runs >= config.textLineMinInkRuns) break;
    }
    if (runs >= config.textLineMinInkRuns) qualifyingRows++;
  }
  return qualifyingRows >= 2;
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

// Automatic capture needs printed lines, even when a paper outline is found.
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
