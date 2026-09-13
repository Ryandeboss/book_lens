<script setup lang="ts">
import {
  defineAsyncComponent,
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import CameraPreview from '../components/camera/CameraPreview.vue';
import ScannerGuide from '../components/scan/ScannerGuide.vue';
import { useCamera } from '../composables/useCamera';
import { useAutoScan } from '../composables/useAutoScan';
import { useOcrQueue } from '../composables/useOcrQueue';
import { useScanStore } from '../stores/scan';
import { scannerDebug } from '../config/scanner';
const OcrComparison =
  import.meta.env.DEV && scannerDebug
    ? defineAsyncComponent(() => import('../components/scan/OcrComparison.vue'))
    : null;
const router = useRouter(),
  session = useScanStore(),
  queue = useOcrQueue();
const { stream, isActive, isStarting, error, startCamera, stopCamera } =
  useCamera();
const preview = ref<InstanceType<typeof CameraPreview> | null>(null);
const scanner = useAutoScan(() => preview.value?.getVideo() ?? null);
const {
  machine,
  detection,
  acceptedRegion,
  width,
  height,
  running,
  paused,
  finishing,
  canCapture,
} = scanner;
const processed = computed(
  () => session.pages.filter((p) => p.status === 'ready').length,
);
const failed = computed(
  () => session.pages.filter((p) => p.status === 'error').length,
);
const pending = queue.pendingCount;
let disposed = false;
onUnmounted(() => {
  disposed = true;
});
async function start() {
  await startCamera();
  await nextTick();
}
function ready(value: boolean) {
  if (value && isActive.value && !running.value && !finishing.value)
    scanner.start();
}
function stop() {
  scanner.stop();
  stopCamera();
}
function cameraFailed(message: string) {
  stop();
  error.value = message;
}
async function done() {
  const completion = scanner.finish();
  stopCamera();
  await completion;
  if (!disposed) void router.push('/review');
}
watch(isActive, (value) => {
  if (!value && !finishing.value) scanner.stop();
});
</script>
<template>
  <section class="continuous-scanner">
    <template v-if="!isActive && !finishing">
      <p class="eyebrow">01 / SCAN</p>
      <h1>Turn pages. Keep the words.</h1>
      <p>
        Hold a page still and in focus. Keep it in view while OCR checks the
        trial photo. A green flash confirms it reached at least 85% OCR
        confidence and was saved. Then you have two seconds to turn the page. AI
        cleanup continues in the background.
      </p>
      <label class="cleanup-option">
        <input v-model="session.cleanupEnabled" type="checkbox" />
        Clean up OCR text with AI when available
      </label>
      <p class="scan-hint">
        With cleanup enabled, OCR text is sent to OpenAI. You can review the
        original and undo corrections. Photos stay only in temporary memory;
        keep this tab open until processing finishes.
      </p>
      <p class="scan-hint">
        Page images are sent to our server and Google for OCR, without BookLens
        saving the images. Browser OCR is the fallback. Download your text
        before refreshing or closing.
      </p>
      <AppButton :disabled="isStarting" @click="start">{{
        isStarting ? 'Starting camera...' : 'Start Camera'
      }}</AppButton>
      <button
        v-if="isStarting"
        class="secondary-button"
        type="button"
        @click="stop"
      >
        Cancel camera startup
      </button>
      <AppButton v-if="session.pages.length" to="/review"
        >Review Document</AppButton
      >
    </template>
    <OcrComparison v-if="scannerDebug && OcrComparison && !isActive" />
    <p v-if="error" class="scan-error" role="alert">{{ error }}</p>
    <div v-if="isActive && !finishing" class="scanner-live">
      <CameraPreview
        ref="preview"
        :stream="stream"
        @ready="ready"
        @error="cameraFailed"
      >
        <ScannerGuide
          :width="width"
          :height="height"
          :state="machine.state"
          :progress="machine.stableProgress"
          :corners="
            (machine.state === 'captured' ? acceptedRegion : detection)
              ?.corners ?? null
          "
          :text-body="
            (machine.state === 'captured' ? acceptedRegion : detection)
              ?.textBody ?? null
          "
        />
      </CameraPreview>
      <p class="scanner-status" role="status" :data-state="machine.state">
        {{ scanner.displayMessage.value }}
      </p>
      <progress
        v-if="machine.state === 'stabilizing' || machine.state === 'capturing'"
        class="capture-progress"
        :value="machine.state === 'capturing' ? 1 : machine.stableProgress"
        :max="1"
        aria-label="Automatic capture progress"
      />
      <p
        v-if="machine.state === 'searching' || machine.state === 'detected'"
        class="scan-hint"
      >
        Show one page and hold briefly. Saving requires at least 85% OCR
        confidence.
      </p>
      <p class="counts">
        {{ session.pages.length }} shots saved · {{ processed }} processed<span
          v-if="failed"
        >
          · {{ failed }} need review</span
        >
      </p>
      <div class="primary-actions">
        <AppButton @click="done">Done</AppButton>
        <button
          class="scanner-secondary"
          type="button"
          @click="
            paused || machine.state === 'error'
              ? scanner.resume()
              : scanner.pause()
          "
        >
          {{ paused || machine.state === 'error' ? 'Resume' : 'Pause' }}
        </button>
      </div>
      <div class="secondary-actions">
        <button
          class="scanner-secondary"
          type="button"
          :disabled="!canCapture"
          @click="scanner.manualCapture"
        >
          Manual Capture
        </button>
        <button class="scanner-secondary" type="button" @click="stop">
          Stop Camera
        </button>
      </div>
      <p v-if="pending" class="scan-hint">
        {{ pending }} {{ pending === 1 ? 'page' : 'pages' }} processing in the
        background.
      </p>
      <details v-if="scannerDebug" class="scanner-debug">
        <summary>Scanner debug</summary>
        <pre>{{
          JSON.stringify(
            {
              state: machine.state,
              cameraSettings: scanner.cameraSettings.value,
              cameraResolution: [width, height],
              analysisResolution: [
                detection?.analysisWidth,
                detection?.analysisHeight,
              ],
              analysisDurationMs: scanner.analysisDuration.value,
              captureSource: scanner.captureSource.value,
              blockedGate: detection?.gate,
              motionDifference: detection?.motionDifference,
              coverage: detection?.coverage,
              textPresent: detection?.textPresent,
              stableSamples: machine.stableSamples,
              stableDurationMs: machine.stableDuration,
              queueLength: pending,
              detectionSource: detection?.source,
              corners: detection?.corners,
              alignment: detection?.alignment,
              textBody: detection?.textBody,
              confidence: detection?.confidence,
              approximateBoundary: detection?.approximate,
              closestPage: scanner.duplicateMatch.value,
              duplicateNotifications: machine.duplicateNotifications,
              sharpness: detection?.sharpness,
              brightness: detection?.brightness,
              stability: machine.stableProgress,
              pageChange: machine.changeScore,
              duplicate: scanner.duplicateScore.value,
              fps: scanner.fps.value,
            },
            null,
            2,
          )
        }}</pre>
      </details>
    </div>
    <div v-if="finishing" class="document-card" aria-busy="true">
      <h2>Photos saved. Finishing your text...</h2>
      <p role="status">
        {{ processed }} / {{ session.pages.length }} pages processed<span
          v-if="failed"
        >
          · {{ failed }} failed</span
        >
      </p>
      <p>
        Keep this tab open while OCR and optional cleanup finish. Likely
        duplicate pages will be set aside in Review, where you can restore them.
      </p>
      <progress
        :value="processed + failed"
        :max="Math.max(1, session.pages.length)"
        aria-label="Finishing OCR"
      />
    </div>
  </section>
</template>
<style scoped>
.continuous-scanner {
  max-width: 760px;
  margin: -40px auto 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
h1 {
  font-size: clamp(2rem, 5vw, 3.2rem);
}
.scanner-live {
  background: #14201b;
  color: #f9fff9;
  border-radius: 14px;
  padding: 8px 8px 16px;
}
.scanner-live :deep(video) {
  height: 62svh;
  min-height: 200px;
}
.scanner-status {
  font-size: 1.05rem;
  text-align: center;
  min-height: 2em;
  margin: 12px 4px;
}
.scanner-status[data-state='duplicate'] {
  color: #ffd16a;
}
.scanner-status[data-state='captured'] {
  color: #59f59d;
}
.capture-progress {
  display: block;
  width: min(70%, 280px);
  height: 5px;
  margin: 0 auto 12px;
  accent-color: #87ddff;
}
.counts {
  text-align: center;
  font-size: 0.85rem;
  margin: 8px;
}
.primary-actions,
.secondary-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.scanner-secondary {
  background: transparent;
  color: inherit;
  border: 1px solid #7f9e8d;
  border-radius: 8px;
  font: inherit;
  min-height: 48px;
  padding: 10px 16px;
  cursor: pointer;
}
.secondary-actions {
  margin-top: 12px;
  font-size: 0.8rem;
}
.scanner-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.scanner-live .scan-hint {
  color: #c1d3c8;
  text-align: center;
}
.scanner-debug {
  padding: 12px;
  font-size: 0.7rem;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (orientation: landscape) and (max-height: 600px) {
  .scanner-live :deep(video) {
    height: 70svh;
  }
}
</style>
