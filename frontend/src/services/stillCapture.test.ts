import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureStill, canvasFrame, encodePixels } from './stillCapture';
import { scannerConfig } from '../config/scanner';
const drawImage = vi.fn(),
  putImageData = vi.fn();
const blob = new Blob(['photo'], { type: 'image/jpeg' });
const track = { readyState: 'live' };
const video = {
  srcObject: { getVideoTracks: () => [track] },
  videoWidth: 1920,
  videoHeight: 1080,
  readyState: 2,
  paused: false,
} as unknown as HTMLVideoElement;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    putImageData,
    getImageData: () => ({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(blob),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
it('uses one native takePhoto call from the existing live video track', async () => {
  const takePhoto = vi.fn(async () => blob),
    construct = vi.fn();
  vi.stubGlobal(
    'ImageCapture',
    class {
      constructor(t: unknown) {
        construct(t);
      }
      takePhoto = takePhoto;
    },
  );
  expect(await captureStill(video, () => true)).toEqual({
    blob,
    source: 'photo',
  });
  expect(construct).toHaveBeenCalledWith(track);
  expect(takePhoto).toHaveBeenCalledOnce();
  expect(drawImage).not.toHaveBeenCalled();
});
it.each(['missing', 'failure', 'empty'])(
  'uses actual video resolution when native photo is %s',
  async (kind) => {
    vi.stubGlobal(
      'ImageCapture',
      kind === 'missing'
        ? undefined
        : class {
            async takePhoto() {
              if (kind === 'failure') throw new Error('unsupported device');
              return new Blob([]);
            }
          },
    );
    expect((await captureStill(video, () => true)).source).toBe('video');
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  },
);
it('times out a hanging shutter once, then falls back without another native call', async () => {
  vi.useFakeTimers();
  const takePhoto = vi.fn(() => new Promise<Blob>(() => {}));
  vi.stubGlobal(
    'ImageCapture',
    class {
      takePhoto = takePhoto;
    },
  );
  const result = captureStill(video, () => true);
  await vi.advanceTimersByTimeAsync(scannerConfig.stillTimeoutMs);
  expect((await result).source).toBe('video');
  expect(takePhoto).toHaveBeenCalledOnce();
});
it('discards a late photo after cancellation without taking a fallback frame', async () => {
  let resolve!: (b: Blob) => void;
  let valid = true;
  vi.stubGlobal(
    'ImageCapture',
    class {
      takePhoto = () =>
        new Promise<Blob>((r) => {
          resolve = r;
        });
    },
  );
  const result = captureStill(video, () => valid);
  const assertion = expect(result).rejects.toThrow('stopped');
  valid = false;
  resolve(blob);
  await assertion;
  expect(drawImage).not.toHaveBeenCalled();
});
it('transfers ordinary canvas pixels when OffscreenCanvas is unavailable', async () => {
  vi.stubGlobal('OffscreenCanvas', undefined);
  const result = await canvasFrame(document.createElement('canvas'));
  expect(result).toMatchObject({
    width: 2,
    height: 2,
    data: expect.any(Uint8ClampedArray),
  });
});
it('encodes worker pixels using canvas and releases the canvas backing store', async () => {
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  expect(
    await encodePixels({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    }),
  ).toBe(blob);
  expect(putImageData).toHaveBeenCalledOnce();
  expect(
    (
      vi.mocked(HTMLCanvasElement.prototype.toBlob).mock
        .instances[0] as HTMLCanvasElement
    ).width,
  ).toBe(1);
});
