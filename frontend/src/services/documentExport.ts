// A small, uncompressed ZIP/OOXML writer for plain-text documents. No images,
// macros, external links, or remote service are involved in a DOCX export.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string, string>) {
  const local: Uint8Array<ArrayBuffer>[] = [],
    central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0,
    directorySize = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path),
      data = encoder.encode(content),
      crc = crc32(data);
    const header = new Uint8Array(30 + name.length),
      view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8, stored (no compression).
    view.setUint16(12, 33, true); // 1980-01-01
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    local.push(header, data);
    const entry = new Uint8Array(46 + name.length),
      c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    entry.set(header.subarray(4, 30), 6);
    c.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += header.length + data.length;
    directorySize += entry.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
function xml(text: string) {
  return Array.from(text)
    .filter((char) => {
      const c = char.codePointAt(0)!;
      return (
        c === 9 ||
        c === 10 ||
        c === 13 ||
        (c >= 32 && c <= 0xd7ff) ||
        (c >= 0xe000 && c <= 0xfffd) ||
        c >= 0x10000
      );
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
export function createDocx(pages: string[]): Blob {
  const body = pages
    .map((page, pageIndex) =>
      page
        .replace(/\r\n?/g, '\n')
        .split(/\n[\t ]*\n+/)
        .map(
          (paragraph, i) =>
            `<w:p><w:pPr>${pageIndex > 0 && i === 0 ? '<w:pageBreakBefore/>' : ''}<w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>${paragraph
              .split('\n')
              .map(
                (line, j) =>
                  `<w:r>${j ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`,
              )
              .join('')}</w:p>`,
        )
        .join(''),
    )
    .join('');
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip({
    '[Content_Types].xml': `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `${declaration}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  });
}
