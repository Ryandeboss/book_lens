import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggerMessage, WorkerOptions } from 'tesseract.js';
import { useOcr } from './useOcr';

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }));
let wrapper: ReturnType<typeof mount>;
let ocr: ReturnType<typeof useOcr>;
let options: Partial<WorkerOptions>;
const worker = { recognize: mocks.recognize, terminate: mocks.terminate };
beforeEach(() => {
  mocks.createWorker.mockImplementation(async (_language, _engine, opts) => {
    options = opts;
    return worker;
  });
  mocks.recognize.mockResolvedValue({
    data: { text: 'Raw OCR', confidence: 91 },
  });
  mocks.terminate.mockResolvedValue(undefined);
  wrapper = mount({
    setup() {
      ocr = useOcr();
      return {};
    },
    template: '<div />',
  });
});
afterEach(() => {
  wrapper.unmount();
  vi.resetAllMocks();
});
describe('OCR worker lifecycle', () => {
  it('loads lazily and reuses one English worker for multiple pages', async () => {
    expect(mocks.createWorker).not.toHaveBeenCalled();
    const image = new Blob(['page']);
    expect(await ocr.recognize(image)).toEqual({
      rawText: 'Raw OCR',
      confidence: 91,
    });
    await ocr.recognize(image);
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.createWorker.mock.calls[0]?.slice(0, 2)).toEqual(['eng', 1]);
    expect(mocks.recognize).toHaveBeenCalledWith(image, {}, { text: true });
    expect(ocr.isProcessing.value).toBe(false);
    wrapper.unmount();
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
  });
  it('reflects real worker progress and blocks duplicate recognition', async () => {
    let resolve!: (value: unknown) => void;
    mocks.recognize.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = ocr.recognize(new Blob());
    await flushPromises();
    expect(ocr.isProcessing.value).toBe(true);
    options.logger!({
      status: 'recognizing text',
      progress: 0.82,
    } as LoggerMessage);
    expect(ocr.progress.value).toBe(82);
    expect(ocr.status.value).toBe('Recognizing text');
    expect(await ocr.recognize(new Blob())).toBeNull();
    resolve({ data: { text: '', confidence: 0 } });
    expect(await pending).toEqual({ rawText: '', confidence: 0 });
  });
  it('shows a retryable failure, terminates the failed worker, and can initialize again', async () => {
    mocks.recognize.mockRejectedValueOnce(new Error('technical error'));
    expect(await ocr.recognize(new Blob())).toBeNull();
    expect(ocr.error.value).toContain("couldn't read");
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
    expect(ocr.isProcessing.value).toBe(false);
    expect(await ocr.recognize(new Blob())).toEqual({
      rawText: 'Raw OCR',
      confidence: 91,
    });
    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
    expect(ocr.error.value).toBeNull();
  });
  it('handles initialization failure without getting stuck', async () => {
    mocks.createWorker.mockRejectedValueOnce(new Error('network'));
    expect(await ocr.recognize(new Blob())).toBeNull();
    expect(ocr.error.value).toContain("couldn't read");
    expect(ocr.isInitializing.value).toBe(false);
    expect(ocr.isProcessing.value).toBe(false);
  });
  it('terminates a late-created worker after navigation and ignores old progress', async () => {
    let resolve!: (value: unknown) => void;
    mocks.createWorker.mockImplementation((_lang, _engine, opts) => {
      options = opts;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const pending = ocr.recognize(new Blob());
    await flushPromises();
    expect(ocr.isInitializing.value).toBe(true);
    wrapper.unmount();
    expect(await pending).toBeNull();
    resolve(worker);
    await flushPromises();
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
    expect(mocks.recognize).not.toHaveBeenCalled();
    options.logger!({
      status: 'recognizing text',
      progress: 0.9,
    } as LoggerMessage);
    expect(ocr.progress.value).toBeNull();
  });
  it('settles recognition on cancellation even if the library leaves the job pending', async () => {
    mocks.recognize.mockReturnValue(new Promise(() => {}));
    const pending = ocr.recognize(new Blob());
    await flushPromises();
    await ocr.terminate();
    expect(await pending).toBeNull();
    expect(ocr.isProcessing.value).toBe(false);
  });
});
