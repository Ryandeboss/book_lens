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
