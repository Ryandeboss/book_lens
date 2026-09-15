vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getProofreadStatus: vi.fn(async () => true),
}));
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScanView from './ScanView.vue';
import { useScanStore } from '../stores/scan';
import { ocrQueueKey } from '../composables/useOcrQueue';
import { createOcrQueue } from '../services/ocrQueue';
import type { Detection } from '../types/scanner';
import type { OcrResult } from '../types/Page';

const vision = vi.hoisted(() => ({
  analyze: vi.fn(),
  process: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock('../composables/usePageDetection', () => ({
  usePageDetection: () => vision,
}));
const stillMode = vi.hoisted(() => ({ source: 'video' as 'photo' | 'video' }));
vi.mock('../services/stillCapture', () => ({
  canvasFrame: (canvas: HTMLCanvasElement, pixels = false) =>
    pixels
      ? Promise.resolve({
          data: new Uint8ClampedArray(16),
          width: 2,
          height: 2,
        })
      : createImageBitmap(canvas),
  captureStill: async (video: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas
      .getContext('2d')!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    return { blob: new Blob(['frame']), source: stillMode.source };
  },
  decodeStill: async () => {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    return c;
  },
}));
const getUserMedia = vi.fn(),
  stop = vi.fn(),
  drawImage = vi.fn();
const engine = {
  inspect: (image: Blob, id: string) => engine.recognize(image, id),
  recognize: vi.fn(),
  refine: vi.fn<(result: OcrResult, id: string) => Promise<OcrResult | null>>(),
  terminate: vi.fn(async () => {}),
};
let wrapper: ReturnType<typeof mount>;
let router: ReturnType<typeof createRouter>;
let queue: ReturnType<typeof createOcrQueue>;
const page = (): Detection => ({
  corners: [
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.9 },
    { x: 0.2, y: 0.9 },
  ],
  aligned: true,
  alignment: 1,
  sharpness: 100,
  brightness: 190,
  signature: [0.1, -0.1],
});
beforeEach(async () => {
  stillMode.source = 'video';
  vision.terminate.mockReset();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vision.analyze.mockResolvedValue(page());
  vision.process.mockResolvedValue({
    blob: new Blob(['page']),
    fingerprint: [0.1, -0.1],
    width: 800,
    height: 1100,
  });
  engine.refine.mockImplementation(async (result) => result);
  engine.recognize.mockResolvedValue({
    rawText: 'Recognized words',
    confidence: 90,
  });
  vi.stubGlobal('isSecureContext', true);
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop });
  getUserMedia.mockResolvedValue({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ close: vi.fn() })),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const pinia = createPinia();
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/scan', component: ScanView },
      { path: '/review', component: { template: '<p>Review</p>' } },
    ],
  });
  await router.push('/scan');
  queue = createOcrQueue(useScanStore(pinia), engine);
  wrapper = mount(ScanView, {
    global: {
      plugins: [pinia, router],
      provide: { [ocrQueueKey as symbol]: queue },
    },
  });
});
afterEach(async () => {
  wrapper.unmount();
  await queue.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
function button(label: string) {
  const found = wrapper.findAll('button').find((b) => b.text() === label);
  if (!found) throw new Error('Missing ' + label);
  return found;
}
async function ready() {
  await button('Start Camera').trigger('click');
  await flushPromises();
  const video = wrapper.get('video');
  Object.defineProperties(video.element, {
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
    readyState: { value: 2 },
    paused: { value: false, configurable: true },
  });
  await video.trigger('playing');
  await flushPromises();
  return video;
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flushPromises();
}
it('keeps the AI option visible and explains background OCR', async () => {
  expect(wrapper.text()).not.toContain('80%');
  expect(wrapper.text()).toContain(
    'OCR and AI cleanup continue in the background',
  );
  await ready();
  expect(wrapper.find('.cleanup-options input').exists()).toBe(true);
});
it('waits on an oblique page without reserving or uploading a photo, then captures when straightened', async () => {
  vision.analyze.mockResolvedValue({
    ...page(),
    aligned: false,
    gate: 'angle',
    textPresent: true,
  });
  await ready();
  await advance(2000);
  expect(wrapper.text()).toContain('Hold the phone parallel to the page');
  expect(useScanStore().pages).toHaveLength(0);
  expect(vision.process).not.toHaveBeenCalled();
  expect(engine.recognize).not.toHaveBeenCalled();
  vision.analyze.mockResolvedValue(page());
  await advance(650);
  expect(useScanStore().pages[0]?.capturePosition).toBe(1);
});

it('rechecks the native still angle before queuing a photo', async () => {
  stillMode.source = 'photo';
  vision.analyze.mockImplementation(async (_frame: unknown, still?: boolean) =>
    still ? { ...page(), aligned: false, gate: 'angle' } : page(),
  );
  await ready();
  await advance(700);
  expect(useScanStore().pages).toHaveLength(0);
  expect(vision.process).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('Hold the phone parallel to the page');
});

it('saves and flashes green before OCR finishes, then queues the next photo', async () => {
  let complete!: (result: OcrResult) => void;
  engine.recognize.mockReturnValue(
    new Promise<OcrResult>((resolve) => {
      complete = resolve;
    }),
  );
  await ready();
  await advance(600);
  expect(useScanStore().pages).toHaveLength(1);
  expect(wrapper.find('.accepted-region').exists()).toBe(true);
  expect(wrapper.text()).toContain('OCR queued');
  await advance(3000);
  expect(useScanStore().pages).toHaveLength(2);
  expect(engine.recognize).toHaveBeenCalledOnce();
  await button('Pause').trigger('click');
  complete({ rawText: 'Read this page', confidence: 85 });
  await flushPromises();
  expect(useScanStore().pages[0]).toMatchObject({
    capturePosition: 1,
    confidence: 85,
  });
  expect(wrapper.get('.ocr-confidence').text()).toContain('85.0%');
});

it('waits on a focused non-text object without reserving a page or calling OCR, then captures text normally', async () => {
  vision.analyze.mockResolvedValue({
    ...page(),
    source: 'page',
    textPresent: false,
    aligned: false,
    gate: 'text',
    hint: 'textRequired',
  });
  await ready();
  await advance(3000);
  expect(wrapper.text()).toContain('Point the camera at printed text');
  expect(useScanStore().pages).toHaveLength(0);
  expect(vision.process).not.toHaveBeenCalled();
  expect(engine.recognize).not.toHaveBeenCalled();

  vision.analyze.mockResolvedValue({ ...page(), textPresent: true });
  await advance(650);
  expect(useScanStore().pages).toHaveLength(1);
  expect(useScanStore().pages[0]?.capturePosition).toBe(1);
  expect(vision.process).toHaveBeenCalledOnce();
});
it.each([79.99, undefined])(
  'keeps a photo with %s confidence without pausing capture',
  async (confidence) => {
    engine.recognize.mockResolvedValue({
      rawText: 'Uncertain page',
      confidence,
    });
    await ready();
    await advance(1100);
    expect(useScanStore().pages).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Shot not saved');
    expect(wrapper.get('.ocr-confidence').text()).toContain(
      confidence === undefined ? 'unavailable (not 0%)' : '79.9%',
    );
    await advance(3000);
    expect(useScanStore().pages).toHaveLength(2);
  },
);
it('Done stops capture and waits for OCR already queued', async () => {
  let complete!: (result: OcrResult) => void;
  engine.recognize.mockReturnValue(
    new Promise<OcrResult>((resolve) => {
      complete = resolve;
    }),
  );
  await ready();
  await advance(1100);
  await button('Done').trigger('click');
  expect(useScanStore().pages).toHaveLength(1);
  expect(router.currentRoute.value.path).toBe('/scan');
  complete({ rawText: 'Queued result', confidence: 99 });
  await flushPromises();
  expect(useScanStore().pages[0]?.rawText).toBe('Queued result');
  expect(router.currentRoute.value.path).toBe('/review');
});
it('captures focused text without paper margins and sends the whole image', async () => {
  vision.analyze.mockResolvedValue({
    ...page(),
    source: 'guide',
    corners: null,
    captureCorners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  });
  await ready();
  await advance(1100);
  expect(useScanStore().pages).toHaveLength(1);
  expect(vision.process).toHaveBeenCalledWith(
    expect.anything(),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    [],
    null,
  );
});
describe('continuous scan screen', () => {
  it('automatically saves source-resolution photos and waits two seconds before looking again', async () => {
    expect(wrapper.find('video').exists()).toBe(false);
    const video = await ready();
    expect(vision.process).not.toHaveBeenCalled();
    await advance(1100);
    expect(useScanStore().pages).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledWith(video.element, 0, 0, 1920, 1080);
    expect(wrapper.text()).toContain('1 shots saved');
    expect(wrapper.find('textarea').exists()).toBe(false);
    const analyses = vision.analyze.mock.calls.length;
    await advance(900);
    expect(vision.process).toHaveBeenCalledOnce();
    expect(vision.analyze).toHaveBeenCalledTimes(analyses);
    expect(wrapper.get('[data-state]').attributes('data-state')).toBe(
      'cooldown',
    );
    await advance(2000);
    expect(vision.process).toHaveBeenCalledTimes(2);
  });
  it('pauses automatic capture but manual capture preserves the full camera image', async () => {
    await ready();
    await button('Pause').trigger('click');
    await advance(2000);
    expect(vision.process).not.toHaveBeenCalled();
    vision.analyze.mockResolvedValue({
      ...page(),
      corners: null,
      aligned: false,
    });
    await button('Manual Capture').trigger('click');
    await flushPromises();
    expect(vision.process).toHaveBeenCalledWith(
      expect.anything(),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      [],
      null,
    );
    expect(wrapper.find('.accepted-region').exists()).toBe(true);
    expect(useScanStore().pages).toHaveLength(1);
    vision.process.mockResolvedValueOnce({
      blob: new Blob(['duplicate']),
      fingerprint: [0.1, -0.1],
      duplicateMatch: { duplicate: true, pageNumber: 1, gray: 0 },
      width: 800,
      height: 1100,
    });
    await button('Manual Capture').trigger('click');
    await flushPromises();
    expect(useScanStore().pages).toHaveLength(2);
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Shot 2 saved');
  });
  it('Done stops acceptance and camera immediately, drains OCR, then opens Review', async () => {
    let complete!: (result: OcrResult) => void;
    engine.refine.mockReturnValue(
      new Promise<OcrResult>((done) => {
        complete = done;
      }),
    );
    await ready();
    await advance(1100);
    expect(useScanStore().pages[0]?.status).toBe('processing');
    await button('Done').trigger('click');
    await flushPromises();
    expect(stop).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Finishing your text');
    expect(router.currentRoute.value.path).toBe('/scan');
    await advance(2000);
    expect(useScanStore().pages).toHaveLength(1);
    complete({ rawText: 'Finished' });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/review');
    expect(engine.terminate).toHaveBeenCalledOnce();
  });
  it('Stop Camera and navigation terminate analysis; restart starts a fresh loop', async () => {
    await ready();
    await button('Stop Camera').trigger('click');
    expect(stop).toHaveBeenCalledOnce();
    expect(wrapper.find('video').exists()).toBe(false);
    const calls = vision.analyze.mock.calls.length;
    await advance(1000);
    expect(vision.analyze).toHaveBeenCalledTimes(calls);
    await ready();
    await advance(1100);
    expect(useScanStore().pages).toHaveLength(1);
    wrapper.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(vision.terminate).toHaveBeenCalled();
  });
  it('explains permission denial and worker failure, with an explicit Resume recovery', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'));
    await button('Start Camera').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'permission was denied',
    );
    vision.analyze
      .mockRejectedValueOnce(new Error('worker failed'))
      .mockRejectedValueOnce(new Error('worker failed'));
    await ready();
    await advance(1);
    expect(wrapper.get('[data-state]').attributes('data-state')).toBe('error');
    const calls = vision.analyze.mock.calls.length;
    await advance(2000);
    expect(vision.analyze).toHaveBeenCalledTimes(calls);
    await button('Resume').trigger('click');
    await advance(1100);
    expect(useScanStore().pages).toHaveLength(1);
  });
  it('does not navigate or terminate another scanner after leaving a pending Done', async () => {
    let complete!: (result: OcrResult) => void;
    engine.refine.mockReturnValue(
      new Promise<OcrResult>((done) => {
        complete = done;
      }),
    );
    await ready();
    await advance(1100);
    await button('Done').trigger('click');
    await flushPromises();
    const navigate = vi.spyOn(router, 'push');
    wrapper.unmount();
    complete({ rawText: 'Kept after navigation' });
    await flushPromises();
    expect(useScanStore().pages[0]?.rawText).toBe('Kept after navigation');
    expect(navigate).not.toHaveBeenCalled();
    expect(engine.terminate).not.toHaveBeenCalled();
  });
  it('pauses when backgrounded and requires Resume', async () => {
    await ready();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(2000);
    expect(vision.process).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('background');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(2000);
    expect(vision.process).not.toHaveBeenCalled();
    await button('Resume').trigger('click');
    await advance(1100);
    expect(useScanStore().pages).toHaveLength(1);
  });
});

