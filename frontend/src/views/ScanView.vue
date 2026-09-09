<script setup lang="ts">
import { nextTick, onUnmounted, ref, shallowRef } from 'vue';
import AppButton from '../components/common/AppButton.vue';
import CameraPreview from '../components/camera/CameraPreview.vue';
import { useCamera } from '../composables/useCamera';
import type { CapturedPage } from '../types/capture';

const { stream, isActive, isStarting, error, startCamera, stopCamera } =
  useCamera();
const preview = ref<InstanceType<typeof CameraPreview> | null>(null);
const ready = ref(false);
const capturing = ref(false);
const captured = shallowRef<CapturedPage | null>(null);
const imageUrl = ref<string | null>(null);
const captureError = ref<string | null>(null);
const message = ref('');
const capturedHeading = ref<HTMLHeadingElement | null>(null);
let captureId = 0;

function discardImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = null;
  captured.value = null;
  message.value = '';
}
async function start() {
  captureError.value = null;
  await startCamera();
}
function stop() {
  captureId++;
  capturing.value = false;
  ready.value = false;
  stopCamera();
}
async function capture() {
  if (!ready.value || capturing.value || !preview.value) return;
  const currentCapture = ++captureId;
  capturing.value = true;
  captureError.value = null;
  try {
    const page = await preview.value.captureFrame();
    if (currentCapture !== captureId) return;
    const url = URL.createObjectURL(page.blob);
    discardImage();
    captured.value = page;
    imageUrl.value = url;
    await nextTick();
    capturedHeading.value?.focus();
  } catch {
    if (currentCapture === captureId)
      captureError.value =
        'The image could not be captured. Wait for the live preview and try again.';
  } finally {
    if (currentCapture === captureId) capturing.value = false;
  }
}
async function retake() {
  discardImage();
  captureError.value = null;
  if (!isActive.value) await start();
}
function previewFailed(message: string) {
  stop();
  captureError.value = message;
}
onUnmounted(() => {
  captureId++;
  discardImage();
});
</script>

<template>
  <section class="scanner">
    <p class="eyebrow">01 / CAPTURE</p>
    <h1>Ready to scan a page?</h1>
    <p class="scanner-intro">
      Capture one page. Your image stays in this tab and is discarded when you
      leave.
    </p>
    <p v-if="error || captureError" class="scan-error" role="alert">
      {{ error || captureError }}
    </p>
    <div v-if="!isActive && !captured" class="camera-start">
      <p>
        BookLens needs access to your camera. Position your page in good light.
      </p>
      <AppButton :disabled="isStarting" @click="start">{{
        isStarting ? 'Starting camera…' : 'Start Camera'
      }}</AppButton>
      <p v-if="isStarting" role="status">
        Allow camera access in your browser when prompted.
      </p>
    </div>
    <!-- Keep the video mounted while reviewing so Retake reuses the live stream. -->
    <div v-show="!captured">
      <CameraPreview
        v-if="isActive"
        ref="preview"
        :stream="stream"
        :visible="!captured"
        @ready="ready = $event"
        @error="previewFailed"
      />
      <template v-if="isActive">
        <p class="scan-hint" role="status">
          {{
            ready
              ? 'Live camera · Position the whole page in the frame.'
              : 'Waiting for the camera preview…'
          }}
        </p>
        <AppButton :disabled="!ready || capturing" @click="capture">{{
          capturing ? 'Capturing…' : 'Capture'
        }}</AppButton>
      </template>
    </div>
    <div v-if="captured && imageUrl" class="captured-page">
      <h2 ref="capturedHeading" tabindex="-1">Captured Page</h2>
      <img
        :src="imageUrl"
        alt="Your captured page, ready for review"
        :width="captured.width"
        :height="captured.height"
      />
      <p class="scan-hint">
        {{ captured.width }} × {{ captured.height }} pixels ·
        {{
          isActive ? 'Camera is still on for a quick retake.' : 'Camera is off.'
        }}
      </p>
      <div class="scan-actions">
        <AppButton @click="retake">Retake</AppButton>
        <AppButton
          @click="
            message =
              'OCR will be added in the next phase. Your page has not been uploaded or processed.'
          "
          >Use Page</AppButton
        >
      </div>
      <p v-if="message" role="status">{{ message }}</p>
    </div>
    <button
      v-if="isActive || isStarting"
      class="stop-camera"
      type="button"
      @click="stop"
    >
      {{ isStarting ? 'Cancel camera startup' : 'Stop Camera' }}
    </button>
  </section>
</template>

<style scoped>
.scanner {
  max-width: 760px;
  margin: -32px auto 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.scanner h1 {
  font-size: clamp(2rem, 5vw, 3.2rem);
}
.scanner-intro,
.scan-hint {
  color: #58675f;
}
.scan-hint {
  font-size: 0.85rem;
}
.camera-start {
  padding: 24px;
  background: #e9ede4;
  border-radius: 12px;
}
.scan-error {
  padding: 16px;
  border: 1px solid #9c482d;
  border-radius: 8px;
  color: #79361f;
}
.scan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.captured-page img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 65svh;
  object-fit: contain;
  background: #14201b;
  border-radius: 12px;
}
.stop-camera {
  display: block;
  margin-top: 16px;
  min-height: 48px;
  padding: 10px 16px;
  border: 1px solid #58675f;
  background: transparent;
  color: inherit;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}
.scanner :deep(.app-button:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 480px) {
  .scan-actions > * {
    flex: 1;
    justify-content: center;
  }
}
</style>
