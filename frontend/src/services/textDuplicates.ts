// Compare raw OCR word order, with a bounded edit-distance check.
export function duplicateTextScore(a: string, b: string): number | null {
  const words = (text: string): string[] =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  let left = words(a),
    right = words(b);
  const longest = Math.max(left.length, right.length);
  if (Math.min(left.length, right.length) < 20) return null;
  if (left.join(' ') === right.join(' ')) return 1;
  if (Math.min(left.length, right.length) < 40) return null;
  const limit = Math.floor(longest * 0.1);
  if (Math.abs(left.length - right.length) > limit) return null;
  // Trim common ends; the band and early exit bound unrelated-page work.
  let start = 0;
  while (
    start < Math.min(left.length, right.length) &&
    left[start] === right[start]
  )
    start++;
  left = left.slice(start);
  right = right.slice(start);
  while (left.length && right.length && left.at(-1) === right.at(-1)) {
    left.pop();
    right.pop();
  }
  if (!left.length || !right.length)
    return 1 - Math.max(left.length, right.length) / longest;
  let previous = new Int32Array(right.length + 1).fill(limit + 1);
  for (let j = 0; j <= Math.min(right.length, limit); j++) previous[j] = j;
  for (let i = 1; i <= left.length; i++) {
    const current = new Int32Array(right.length + 1).fill(limit + 1);
    if (i <= limit) current[0] = i;
    let best = limit + 1;
    for (
      let j = Math.max(1, i - limit);
      j <= Math.min(right.length, i + limit);
      j++
    ) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      best = Math.min(best, current[j]!);
    }
    if (best > limit) return null;
    previous = current;
  }
  const distance = previous[right.length]!;
  return distance <= limit ? 1 - distance / longest : null;
}
