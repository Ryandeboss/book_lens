import { computed, onUnmounted, reactive, ref, shallowRef, toRaw } from 'vue';
import { scannerConfig as config } from '../config/scanner';
import { AutoScanMachine } from '../services/autoScanMachine';
import { usePageDetection } from './usePageDetection';
import { useOcrQueue } from './useOcrQueue';
import { useScanStore } from '../stores/scan';
import { guideCorners, guideForFrame } from '../services/scannerGeometry';
import type { Detection, DuplicateMatch } from '../types/scanner';

export function useAutoScan(getVideo: () => HTMLVideoElement | null) {
  const vision = usePageDetection(),
    queue = useOcrQueue(),
    session = useScanStore();
  const machine = reactive(new AutoScanMachine());
  const acceptedRegion = shallowRef<Pick<
    Detection,
    'corners' | 'textBody'
  > | null>(null);
  const duplicateMatch = shallowRef<DuplicateMatch | null>(null);
  const detection = shallowRef<Detection | null>(null);
  const width = ref(1),
    height = ref(1),
    fps = ref(0),
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
  let generation = 0,
    disposed = false;
  const canvas = document.createElement('canvas');
  function frame(maxEdge?: number): Promise<ImageBitmap> {
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
    return createImageBitmap(canvas);
  }
  async function snapshot(current: number, maxEdge?: number) {
    const bitmap = await frame(maxEdge);
    if (current !== generation || disposed) {
      bitmap.close();
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
    machine.message = 'Scanning page... Keep still';
    try {
      // Manual capture can follow a pause or repositioning; refresh the geometry.
      if (manual) {
        detection.value = await vision.analyze(
          await snapshot(current, config.analysisMaxEdge),
        );
        if (current !== generation || disposed) return;
      }
      const result = await vision.process(
        await snapshot(current),
        detection.value?.corners ?? null,
        session.pages.slice(-config.recentFingerprints).flatMap((p) =>
          p.visualFingerprint
            ? [
                {
                  id: p.id,
                  pageNumber: p.pageNumber,
                  fingerprint: toRaw(p.visualFingerprint),
                },
              ]
            : [],
        ),
      );
      if (current !== generation || disposed) return;
      duplicateMatch.value = result.duplicateMatch ?? null;
      duplicateScore.value = result.duplicateMatch?.gray ?? 1;
      if (result.duplicateMatch?.duplicate) {
        if (!finishing.value)
          machine.duplicate(
            detection.value?.signature ?? [],
            performance.now(),
            detection.value?.content,
            detection.value?.source,
          );
        return;
      }
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
          corners:
            detection.value?.corners ??
            guideCorners(guideForFrame(width.value, height.value)),
          textBody: detection.value?.textBody ?? null,
        };
        machine.accepted(
          detection.value?.signature ?? [],
          performance.now(),
          `\u2713 Page ${session.pages.find((p) => p.id === id)!.pageNumber} scanned - Turn the page`,
          detection.value?.content,
          detection.value?.source,
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
    try {
      const result = await vision.analyze(
        await snapshot(current, config.analysisMaxEdge),
      );
      if (current !== generation || disposed || paused.value || finishing.value)
        return;
      detection.value = result;
      const shouldCapture = machine.sample(
        result,
        performance.now(),
        !queue.hasCapacity.value,
      );
      if (shouldCapture) await capture();
    } catch {
      if (
        current === generation &&
        !disposed &&
        !finishing.value &&
        !paused.value
      )
        machine.fail(
          'Scanner could not analyze the camera. Resume to try again.',
        );
    } finally {
      fps.value =
        1000 / Math.max(config.analysisIntervalMs, performance.now() - start);
      if (
        current === generation &&
        running.value &&
        !paused.value &&
        !finishing.value &&
        machine.state !== 'error' &&
        !disposed
      )
        timer = setTimeout(
          schedule,
          Math.max(0, config.analysisIntervalMs - (performance.now() - start)),
        );
    }
  }
  function schedule() {
    const request = tick();
    flight = request;
    void request.finally(() => {
      if (flight === request) flight = null;
    });
  }
  function start() {
    if (disposed || finishing.value) return;
    clearTimeout(timer);
    running.value = true;
    paused.value = false;
    machine.state = 'searching';
    machine.message = 'Loading page detection...';
    machine.resetStability();
    if (!flight) schedule();
  }
  function pause(message = 'Scanner paused') {
    paused.value = true;
    clearTimeout(timer);
    machine.pause(message);
  }
  function resume() {
    if (!busy.value) start();
  }
  async function manualCapture() {
    if (!canCapture.value) return;
    const current = generation;
    clearTimeout(timer);
    // Do not race full-resolution processing with an analysis request.
    if (flight) await flight;
    if (current !== generation || !canCapture.value) return;
    clearTimeout(timer);
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
      timer = setTimeout(schedule, config.analysisIntervalMs);
  }
  async function finish() {
    finishing.value = true;
    machine.finish();
    clearTimeout(timer);
    if (flight) await flight;
    if (disposed) return;
    running.value = false;
    vision.terminate();
    await queue.waitUntilIdle();
    if (!disposed) await queue.releaseWorker();
  }
  function stop() {
    clearTimeout(feedbackTimer);
    acceptedRegion.value = null;
    duplicateMatch.value = null;
    generation++;
    flight = null;
    running.value = false;
    paused.value = false;
    clearTimeout(timer);
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
    acceptedRegion,
    duplicateMatch,
    detection,
    width,
    height,
    fps,
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
