import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanView from './ScanView.vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useScanStore } from '../stores/scan';

const ocrMocks = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: ocrMocks.recognize,
    terminate: ocrMocks.terminate,
  })),
}));

const getUserMedia = vi.fn();
const stop = vi.fn();
const createObjectURL = vi.fn(() => 'blob:captured-page');
const revokeObjectURL = vi.fn();
const drawImage = vi.fn();
let wrapper: ReturnType<typeof mount> | undefined;
let encode: BlobCallback | undefined;

beforeEach(async () => {
  ocrMocks.recognize.mockResolvedValue({
    data: { text: 'Raw page text', confidence: 90 },
  });
  ocrMocks.terminate.mockResolvedValue(undefined);
  vi.stubGlobal('isSecureContext', true);
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop });
  getUserMedia.mockResolvedValue({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (callback) {
      encode = callback;
    },
  );
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/scan', component: ScanView },
      { path: '/review', component: { template: '<p>Review</p>' } },
    ],
  });
  await router.push('/scan');
  wrapper = mount(ScanView, { global: { plugins: [pinia, router] } });
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  encode = undefined;
});
function button(label: string) {
  const match = wrapper!
    .findAll('button')
    .find((entry) => entry.text() === label);
  if (!match) throw new Error('Missing button: ' + label);
  return match;
}
async function startReady() {
  await button('Start Camera').trigger('click');
  await flushPromises();
  const video = wrapper!.get('video');
  Object.defineProperties(video.element, {
    videoWidth: { value: 1920, configurable: true },
    videoHeight: { value: 1080, configurable: true },
    readyState: { value: 2, configurable: true },
    paused: { value: false, configurable: true },
  });
  await video.trigger('playing');
  return video;
}
describe('Scan flow', () => {
  it('waits for valid video, captures full resolution, retakes without another request, and releases images', async () => {
    expect(wrapper!.find('video').exists()).toBe(false);
    await button('Start Camera').trigger('click');
    await flushPromises();
    expect(button('Capture').attributes('disabled')).toBeDefined();
    const video = wrapper!.get('video');
    Object.defineProperties(video.element, {
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
      readyState: { value: 2 },
      paused: { value: false },
    });
    await video.trigger('playing');
    expect(video.element.srcObject).toBeTruthy();
    expect(button('Capture').attributes('disabled')).toBeUndefined();
    await button('Capture').trigger('click');
    expect(drawImage).toHaveBeenCalledWith(video.element, 0, 0, 1920, 1080);
    encode!(new Blob(['image'], { type: 'image/png' }));
    await flushPromises();
    expect(wrapper!.get('img').attributes('src')).toBe('blob:captured-page');
    expect(wrapper!.get('img').attributes('width')).toBe('1920');
    await button('Retake').trigger('click');
    expect(wrapper!.find('img').exists()).toBe(false);
    expect(wrapper!.get('video').isVisible()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:captured-page');
    await button('Capture').trigger('click');
    encode!(new Blob(['second']));
    await flushPromises();
    wrapper!.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
  });
  it('stops manually and ignores encoding completed after navigation', async () => {
    await startReady();
    await button('Capture').trigger('click');
    wrapper!.unmount();
    encode!(new Blob(['late']));
    await flushPromises();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('returns to start after Stop Camera', async () => {
    await startReady();
    await button('Stop Camera').trigger('click');
    expect(stop).toHaveBeenCalledOnce();
    expect(button('Start Camera').exists()).toBe(true);
    expect(wrapper!.find('video').exists()).toBe(false);
  });
  it('shows denial and capture-encoding failures gracefully', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'));
    await button('Start Camera').trigger('click');
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain(
      'permission was denied',
    );
    await startReady();
    await button('Capture').trigger('click');
    encode!(null);
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain(
      'could not be captured',
    );
    expect(wrapper!.find('img').exists()).toBe(false);
  });
  it('reads, edits and adds pages without retaining photographs or overwriting raw OCR', async () => {
    await startReady();
    await button('Capture').trigger('click');
    encode!(new Blob(['image']));
    await flushPromises();
    await button('Use Page').trigger('click');
    expect(wrapper!.text()).toContain('Reading page');
    await flushPromises();
    expect(wrapper!.get('textarea').element.value).toBe('Raw page text');
    await wrapper!.get('textarea').setValue('Corrected page');
    await button('Add Page').trigger('click');
    const store = useScanStore();
    expect(store.pages[0]?.rawText).toBe('Raw page text');
    expect(store.pages[0]?.editedText).toBe('Corrected page');
    expect(wrapper!.text()).toContain('Pages scanned: 1');
    expect(wrapper!.find('img').exists()).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:captured-page');
    await button('Scan Next Page').trigger('click');
    await flushPromises();
    expect(wrapper!.get('video').isVisible()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('requires acknowledgement for nearly blank OCR', async () => {
    ocrMocks.recognize.mockResolvedValue({ data: { text: '', confidence: 0 } });
    await startReady();
    await button('Capture').trigger('click');
    encode!(new Blob());
    await flushPromises();
    await button('Use Page').trigger('click');
    await flushPromises();
    expect(wrapper!.text()).toContain('Very little text');
    expect(button('Add Page').attributes('disabled')).toBeDefined();
    await wrapper!.get('input[type="checkbox"]').setValue(true);
    await button('Add Page').trigger('click');
    expect(useScanStore().pages.length).toBe(1);
  });
  it('preserves the image when OCR fails and retries it', async () => {
    ocrMocks.recognize.mockRejectedValueOnce(new Error('network'));
    await startReady();
    await button('Capture').trigger('click');
    encode!(new Blob());
    await flushPromises();
    await button('Use Page').trigger('click');
    await flushPromises();
    expect(wrapper!.get('img').attributes('src')).toBe('blob:captured-page');
    expect(wrapper!.get('[role="alert"]').text()).toContain("couldn't read");
    await button('Try Again').trigger('click');
    await flushPromises();
    expect(wrapper!.get('textarea').element.value).toBe('Raw page text');
  });
});