it('uses the fixed full-frame animation even when detected text covers a smaller region', async () => {
  engine.refine.mockReturnValue(new Promise(() => {}));
  const initial = page();
  initial.textBody = initial.corners;
  vision.analyze.mockResolvedValue(initial);
  await ready();
  await advance(650);
  expect(wrapper.get('[data-state]').attributes('data-state')).toBe('captured');
  const shape = wrapper.get('.accepted-region').attributes('points');
  expect(shape).toBe('0,0 1920,0 1920,1080 0,1080');
  expect(wrapper.find('.text-body').exists()).toBe(false);
  vision.analyze.mockResolvedValue({
    ...page(),
    corners: null,
    textBody: null,
  });
  await advance(170);
  expect(wrapper.get('.accepted-region').attributes('points')).toBe(shape);
  expect(useScanStore().pages[0]?.status).toBe('processing');
  await advance(600);
  expect(wrapper.find('.accepted-region').exists()).toBe(false);
});
it('saves visually similar photos for later text comparison without losing shot positions', async () => {
  await ready();
  await button('Pause').trigger('click');
  await button('Manual Capture').trigger('click');
  await flushPromises();
  vision.process.mockResolvedValueOnce({
    blob: new Blob(['duplicate']),
    fingerprint: [0.1, -0.1],
    duplicateMatch: { duplicate: true, pageNumber: 1, gray: 0 },
    width: 800,
    height: 1100,
  });
  await button('Manual Capture').trigger('click');
  await flushPromises();
  await button('Manual Capture').trigger('click');
  await flushPromises();
  expect(useScanStore().pages.map((p) => p.capturePosition)).toEqual([1, 2, 3]);
  expect(engine.recognize).toHaveBeenCalledTimes(3);
});

