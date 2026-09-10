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
