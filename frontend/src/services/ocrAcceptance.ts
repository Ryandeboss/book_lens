import type { OcrResult } from '../types/Page';
export const minimumOcrConfidence = 85;
export function meetsOcrConfidence(
  result: OcrResult | null,
): result is OcrResult & { confidence: number } {
  return Boolean(
    result &&
    result.rawText.trim() &&
    typeof result.confidence === 'number' &&
    Number.isFinite(result.confidence) &&
    result.confidence >= minimumOcrConfidence &&
    result.confidence <= 100,
  );
}
