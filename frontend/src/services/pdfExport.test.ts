// @vitest-environment node
import { expect, it } from 'vitest';
import { createPdf } from './pdfExport';

it('generates a complete PDF with embedded fonts and captured-page breaks', async () => {
  const blob = await createPdf([
    'Café — first page.\n\nSecond paragraph.',
    'Second captured page.',
  ]);
  const data = Buffer.from(await blob.arrayBuffer());
  const source = data.toString('latin1');
  expect(blob.type).toBe('application/pdf');
  expect(source.startsWith('%PDF-')).toBe(true);
  expect(source.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(source.match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(source).toContain('/FontFile2');
});
it('flows a long captured page onto multiple PDF pages without a print dialog', async () => {
  const blob = await createPdf([
    'A paragraph of readable book text.\n'.repeat(150),
  ]);
  const source = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  expect(source.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
});