it('automatically scans text without page edges and shows progress before green feedback', async () => {
  const d: Detection = {
    ...page(),
    source: 'text',
    corners: null,
    textBody: page().corners,
  };
  vision.analyze.mockResolvedValue(d);
  engine.refine.mockReturnValue(new Promise(() => {}));
  await ready();
  await advance(170);
  expect(wrapper.find('.scan-sweep').exists()).toBe(true);
  expect(wrapper.get('progress').attributes('aria-label')).toBe(
    'Automatic capture progress',
  );
  expect(vision.process).not.toHaveBeenCalled();
  await advance(560);
  expect(vision.process).toHaveBeenCalledOnce();
  expect(vision.process).toHaveBeenCalledWith(
    expect.anything(),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    [],
    null,
  );
  expect(wrapper.get('[data-state]').attributes('data-state')).toBe('captured');
  expect(wrapper.find('.accepted-region').exists()).toBe(true);
  expect(useScanStore().pages[0]?.status).toBe('processing');
  await advance(5000);
  expect(useScanStore().pages).toHaveLength(3);
  expect(useScanStore().pages.map((p) => p.status)).toEqual([
    'processing',
    'queued',
    'queued',
  ]);
});

it('invalidates an in-flight analysis across Pause and immediate Resume', async () => {
  let complete!: (d: Detection) => void;
  vision.analyze.mockImplementationOnce(
    () =>
      new Promise<Detection>((r) => {
        complete = r;
      }),
  );
  await ready();
  await advance(1);
  await button('Pause').trigger('click');
  await button('Resume').trigger('click');
  complete({ ...page(), sharpness: 0 });
  await flushPromises();
  expect(wrapper.text()).not.toContain('blurry');
  await advance(1100);
  expect(useScanStore().pages).toHaveLength(1);
});
it.each(['Pause', 'Done', 'Stop Camera'])(
  'discards pending image processing after %s',
  async (action) => {
    let complete!: (value: unknown) => void;
    vision.process.mockImplementationOnce(
      () =>
        new Promise((r) => {
          complete = r;
        }),
    );
    await ready();
    await advance(800);
    expect(vision.process).toHaveBeenCalledOnce();
    await button(action).trigger('click');
    complete({
      blob: new Blob(['late']),
      fingerprint: [0.1],
      width: 800,
      height: 1100,
    });
    await flushPromises();
    expect(useScanStore().pages).toHaveLength(0);
  },
);
it('schedules on video frames and never overlaps a busy worker', async () => {
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let id = 0;
  Object.defineProperty(
    HTMLVideoElement.prototype,
    'requestVideoFrameCallback',
    {
      configurable: true,
      value: (cb: VideoFrameRequestCallback) => {
        callbacks.set(++id, cb);
        return id;
      },
    },
  );
  Object.defineProperty(
    HTMLVideoElement.prototype,
    'cancelVideoFrameCallback',
    { configurable: true, value: (key: number) => callbacks.delete(key) },
  );
  try {
    let complete!: (d: Detection) => void;
    vision.analyze.mockImplementationOnce(
      () =>
        new Promise<Detection>((r) => {
          complete = r;
        }),
    );
    await ready();
    expect(vision.analyze).not.toHaveBeenCalled();
    const cb = callbacks.get(id)!;
    callbacks.delete(id);
    cb(170, {} as VideoFrameCallbackMetadata);
    await flushPromises();
    expect(vision.analyze).toHaveBeenCalledOnce();
    await advance(1000);
    expect(vision.analyze).toHaveBeenCalledOnce();
    complete(page());
    await flushPromises();
    expect(callbacks.size).toBe(1);
    await button('Pause').trigger('click');
    expect(callbacks.size).toBe(0);
  } finally {
    Reflect.deleteProperty(
      HTMLVideoElement.prototype,
      'requestVideoFrameCallback',
    );
    Reflect.deleteProperty(
      HTMLVideoElement.prototype,
      'cancelVideoFrameCallback',
    );
  }
});

