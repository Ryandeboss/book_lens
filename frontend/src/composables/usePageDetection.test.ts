import { mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { usePageDetection } from './usePageDetection';
import { scannerConfig } from '../config/scanner';
let wrapper: ReturnType<typeof mount>;
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
  };
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return worker;
      }
    },
  );
  let vision!: ReturnType<typeof usePageDetection>;
  wrapper = mount({
    setup() {
      vision = usePageDetection();
    },
    template: '<div />',
  });
  return { worker, vision };
}
it('transfers frames, correlates results and releases pending work on unmount', async () => {
  const { worker, vision } = setup();
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const result = vision.analyze(bitmap);
  expect(worker.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1, type: 'analyze', bitmap }),
    [bitmap],
  );
  worker.onmessage!({
    data: { id: 1, result: { corners: null } },
  } as MessageEvent);
  expect(await result).toEqual({ corners: null });
  const pending = vision.analyze(bitmap);
  const rejection = expect(pending).rejects.toThrow('stopped');
  wrapper.unmount();
  await rejection;
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('times out stalled workers and creates a fresh worker on retry', async () => {
  vi.useFakeTimers();
  const { worker, vision } = setup();
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  const pending = vision.analyze(bitmap);
  const rejection = expect(pending).rejects.toThrow('stopped');
  await vi.advanceTimersByTimeAsync(scannerConfig.workerTimeoutMs);
  await rejection;
  const retry = vision.analyze(bitmap);
  worker.onmessage!({
    data: { id: 2, result: { corners: null } },
  } as MessageEvent);
  expect(await retry).toEqual({ corners: null });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('closes an untransferred bitmap if worker startup or postMessage fails', async () => {
  const { worker, vision } = setup();
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  worker.postMessage.mockImplementationOnce(() => {
    throw new Error('transfer failed');
  });
  await expect(vision.analyze(bitmap)).rejects.toThrow('transfer failed');
  expect(bitmap.close).toHaveBeenCalledOnce();
  vision.terminate();
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('unsupported');
      }
    },
  );
  await expect(vision.analyze(bitmap)).rejects.toThrow('unsupported');
  expect(bitmap.close).toHaveBeenCalledTimes(2);
});
