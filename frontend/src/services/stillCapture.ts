import { scannerConfig as config } from '../config/scanner';
import type { PixelFrame, VisionFrame } from '../types/scanner';

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Camera image unavailable')),
      config.ocrImageType,
      config.ocrJpegQuality,
    ),
  );
}
export async function encodePixels(pixels: PixelFrame) {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image canvas unavailable');
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(pixels.data),
        pixels.width,
        pixels.height,
      ),
      0,
      0,
    );
    return await canvasBlob(canvas);
  } finally {
    canvas.width = canvas.height = 1;
  }
}
export function canvasFrame(canvas: HTMLCanvasElement): Promise<VisionFrame> {
  // Older Safari can transfer pixels to a worker without OffscreenCanvas.
  if (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  )
    return createImageBitmap(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image canvas unavailable');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return Promise.resolve({
    data: image.data,
    width: image.width,
    height: image.height,
  });
}

type NativeCapture = new (track: MediaStreamTrack) => {
  takePhoto(): Promise<Blob>;
};
export async function captureStill(
  video: HTMLVideoElement,
  valid: () => boolean,
  preferNative = true,
) {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  const Native = (
    globalThis as typeof globalThis & { ImageCapture?: NativeCapture }
  ).ImageCapture;
  if (preferNative && Native && track?.readyState === 'live') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const blob = await Promise.race([
        new Native(track).takePhoto(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Shutter timeout')),
            config.stillTimeoutMs,
          );
        }),
      ]);
      if (!valid()) throw new Error('Scanner stopped');
      if (blob.size && blob.size <= config.maxPendingBytes)
        return { blob, source: 'photo' as const };
    } catch {
      /* Unsupported device, failed shutter or timeout: use video. */
    } finally {
      clearTimeout(timer);
    }
  }
  if (
    !valid() ||
    video.paused ||
    video.readyState < 2 ||
    !video.videoWidth ||
    !video.videoHeight
  )
    throw new Error('Camera stopped');
  const canvas = document.createElement('canvas');
  const scale = Math.min(
    1,
    Math.sqrt(config.captureMaxPixels / (video.videoWidth * video.videoHeight)),
  );
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image canvas unavailable');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { blob: await canvasBlob(canvas), source: 'video' as const };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

export async function decodeStill(blob: Blob) {
  // Browser decoding applies image orientation. Never project preview corners
  // onto a native still with a potentially different field of view.
  const image = new Image(),
    url = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Photo decode timeout')),
        config.workerTimeoutMs,
      );
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Photo could not be decoded'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(
      1,
      Math.sqrt(
        config.captureMaxPixels / (image.naturalWidth * image.naturalHeight),
      ),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image canvas unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    clearTimeout(timer);
    image.onload = image.onerror = null;
    URL.revokeObjectURL(url);
    image.src = '';
  }
}