it('checks native photo focus and preserves the entire photo despite different preview corners', async () => {
  stillMode.source = 'photo';
  const native = {
    ...page(),
    corners: page().corners!.map((p) => ({
      x: p.x * 0.8 + 0.05,
      y: p.y * 0.9 + 0.03,
    })) as Detection['corners'],
  };
  vision.analyze.mockImplementation(async (_frame: unknown, still?: boolean) =>
    still ? native : page(),
  );
  await ready();
  await advance(900);
  expect(vision.process).toHaveBeenCalledWith(
    expect.anything(),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    [],
    null,
  );
  expect(useScanStore().pages).toHaveLength(1);
});

it('recovers automatically when the worker cannot read bitmaps but can read pixels', async () => {
  vision.analyze.mockImplementation(async (frame: unknown) => {
    if (!('data' in (frame as object)))
      throw new Error('Bitmap context unavailable');
    return page();
  });
  await ready();
  await advance(1000);
  expect(vision.terminate).toHaveBeenCalled();
  expect(useScanStore().pages).toHaveLength(1);
});
it('Resume replaces a failed worker and restarts a paused video', async () => {
  let broken = true;
  vision.analyze.mockImplementation(async () => {
    if (broken) throw new Error('runtime rejected');
    return page();
  });
  const video = await ready();
  await advance(1);
  expect(wrapper.get('[data-state]').attributes('data-state')).toBe('error');
  Object.defineProperty(video.element, 'paused', {
    value: true,
    configurable: true,
  });
  const plays = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
  vision.terminate.mockImplementation(() => {
    broken = false;
  });
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(async () => {
    Object.defineProperty(video.element, 'paused', {
      value: false,
      configurable: true,
    });
  });
  await button('Resume').trigger('click');
  await advance(800);
  expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(
    plays + 1,
  );
  expect(useScanStore().pages).toHaveLength(1);
});
it('does not restart after Stop while Resume is waiting for video playback', async () => {
  const video = await ready();
  await advance(1);
  await button('Pause').trigger('click');
  Object.defineProperty(video.element, 'paused', {
    value: true,
    configurable: true,
  });
  let complete!: () => void;
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
    () =>
      new Promise<void>((r) => {
        complete = r;
      }),
  );
  await button('Resume').trigger('click');
  await button('Stop Camera').trigger('click');
  const calls = vision.analyze.mock.calls.length;
  complete();
  await flushPromises();
  await advance(1000);
  expect(vision.analyze).toHaveBeenCalledTimes(calls);
  expect(useScanStore().pages).toHaveLength(0);
});
