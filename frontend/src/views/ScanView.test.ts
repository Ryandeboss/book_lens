import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanView from './ScanView.vue';

const getUserMedia = vi.fn();
const stop = vi.fn();
const createObjectURL = vi.fn(() => 'blob:captured-page');
const revokeObjectURL = vi.fn();
const drawImage = vi.fn();
let wrapper: ReturnType<typeof mount> | undefined;
let encode: BlobCallback | undefined;

beforeEach(() => {
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
  wrapper = mount(ScanView);
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
    await button('Use Page').trigger('click');
    expect(wrapper!.text()).toContain('OCR will be added');
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
});
