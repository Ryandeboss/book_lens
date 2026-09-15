// Native browser PDF printing preserves Unicode using the device's fonts and
// handles long documents without adding a rendering library to the scanner.
export function printPdf(pages: string[]): void {
  const preview = window.open('', '_blank');
  if (!preview)
    throw new Error('Allow pop-ups for BookLens to open the PDF preview.');
  preview.opener = null;
  const doc = preview.document;
  doc.open();
  doc.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>booklens-scan</title></head><body></body></html>',
  );
  doc.close();
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: A4; margin: 18mm; }
    body { margin: 24px auto; max-width: 760px; padding: 0 20px; color: #17251d; font: 12pt/1.6 Georgia, serif; }
    .page { white-space: pre-wrap; overflow-wrap: anywhere; margin: 32px 0; }
    .tools { font: 14px/1.5 system-ui, sans-serif; padding: 16px; background: #edf2eb; border-radius: 8px; }
    button { cursor: pointer; padding: 10px 18px; }
    @media print {
      body { max-width: none; margin: 0; padding: 0; color: #000; }
      .tools { display: none; }
      .page { margin: 0; }
      .page + .page { break-before: page; }
    }`;
  doc.head.append(style);
  const tools = doc.createElement('div');
  tools.className = 'tools';
  const hint = doc.createElement('p');
  hint.textContent =
    'Choose “Save as PDF” in the print dialog. For a clean document, turn off headers and footers.';
  const button = doc.createElement('button');
  button.textContent = 'Save as PDF';
  button.onclick = () => preview.print();
  tools.append(hint, button);
  doc.body.append(tools);
  for (const text of pages) {
    const page = doc.createElement('section');
    page.className = 'page';
    // Never interpret OCR or edited text as HTML.
    page.textContent = text;
    doc.body.append(page);
  }
  preview.focus();
  preview.print();
}
