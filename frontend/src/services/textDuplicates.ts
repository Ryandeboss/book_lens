// Compare the original transcription, never model-generated wording. Require
// nearly the whole page to match; a shared heading/quotation is insufficient.
export function duplicateTextScore(a: string, b: string): number | null {
  const words = (text: string) =>
    text
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const left = words(a),
    right = words(b);
  if (Math.min(left.length, right.length) < 50) return null;
  if (
    Math.min(left.length, right.length) / Math.max(left.length, right.length) <
    0.95
  )
    return null;
  if (left.join(' ') === right.join(' ')) return 1;
  // Numbers may distinguish otherwise identical forms/numbered book pages.
  const numbers = (text: string) => text.match(/\p{N}+/gu)?.join(' ') ?? '';
  if (numbers(a) !== numbers(b)) return null;
  const shingles = (tokens: string[]) => {
    const counts = new Map<string, number>();
    for (let i = 0; i <= tokens.length - 5; i++) {
      const key = tokens.slice(i, i + 5).join(' ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const x = shingles(left),
    y = shingles(right);
  let common = 0;
  for (const [key, count] of x) common += Math.min(count, y.get(key) ?? 0);
  const score = (2 * common) / (left.length + right.length - 8);
  return score >= 0.96 ? score : null;
}
