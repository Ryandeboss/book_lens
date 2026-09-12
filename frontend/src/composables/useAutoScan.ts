import { computed, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { scannerConfig as config } from '../config/scanner';
import { AutoScanMachine } from '../services/autoScanMachine';
import { usePageDetection } from './usePageDetection';
import { useOcrQueue } from './useOcrQueue';
import { useScanStore } from '../stores/scan';
import { guideCorners, guideForFrame } from '../services/scannerGeometry';
import {
  captureStill,
  decodeStill,
  canvasFrame,
} from '../services/stillCapture';
import type { Detection, DuplicateMatch, VisionFrame } from '../types/scanner';

export function useAutoScan(getVideo: () => HTMLVideoElement | null) {
  const vision = usePageDetection(),
    queue = useOcrQueue(),
    session = useScanStore();
  const machine = reactive(new AutoScanMachine());
  const displayMessage = ref(machine.message);
  let guidanceTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    () => [machine.state, machine.message],
    () => {
      clearTimeout(guidanceTimer);
      if (
        [
          'captured',
          'capturing',
          'duplicate',
          'paused',
          'finishing',
          'error',
        ].includes(machine.state)
      )
        displayMessage.value = machine.message;
      else
        guidanceTimer = setTimeout(() => {
          displayMessage.value = machine.message;
        }, config.statusHoldMs);
    },
  );
  const acceptedRegion = shallowRef<Pick<
    Detection,
    'corners' | 'textBody'
  > | null>(null);
  const duplicateMatch = shallowRef<DuplicateMatch | null>(null);
  const detection = shallowRef<Detection | null>(null);
  const width = ref(1),
    height = ref(1),
    fps = ref(0),
    analysisDuration = ref(0),
    captureSource = ref('video'),
    cameraSettings = shallowRef<MediaTrackSettings>({}),
    duplicateScore = ref(1);
  const running = ref(false),
    paused = ref(false),
    finishing = ref(false),
    busy = ref(false);
  const canCapture = computed(
    () =>
      running.value &&
      !finishing.value &&
      !busy.value &&
      queue.hasCapacity.value,
  );
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: Promise<void> | null = null;
  let videoCallback: number | undefined;
  let callbackVideo: HTMLVideoElement | null = null;
  let lastAnalysis = -Infinity;
  let preferPixels = false;
  function cancelSchedule() {
    clearTimeout(timer);
    if (videoCallback !== undefined)
      callbackVideo?.cancelVideoFrameCallback?.(videoCallback);
    videoCallback = undefined;
    callbackVideo = null;
  }
  function nextFrame() {
    cancelSchedule();
    if (
      !running.value ||
      paused.value ||
      finishing.value ||
      disposed ||
      machine.state === 'error'
    )
      return;
    const video = getVideo();
    const cooldown = machine.captureAfter - performance.now();
    if (cooldown > 0) {
      timer = setTimeout(schedule, cooldown);
      return;
    }
    if (video?.requestVideoFrameCallback) {
      callbackVideo = video;
      videoCallback = video.requestVideoFrameCallback((now) => {
        videoCallback = undefined;
        if (
          flight ||
          busy.value ||
          now - lastAnalysis < config.analysisIntervalMs
        )
          nextFrame();
        else schedule();
      });
    } else
      timer = setTimeout(
        schedule,
        Math.max(
          0,
          config.analysisIntervalMs - (performance.now() - lastAnalysis),
        ),
      );
  }
  let generation = 0,
    disposed = false;
  const canvas = document.createElement('canvas');
  function frame(maxEdge?: number): Promise<VisionFrame> {
    const video = getVideo();
    if (
      !video ||
      video.paused ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    )
      throw new Error('Wait for the camera preview.');
    if (
      width.value !== video.videoWidth ||
      height.value !== video.videoHeight
    ) {
      machine.resetStability();
      detection.value = null;
    }
    cameraSettings.value =
      (video.srcObject as MediaStream | null)
        ?.getVideoTracks()[0]
        ?.getSettings?.() ?? {};
    width.value = video.videoWidth;
    height.value = video.videoHeight;
    const scale = maxEdge
      ? Math.min(1, maxEdge / Math.max(width.value, height.value))
      : Math.min(
          1,
          Math.sqrt(config.captureMaxPixels / (width.value * height.value)),
        );
    canvas.width = Math.max(1, Math.round(width.value * scale));
    canvas.height = Math.max(1, Math.round(height.value * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Camera frames unavailable.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvasFrame(canvas, preferPixels);
  }
  async function snapshot(current: number, maxEdge?: number) {
    const bitmap = await frame(maxEdge);
    if (current !== generation || disposed) {
      if ('close' in bitmap) bitmap.close();
      throw new Error('Scanner stopped');
    }
    return bitmap;
  }
  async function capture(manual = false) {
    if (
      !running.value ||
      finishing.value ||
      busy.value ||
      !queue.hasCapacity.value
    )
      return;
    busy.value = true;
    const current = generation;
    machine.state = 'capturing';
    machine.message = 'Taking photo... Keep still';
    try {
      // Manual capture can follow a pause or repositioning; refresh the geometry.
      if (manual) {
        const refreshed = await vision.analyze(
          await snapshot(current, config.analysisMaxEdge),
          true,
        );
        if (current !== generation || disposed) return;
        detection.value = refreshed;
      }
      const valid = () =>
        current === generation && !disposed && !finishing.value;
      const video = getVideo();
      if (!video) throw new Error('Camera stopped');
      let still = await captureStill(video, valid);
      if (!valid()) return;
      let capturedCanvas: HTMLCanvasElement;
      try {
        capturedCanvas = await decodeStill(still.blob);
      } catch {
        if (still.source !== 'photo' || !valid())
          throw new Error('Photo unavailable');
        still = await captureStill(video, valid, false);
        capturedCanvas = await decodeStill(still.blob);
      }
      let fullFrame: VisionFrame;
      let captureDetection = detection.value;
      try {
        if (!valid()) return;
        captureSource.value = still.source;
        // Re-detect native still geometry in its own orientation/field of view.
        // The full-resolution warp uses normalized coordinates from this SAME image.
        if (still.source === 'photo') {
          const scale = Math.min(
            1,
            config.analysisMaxEdge /
              Math.max(capturedCanvas.width, capturedCanvas.height),
          );
          canvas.width = Math.round(capturedCanvas.width * scale);
          canvas.height = Math.round(capturedCanvas.height * scale);
          canvas
            .getContext('2d')!
            .drawImage(capturedCanvas, 0, 0, canvas.width, canvas.height);
          const previewFrame = await canvasFrame(canvas, preferPixels);
          if (!valid()) {
            if ('close' in previewFrame) previewFrame.close();
            return;
          }
          captureDetection = await vision.analyze(previewFrame, true);
          if (!valid()) return;
          if (!manual && !captureDetection.aligned) {
            machine.state = 'detected';
            machine.message = 'Hold steady while the camera focuses';
            machine.resetStability();
            return;
          }
        }
        fullFrame = await canvasFrame(capturedCanvas, preferPixels);
      } finally {
        capturedCanvas.width = capturedCanvas.height = 1;
      }
      if (!valid()) {
        if ('close' in fullFrame) fullFrame.close();
        return;
      }
      const result = await vision.process(
        fullFrame,
        captureDetection?.captureCorners ?? captureDetection?.corners ?? null,
        [], // Compare OCR text later; never silently discard a saved shot.
        captureDetection?.textBody ?? null,
      );
      if (current !== generation || disposed) return;
      duplicateMatch.value = result.duplicateMatch ?? null;
      duplicateScore.value = result.duplicateMatch?.gray ?? 1;
      const id = queue.enqueue(
        result.blob,
        result.fingerprint,
        result.visualFingerprint,
      );
      if (!id) {
        if (!finishing.value)
          machine.pause('Processing pages... Hold for a moment.');
        return;
      }
      if (!finishing.value) {
        acceptedRegion.value = {
          corners: detection.value?.textBody
            ? null
            : (detection.value?.captureCorners ??
              detection.value?.corners ??
              guideCorners(guideForFrame(width.value, height.value))),
          textBody: detection.value?.textBody ?? null,
        };
        machine.savedShot(
          performance.now(),
          `\u2713 Shot ${session.pages.find((p) => p.id === id)!.capturePosition} saved — turn the page`,
        );
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(
          () => machine.endFlash(performance.now()),
          config.flashMs + 10,
        );
      }
    } catch {
      if (current === generation && !disposed && !finishing.value)
        machine.fail(
          manual
            ? 'Capture could not finish. Resume to try again.'
            : 'Page analysis unavailable. Resume to try again.',
        );
    } finally {
      if (current === generation) busy.value = false;
    }
  }
  async function tick() {
    if (!running.value || paused.value || finishing.value || document.hidden)
      return;
    const current = generation,
      start = performance.now();
    const elapsed = start - lastAnalysis;
    if (Number.isFinite(elapsed) && elapsed > 0) fps.value = 1000 / elapsed;
    lastAnalysis = start;
    try {
      let result: Detection;
      try {
        result = await vision.analyze(
          await snapshot(current, config.analysisMaxEdge),
        );
      } catch (cause) {
        if (
          current !== generation ||
          disposed ||
          paused.value ||
          finishing.value ||
          preferPixels
        )
          throw cause;
        // Retry once with transferable pixels and a fresh worker. The main-thread
        // OffscreenCanvas API does not guarantee worker bitmap support.
        preferPixels = true;
        vision.terminate();
        result = await vision.analyze(
          await snapshot(current, config.analysisMaxEdge),
        );
      }
      if (current !== generation || disposed || paused.value || finishing.value)
        return;
      analysisDuration.value = performance.now() - start;
      detection.value = result;
      const shouldCapture = machine.sample(
        result,
        performance.now(),
        !queue.hasCapacity.value,
      );
      if (shouldCapture) await capture();
    } catch (cause) {
      if (
        current === generation &&
        !disposed &&
        !finishing.value &&
        !paused.value
      ) {
        vision.terminate();
        machine.fail(
          cause instanceof Error && cause.message.startsWith('Scanner:')
            ? cause.message.slice(8).trim()
            : 'Scanner could not read the camera frame. Tap Resume to restart it.',
        );
      }
    }
  }
  function schedule() {
    if (flight || busy.value) {
      nextFrame();
      return;
    }
    const current = generation;
    const request = tick();
    flight = request;
    void request.finally(() => {
      if (flight === request) flight = null;
      if (current === generation) nextFrame();
    });
  }
  function start() {
    if (disposed || finishing.value) return;
    cancelSchedule();
    running.value = true;
    paused.value = false;
    machine.state = 'searching';
    machine.message = 'Loading page detection...';
    machine.resetStability();
    if (!flight) nextFrame();
  }
  function pause(message = 'Scanner paused') {
    generation++;
    vision.terminate();
    flight = null;
    busy.value = false;
    paused.value = true;
    clearTimeout(feedbackTimer);
    cancelSchedule();
    machine.pause(message);
  }
  async function resume() {
    if (busy.value || disposed || finishing.value) return;
    const current = ++generation;
    cancelSchedule();
    vision.terminate();
    flight = null;
    lastAnalysis = -Infinity;
    detection.value = null;
    paused.value = true;
    machine.state = 'searching';
    machine.message = 'Restarting scanner...';
    displayMessage.value = machine.message;
    try {
      const video = getVideo();
      if (!video) throw new Error('Camera unavailable');
      if (video.paused) await video.play();
      if (current !== generation || disposed || finishing.value) return;
      start();
      // Do not wait for a video callback that a stalled preview may never emit.
      cancelSchedule();
      schedule();
    } catch {
      if (current === generation && !disposed)
        machine.fail(
          'Camera preview could not restart. Stop Camera, then Start Camera.',
        );
    }
  }
  async function manualCapture() {
    if (!canCapture.value) return;
    const current = generation;
    cancelSchedule();
    // Do not race full-resolution processing with an analysis request.
    if (flight) await flight;
    if (current !== generation || !canCapture.value) return;
    cancelSchedule();
    const request = capture(true);
    flight = request;
    await request;
    if (flight === request) flight = null;
    if (
      current === generation &&
      running.value &&
      !paused.value &&
      !finishing.value &&
      !disposed
    )
      nextFrame();
  }
  async function finish() {
    generation++;
    finishing.value = true;
    vision.terminate();
    flight = null;
    busy.value = false;
    clearTimeout(feedbackTimer);
    machine.finish();
    cancelSchedule();
    if (disposed) return;
    running.value = false;
    await queue.waitUntilIdle();
    if (!disposed) await queue.releaseWorker();
  }
  function stop() {
    clearTimeout(feedbackTimer);
    clearTimeout(guidanceTimer);
    acceptedRegion.value = null;
    duplicateMatch.value = null;
    generation++;
    flight = null;
    running.value = false;
    paused.value = false;
    cancelSchedule();
    vision.terminate();
    busy.value = false;
    detection.value = null;
    canvas.width = 1;
    canvas.height = 1;
  }
  function visibility() {
    if (document.hidden) {
      pause('Paused while the app is in the background. Tap Resume.');
    }
  }
  document.addEventListener('visibilitychange', visibility);
  onUnmounted(() => {
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', visibility);
  });
  return {
    machine,
    displayMessage,
    acceptedRegion,
    duplicateMatch,
    detection,
    width,
    height,
    fps,
    analysisDuration,
    captureSource,
    cameraSettings,
    duplicateScore,
    running,
    paused,
    finishing,
    busy,
    canCapture,
    start,
    pause,
    resume,
    manualCapture,
    finish,
    stop,
  };
}
