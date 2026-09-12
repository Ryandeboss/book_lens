import { computed, onUnmounted, ref, shallowRef } from 'vue';

function errorName(cause: unknown): string {
  return cause &&
    typeof cause === 'object' &&
    'name' in cause &&
    typeof cause.name === 'string'
    ? cause.name
    : '';
}

function cameraMessage(cause: unknown): string {
  switch (errorName(cause)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No usable camera was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is unavailable. Close other apps using it and try again.';
    default:
      return 'BookLens could not start the camera. Please try again.';
  }
}
export function useCamera() {
  const stream = shallowRef<MediaStream | null>(null);
  const isStarting = ref(false);
  const error = ref<string | null>(null);
  const isActive = computed(() => stream.value !== null);
  let requestId = 0;
  let disposed = false;

  function stopCamera() {
    // Permission requests cannot be cancelled; invalidate them and stop late streams.
    requestId++;
    stream.value?.getTracks().forEach((track) => track.stop());
    stream.value = null;
    isStarting.value = false;
  }
  async function startCamera() {
    if (disposed || isStarting.value || isActive.value) return;
    error.value = null;
    if (!window.isSecureContext) {
      error.value =
        'Camera access requires HTTPS or localhost. Open BookLens using a secure HTTPS address on your phone.';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      error.value =
        'This browser does not support camera access. Try a current version of Safari, Chrome, or Edge.';
      return;
    }
    const currentRequest = ++requestId;
    isStarting.value = true;
    try {
      let acquired: MediaStream;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        });
      } catch (cause) {
        if (currentRequest !== requestId) return;
        // Ideal constraints normally fall back automatically. Retry only constraint failures.
        if (errorName(cause) !== 'OverconstrainedError') throw cause;
        acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }
      if (currentRequest !== requestId) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      if (
        !acquired.getVideoTracks().some((track) => track.readyState === 'live')
      ) {
        acquired.getTracks().forEach((track) => track.stop());
        throw new DOMException('No live video track', 'NotFoundError');
      }
      stream.value = acquired;
      acquired.getVideoTracks().forEach((track) => {
        track.addEventListener(
          'ended',
          () => {
            if (stream.value !== acquired) return;
            stopCamera();
            error.value =
              'The camera disconnected. Check your camera and try again.';
          },
          { once: true },
        );
      });
    } catch (cause) {
      if (currentRequest === requestId) error.value = cameraMessage(cause);
    } finally {
      if (currentRequest === requestId) isStarting.value = false;
    }
  }
  onUnmounted(() => {
    disposed = true;
    stopCamera();
  });
  return { stream, isActive, isStarting, error, startCamera, stopCamera };
}
