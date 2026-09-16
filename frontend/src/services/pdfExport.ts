import pdfMake from 'pdfmake/build/pdfmake';
import fonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// Loaded only when PDF is selected. Text and bundled fonts stay in the browser;
// no popup, print dialog, remote font or document upload is required.
export async function createPdf(pages: string[]): Promise<Blob> {
  const definition: TDocumentDefinitions = {
    info: { title: 'BookLens scan' },
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 50],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.35 },
    content: pages.map((text, i) => ({
      text: text.replace(/\r\n?/g, '\n') || ' ',
      ...(i ? { pageBreak: 'before' as const } : {}),
    })),
  };
  return new Promise((resolve, reject) => {
    // All fonts are local, so synchronous stream creation also lets layout
    // errors reach this promise instead of an unhandled callback rejection.
    const stream = pdfMake
      .createPdf(definition, undefined, undefined, fonts)
      .getStream();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    stream.on('data', (chunk: Uint8Array) =>
      chunks.push(new Uint8Array(chunk)),
    );
    stream.on('error', reject);
    stream.on('end', () =>
      resolve(new Blob(chunks, { type: 'application/pdf' })),
    );
    stream.end();
  });
}
