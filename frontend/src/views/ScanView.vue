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
import AiCleanupOptions from '../components/scan/AiCleanupOptions.vue';
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
  <section
    class="continuous-scanner"
    :class="{ 'is-scanning': isActive && !finishing }"
  >
    <template v-if="!isActive && !finishing">
      <p class="eyebrow">Your scanning studio</p>
      <h1>Turn pages. Keep the words.</h1>
      <p class="scan-intro">
        Point your camera at a page. Hold steady, wait for green, and turn. OCR
        and AI cleanup continue in the background.
      </p>
      <div class="scan-steps" aria-label="Scanning steps">
        <span><b>01</b> Hold steady</span><span><b>02</b> Wait for green</span
        ><span><b>03</b> Turn the page</span>
      </div>
      <details class="privacy-details">
        <summary>How your pages are processed</summary>
        <p class="scan-hint">
          With cleanup enabled, OCR text is sent to OpenAI. You can review the
          original and undo corrections. Your active draft is saved on this
          device for up to 24 hours, including photos that still need OCR or a
          retry.
        </p>
        <p class="scan-hint">
          Page images are sent to our server and Google for OCR, without
          server-side image storage. Browser OCR is the fallback. Completed OCR
          images are removed from the local draft. Download TXT for a permanent
          copy.
        </p>
      </details>
      <div class="scan-actions start-actions">
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
      </div>
    </template>
    <OcrComparison v-if="scannerDebug && OcrComparison && !isActive" />
    <p v-if="error" class="scan-error" role="alert">{{ error }}</p>
    <div v-if="isActive && !finishing" class="scanner-live">
      <div class="camera-toolbar">
        <span class="live-label"
          ><i aria-hidden="true"></i
          >{{ paused ? 'Paused' : 'Automatic capture' }}</span
        ><span class="camera-wordmark">BOOKLENS</span>
      </div>
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
        />
      </CameraPreview>
      <p class="scanner-status" role="status" :data-state="machine.state">
        {{ scanner.displayMessage.value }}
      </p>
      <progress
        v-if="machine.state === 'stabilizing' || machine.state === 'capturing'"
        class="capture-progress"
        :value="
          machine.state === 'capturing' ? undefined : machine.stableProgress
        "
        :max="1"
        :aria-label="
          machine.state === 'capturing'
            ? 'Reading photo'
            : 'Automatic capture progress'
        "
      />
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
      <details class="scan-details">
        <summary>
          Scan details<span v-if="pending"> · {{ pending }} processing</span>
        </summary>
        <p class="scan-hint ocr-confidence" role="status">
          {{ scanner.confidenceLabel.value }}
        </p>
        <p v-if="pending" class="scan-hint">
          {{ pending }} {{ pending === 1 ? 'page' : 'pages' }} processing in the
          background.
        </p>
      </details>
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
    <AiCleanupOptions v-if="!finishing" :compact="isActive" />
    <div v-if="finishing" class="document-card finishing-card" aria-busy="true">
      <div class="finishing-icon" aria-hidden="true">✓</div>
      <p class="eyebrow">One last moment</p>
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
  max-width: 720px;
  margin: 16px auto 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.continuous-scanner.is-scanning {
  max-width: 620px;
  margin-top: 0;
}
h1 {
  font-size: clamp(2.4rem, 5vw, 3.5rem);
  max-width: 600px;
}
.scan-intro {
  color: var(--muted);
  max-width: 520px;
  font-size: 0.94rem;
}
.scan-steps {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  margin: 28px 0 18px;
  font-size: 0.77rem;
  color: var(--muted);
}
.scan-steps b {
  display: inline-grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 50%;
  border: 1px solid #d3ded2;
  margin-right: 6px;
  color: #4d7159;
  font-size: 0.6rem;
}
.privacy-details {
  margin: 0 0 20px;
  color: var(--muted);
}
.privacy-details summary {
  font-size: 0.73rem;
}
.start-actions {
  margin-bottom: 28px;
}
.scanner-live {
  background: #14251e;
  color: #edf4ed;
  border: 1px solid #2e4537;
  border-radius: 18px;
  padding: 0 14px 4px;
  overflow: hidden;
  box-shadow: 0 16px 50px #203e3310;
}
.camera-toolbar {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.live-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #bfd4c4;
  font-size: 0.67rem;
  font-weight: 500;
}
.live-label i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8cbd9c;
}
.camera-wordmark {
  font-size: 0.5rem;
  letter-spacing: 0.17em;
  color: #8da896;
}
.scanner-live :deep(.camera-preview) {
  border-radius: 8px;
  background: #0c1712;
}
.scanner-live :deep(video) {
  height: clamp(240px, calc(100svh - 430px), 560px);
  min-height: 0;
}
.scanner-status {
  font-size: 0.86rem;
  font-weight: 550;
  text-align: center;
  min-height: 2.8em;
  display: grid;
  align-items: center;
  margin: 12px 0 2px;
  line-height: 1.45;
}
.scanner-status[data-state='captured'] {
  color: #a1efb5;
}
.scanner-status[data-state='error'] {
  color: #ffd0bc;
}
.capture-progress {
  display: block;
  width: min(65%, 220px);
  height: 3px;
  margin: 4px auto 8px;
  accent-color: #8fceaa;
}
.capture-progress::-webkit-progress-bar {
  background: #314c3b;
}
.capture-progress::-webkit-progress-value {
  background: #8fceaa;
}
.counts {
  font-size: 0.68rem;
  text-align: center;
  color: #a4bdad;
  margin: 6px 0 14px;
  font-variant-numeric: tabular-nums;
}
.primary-actions {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 10px;
}
.primary-actions .app-button {
  background: #dcf0db;
  color: #213f2b;
  min-height: 46px;
  padding: 10px;
  font-size: 0.86rem;
}
.primary-actions .app-button:hover {
  background: #c7e6c8;
}
.scanner-secondary {
  min-height: 44px;
  border: 1px solid #47614f;
  color: #d0e0d2;
  border-radius: 10px;
  background: transparent;
  padding: 8px 14px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.scanner-secondary:hover:not(:disabled) {
  background: #294433;
}
.scanner-secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.secondary-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 5px;
}
.secondary-actions .scanner-secondary {
  border: 0;
  color: #a9c0b0;
  font-size: 0.69rem;
  min-height: 40px;
}
.scan-details {
  border-top: 1px solid #304838;
  padding: 0 4px;
  color: #9eb8a6;
}
.scan-details summary {
  min-height: 32px;
  font-size: 0.64rem;
  padding: 6px 0;
}
.scanner-live .scan-hint {
  color: #bdd0c0;
  font-size: 0.72rem;
}
.scanner-debug {
  padding: 12px;
  font-size: 0.7rem;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.finishing-card {
  text-align: center;
  padding: 48px 28px;
}
.finishing-card .eyebrow {
  justify-content: center;
}
.finishing-card h2 {
  font-family: Georgia, serif;
  font-weight: 400;
  font-size: 2rem;
}
.finishing-card > p {
  color: var(--muted);
  font-size: 0.88rem;
}
.finishing-icon {
  display: inline-grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: #edf4e8;
  color: #497659;
  font-size: 1.6rem;
}
@media (max-width: 640px) {
  .scan-steps {
    gap: 12px;
    font-size: 0.68rem;
  }
  .continuous-scanner:not(.is-scanning) {
    padding: 8px;
  }
  .scanner-live {
    border-radius: 14px;
    padding-inline: 10px;
  }
}
@media (orientation: landscape) and (max-height: 600px) {
  .scanner-live :deep(video) {
    height: 64svh;
  }
}
</style>
