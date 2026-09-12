import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

const wrappers: ReturnType<typeof mount>[] = [];
function setup() {
  let camera!: ReturnType<typeof useCamera>;
  const wrapper = mount({
    setup() {
      camera = useCamera();
      return {};
    },
    template: '<div />',
  });
  wrappers.push(wrapper);
  return { camera, wrapper };
}
function mockStream() {
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    readyState: 'live',
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}
const getUserMedia = vi.fn();
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  getUserMedia.mockReset();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});
describe('useCamera', () => {
  it('starts video only with preferred rear camera and stops tracks', async () => {
    const { stream, track } = mockStream();
    getUserMedia.mockResolvedValue(stream);
    const { camera } = setup();
    await camera.startCamera();
    expect(camera.stream.value).toBe(stream);
    expect(camera.isActive.value).toBe(true);
    expect(camera.isStarting.value).toBe(false);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    });
    await camera.startCamera();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    camera.stopCamera();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(camera.isActive.value).toBe(false);
  });
  it.each([
    ['NotAllowedError', 'permission was denied'],
    ['NotFoundError', 'No usable camera'],
    ['NotReadableError', 'camera is unavailable'],
    ['UnknownError', 'could not start'],
  ])('explains %s without raw exceptions', async (name, message) => {
    getUserMedia.mockRejectedValue(
      new DOMException('raw technical details', name),
    );
    const { camera } = setup();
    await camera.startCamera();
    expect(camera.error.value).toContain(message);
    expect(camera.isStarting.value).toBe(false);
  });
  it('falls back on constraint failure', async () => {
    getUserMedia
      .mockRejectedValueOnce(new DOMException('', 'OverconstrainedError'))
      .mockResolvedValueOnce(mockStream().stream);
    const { camera } = setup();
    await camera.startCamera();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: true,
    });
    expect(camera.isActive.value).toBe(true);
  });
  it.each(['stop', 'unmount'])(
    'discards late permission results after %s',
    async (action) => {
      const { stream, track } = mockStream();
      let resolve!: (stream: MediaStream) => void;
      getUserMedia.mockReturnValue(
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
      );
      const { camera, wrapper } = setup();
      const pending = camera.startCamera();
      await camera.startCamera();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      if (action === 'stop') camera.stopCamera();
      else wrapper.unmount();
      resolve(stream);
      await pending;
      expect(track.stop).toHaveBeenCalledOnce();
      expect(camera.stream.value).toBeNull();
    },
  );
  it('cleans up on unmount and external track end', async () => {
    const first = mockStream();
    getUserMedia.mockResolvedValue(first.stream);
    const { camera, wrapper } = setup();
    await camera.startCamera();
    first.track.dispatchEvent(new Event('ended'));
    expect(camera.error.value).toContain('disconnected');
    expect(first.track.stop).toHaveBeenCalledOnce();
    const second = mockStream();
    getUserMedia.mockResolvedValue(second.stream);
    await camera.startCamera();
    wrapper.unmount();
    expect(second.track.stop).toHaveBeenCalledOnce();
  });
  it('explains insecure contexts and unsupported browsers without requesting access', async () => {
    const { camera } = setup();
    vi.stubGlobal('isSecureContext', false);
    await camera.startCamera();
    expect(camera.error.value).toContain('HTTPS');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {});
    await camera.startCamera();
    expect(camera.error.value).toContain('does not support');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
