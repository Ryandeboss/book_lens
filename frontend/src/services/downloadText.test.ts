import { afterEach, expect, it, vi } from 'vitest';
import { downloadText } from './downloadText';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('downloads UTF-8 text and releases the temporary link and URL after consumption starts', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:text');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename = this.download;
  });
  downloadText('Café — one\n\n\n二');
  const blob = createObjectURL.mock.calls[0]![0] as Blob;
  expect(blob.type).toBe('text/plain;charset=utf-8');
  const content = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(content).toBe('Café — one\n\n\n二');
  expect(filename).toBe('booklens-scan.txt');
  expect(document.querySelector('a[download]')).toBeNull();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:text');
});
