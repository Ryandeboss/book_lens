import type { protos } from '@google-cloud/documentai';
type Document = protos.google.cloud.documentai.v1.IDocument;
type Anchor = protos.google.cloud.documentai.v1.Document.ITextAnchor;
export function normalizeFormatting(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}
export function resolveTextAnchor(text: string, anchor?: Anchor | null) {
  // Text anchors use Unicode character indices, not JS UTF-16 code units.
  const characters = Array.from(text);
  return (anchor?.textSegments ?? [])
    .map((segment) => {
      const start = Number(segment.startIndex ?? 0),
        end = Number(segment.endIndex ?? 0);
      return Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start >= 0 &&
        end >= start &&
        end <= characters.length
        ? characters.slice(start, end).join('')
        : '';
    })
    .join('');
}
export function normalizeDocument(document: Document) {
  const raw = document.text ?? '';
  const paragraphs = (document.pages ?? [])
    .flatMap((page) =>
      (page.paragraphs ?? []).map((paragraph) => {
        const confidence = paragraph.layout?.confidence;
        return {
          text: normalizeFormatting(
            resolveTextAnchor(raw, paragraph.layout?.textAnchor),
          ),
          ...(typeof confidence === 'number' &&
          Number.isFinite(confidence) &&
          confidence >= 0 &&
          confidence <= 1
            ? { confidence }
            : {}),
        };
      }),
    )
    .filter((p) => p.text.length > 0);
  // Insert paragraph boundaries only if anchors account for ALL transcribed text.
  // Otherwise keep document.text, including headings, footnotes and page numbers.
  const compact = (s: string) => s.replace(/\s/g, '');
  const structured = paragraphs.map((p) => p.text).join('\n\n');
  const text =
    paragraphs.length && compact(structured) === compact(raw)
      ? structured
      : normalizeFormatting(raw);
  const detectedLanguages = [
    ...new Set(
      (document.pages ?? [])
        .flatMap((p) => p.detectedLanguages ?? [])
        .flatMap((l) => (l.languageCode ? [l.languageCode] : [])),
    ),
  ];
  // Google provides layout confidence, not a meaningful document-wide score.
  return {
    provider: 'google-document-ai' as const,
    text,
    paragraphs,
    detectedLanguages,
  };
}
