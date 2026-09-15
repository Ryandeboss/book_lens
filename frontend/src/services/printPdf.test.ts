import { afterEach, expect, it, vi } from 'vitest';
import { printPdf } from './printPdf';
afterEach(() => vi.restoreAllMocks());
it('prints included text in order, with safe Unicode content and page breaks', () => {
  const doc = document.implementation.createHTMLDocument();
  const preview = {
    document: doc,
    opener: window,
    focus: vi.fn(),
    print: vi.fn(),
  };
  vi.spyOn(window, 'open').mockReturnValue(preview as unknown as Window);
  printPdf(['Café 世界\n<script>alert(1)</script>', 'Second page']);
  expect([...doc.querySelectorAll('.page')].map((p) => p.textContent)).toEqual([
    'Café 世界\n<script>alert(1)</script>',
    'Second page',
  ]);
  expect(doc.querySelector('script')).toBeNull();
  expect(doc.querySelector('style')?.textContent).toContain(
    'break-before: page',
  );
  expect(preview.opener).toBeNull();
  expect(preview.print).toHaveBeenCalledTimes(1);
});
it('explains how to recover when pop-ups are blocked', () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  expect(() => printPdf(['Text'])).toThrow('Allow pop-ups');
});
