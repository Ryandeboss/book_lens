import { expect, it } from 'vitest';
import {
  normalizeDocument,
  normalizeFormatting,
  resolveTextAnchor,
} from '../src/services/documentText.js';
it('derives a 0–100 token-character-weighted score only with complete scored coverage', () => {
  const document = {
    text: 'AB CDEFGH',
    pages: [
      {
        tokens: [
          {
            layout: {
              confidence: 0.7,
              textAnchor: { textSegments: [{ endIndex: 3 }] },
            },
          },
          {
            layout: {
              confidence: 0.9,
              textAnchor: { textSegments: [{ startIndex: 3, endIndex: 9 }] },
            },
          },
        ],
      },
    ],
  };
  expect(normalizeDocument(document)).toMatchObject({
    confidence: 85,
    confidenceMethod: 'token-character-weighted',
  });
  document.pages[0]!.tokens[1]!.layout.confidence = NaN;
  expect(normalizeDocument(document)).not.toHaveProperty('confidence');
  document.pages[0]!.tokens.pop();
  expect(normalizeDocument(document)).not.toHaveProperty('confidence');
});
it('resolves omitted start, multiple segments, long/string indices and Unicode characters', () => {
  expect(
    resolveTextAnchor('A\u{1f600} caf\u00e9 end', {
      textSegments: [{ endIndex: '2' }, { startIndex: 3, endIndex: 7 }],
    }),
  ).toBe('A\u{1f600}caf\u00e9');
  expect(
    resolveTextAnchor('abc', {
      textSegments: [{ startIndex: -1, endIndex: 8 }],
    }),
  ).toBe('');
});
it('retains document text if paragraph anchors omit a heading or footnote', () => {
  const result = normalizeDocument({
    text: 'Heading\nBody\n1',
    pages: [
      {
        paragraphs: [
          {
            layout: {
              textAnchor: { textSegments: [{ startIndex: 8, endIndex: 12 }] },
            },
          },
        ],
      },
    ],
  });
  expect(result.text).toBe('Heading\nBody\n1');
  expect(result.paragraphs).toEqual([{ text: 'Body' }]);
  expect(result).not.toHaveProperty('confidence');
});
it('normalizes line endings/trailing spaces without rewriting words, punctuation or line-wrap hyphens', () => {
  expect(
    normalizeFormatting('  Preface  \r\n\r\npartici-\r\npants  \r\n'),
  ).toBe('Preface\n\npartici-\npants');
  expect(normalizeDocument({ text: '' })).toEqual({
    provider: 'google-document-ai',
    text: '',
    paragraphs: [],
    detectedLanguages: [],
  });
});
