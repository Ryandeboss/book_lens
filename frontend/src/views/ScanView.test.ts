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
const getUserMedia = vi.fn(),
  stop = vi.fn(),
  drawImage = vi.fn();
const engine = { recognize: vi.fn(), terminate: vi.fn(async () => {}) };
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vision.analyze.mockResolvedValue(page());
  vision.process.mockResolvedValue({
    blob: new Blob(['page']),
    fingerprint: [0.1, -0.1],
    width: 800,
    height: 1100,
  });
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
    paused: { value: false },
  });
  await video.trigger('playing');
  await flushPromises();
  return video;
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flushPromises();
}
describe('continuous scan screen', () => {
  it('automatically captures at source resolution, keeps text out of scan, and locks the held page', async () => {
    expect(wrapper.find('video').exists()).toBe(false);
    const video = await ready();
    expect(vision.process).not.toHaveBeenCalled();
    await advance(1100);
    expect(useScanStore().pages).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledWith(video.element, 0, 0, 1920, 1080);
    expect(wrapper.text()).toContain('1 captured');
    expect(wrapper.find('textarea').exists()).toBe(false);
    await advance(3000);
    expect(vision.process).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-state]').attributes('data-state')).toBe(
      'waitingForPageChange',
    );
  });
  it('pauses automatic capture but manual capture refreshes geometry and uses the guide fallback', async () => {
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
    expect(vision.process).toHaveBeenCalledWith(expect.anything(), null, []);
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
    expect(useScanStore().pages).toHaveLength(1);
    expect(engine.recognize).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Already scanned');
  });
  it('Done stops acceptance and camera immediately, drains OCR, then opens Review', async () => {
    let complete!: (result: OcrResult) => void;
    engine.recognize.mockReturnValue(
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
    expect(wrapper.text()).toContain('Finishing scan');
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
    vision.analyze.mockRejectedValueOnce(new Error('worker failed'));
    await ready();
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
    engine.recognize.mockReturnValue(
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

it('freezes the accepted region during green feedback while OCR remains pending', async () => {
  engine.recognize.mockReturnValue(new Promise(() => {}));
  const initial = page();
  initial.textBody = initial.corners;
  vision.analyze.mockResolvedValue(initial);
  await ready();
  await advance(900);
  expect(wrapper.get('[data-state]').attributes('data-state')).toBe('captured');
  const shape = wrapper.get('.accepted-region').attributes('points');
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
it('rejects an older duplicate without consuming a page number, then accepts a distinct page', async () => {
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
  expect(useScanStore().pages.map((p) => p.pageNumber)).toEqual([1, 2]);
  expect(engine.recognize).toHaveBeenCalledTimes(2);
});

it('automatically scans text without page edges and shows progress before green feedback', async () => {
  const d: Detection = {
    ...page(),
    source: 'text',
    corners: null,
    textBody: page().corners,
  };
  vision.analyze.mockResolvedValue(d);
  engine.recognize.mockReturnValue(new Promise(() => {}));
  await ready();
  await advance(340);
  expect(wrapper.find('.scan-sweep').exists()).toBe(true);
  expect(wrapper.get('progress').attributes('aria-label')).toBe(
    'Automatic capture progress',
  );
  expect(vision.process).not.toHaveBeenCalled();
  await advance(560);
  expect(vision.process).toHaveBeenCalledOnce();
  expect(vision.process).toHaveBeenCalledWith(expect.anything(), null, []);
  expect(wrapper.get('[data-state]').attributes('data-state')).toBe('captured');
  expect(wrapper.find('.accepted-region').exists()).toBe(true);
  expect(useScanStore().pages[0]?.status).toBe('processing');
  await advance(5000);
  expect(useScanStore().pages).toHaveLength(1);
});
