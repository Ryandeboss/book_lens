import { expect, it } from 'vitest';
import { createDocx } from './documentExport';
it('creates an actual DOCX ZIP with escaped Unicode text, paragraphs and page breaks', async () => {
  const blob = createDocx([
    'Café & <garden> 🌱\nSoft line\n\nNew paragraph',
    'Second page\u0000',
  ]);
  const buffer = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer),
    files: Record<string, string> = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true),
      namesize = view.getUint16(offset + 26, true);
    const start = offset + 30 + namesize;
    files[new TextDecoder().decode(bytes.subarray(offset + 30, start))] =
      new TextDecoder().decode(bytes.subarray(start, start + size));
    offset = start + size;
  }
  expect(blob.type).toContain('wordprocessingml');
  expect(Object.keys(files)).toEqual([
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
  ]);
  expect(files['word/document.xml']).toContain('Café &amp; &lt;garden&gt; 🌱');
  expect(files['word/document.xml']).toContain('<w:br/>');
  expect(files['word/document.xml']).toContain('<w:pageBreakBefore/>');
  expect(files['word/document.xml']).not.toContain('\u0000');
  const xml = new DOMParser().parseFromString(
    files['word/document.xml']!,
    'application/xml',
  );
  expect(xml.querySelector('parsererror')).toBeNull();
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
});
