<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import CameraPreview from '../components/camera/CameraPreview.vue';
import { useCamera } from '../composables/useCamera';
import type { CapturedPage } from '../types/capture';
import PageTextEditor from '../components/scan/PageTextEditor.vue';
import { useOcr } from '../composables/useOcr';
import { useScanStore } from '../stores/scan';
import type { OcrResult } from '../types/Page';

const router = useRouter();
const session = useScanStore();
const ocr = useOcr();
const { isInitializing, isProcessing, progress, status, error: ocrError } = ocr;
const stage = ref<
  'capture' | 'preview' | 'processing' | 'pageReview' | 'added'
>('capture');
const draft = shallowRef<OcrResult | null>(null);
const editedText = ref('');
const acceptSparse = ref(false);
const sparseText = computed(
  () => draft.value !== null && draft.value.rawText.trim().length < 10,
);
const canAdd = computed(
  () => draft.value !== null && (!sparseText.value || acceptSparse.value),
);
let readId = 0;

const { stream, isActive, isStarting, error, startCamera, stopCamera } =
  useCamera();
const preview = ref<InstanceType<typeof CameraPreview> | null>(null);
const ready = ref(false);
const capturing = ref(false);
const captured = shallowRef<CapturedPage | null>(null);
const imageUrl = ref<string | null>(null);
const captureError = ref<string | null>(null);
const capturedHeading = ref<HTMLHeadingElement | null>(null);
let captureId = 0;

function discardImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = null;
  captured.value = null;
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
    stage.value = 'preview';
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
  readId++;
  if (isProcessing.value) await ocr.terminate();
  discardImage();
  draft.value = null;
  editedText.value = '';
  acceptSparse.value = false;
  ocrError.value = null;
  stage.value = 'capture';
  captureError.value = null;
  if (!isActive.value) await start();
}
async function readPage() {
  if (!captured.value || isProcessing.value) return;
  const current = ++readId;
  stage.value = 'processing';
  const result = await ocr.recognize(captured.value.blob);
  if (current !== readId) return;
  if (!result) {
    stage.value = 'preview';
    return;
  }
  draft.value = result;
  editedText.value = result.rawText;
  acceptSparse.value = false;
  stage.value = 'pageReview';
}
function addPage() {
  if (!draft.value || !canAdd.value || stage.value !== 'pageReview') return;
  session.addPage({ ...draft.value, editedText: editedText.value });
  discardImage();
  draft.value = null;
  editedText.value = '';
  stage.value = 'added';
}
function finish() {
  void router.push('/review');
}
function previewFailed(message: string) {
  stop();
  captureError.value = message;
}
onUnmounted(() => {
  readId++;
  captureId++;
  discardImage();
});
</script>

<template>
  <section class="scanner">
    <p class="eyebrow">01 / CAPTURE</p>
    <h1>Ready to scan a page?</h1>
    <p class="scanner-intro">
      Capture, read, and edit each page. Your document stays in this tab until
      you download it. Refreshing clears the session.
    </p>
    <p class="scan-hint">Pages scanned: {{ session.pages.length }}</p>
    <p v-if="error || captureError" class="scan-error" role="alert">
      {{ error || captureError }}
    </p>
    <div v-if="!isActive && stage === 'capture'" class="camera-start">
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
    <div v-show="stage === 'capture'">
      <CameraPreview
        v-if="isActive"
        ref="preview"
        :stream="stream"
        :visible="stage === 'capture'"
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
    <div
      v-if="stage === 'preview' && captured && imageUrl"
      class="captured-page"
    >
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
        <AppButton @click="readPage">{{
          ocrError ? 'Try Again' : 'Use Page'
        }}</AppButton>
      </div>
      <p v-if="ocrError" class="scan-error" role="alert">{{ ocrError }}</p>
    </div>
    <div v-if="stage === 'processing'" class="document-card" aria-busy="true">
      <h2>Reading page...</h2>
      <p role="status">
        {{ status }}{{ progress !== null ? ` · ${progress}%` : '' }}
      </p>
      <progress
        :value="progress ?? undefined"
        max="100"
        aria-label="OCR stage progress"
      />
      <p class="scan-hint">
        {{
          isInitializing
            ? 'Preparing English OCR for the first page.'
            : 'Keep this tab open while your page is read.'
        }}
        This may take several seconds on a phone. Progress is for the current
        stage.
      </p>
      <AppButton @click="retake">Cancel and Rescan</AppButton>
    </div>
    <div v-if="stage === 'pageReview' && draft" class="document-card">
      <h2>Review this page</h2>
      <p>Check the raw OCR and edit any mistakes before adding the page.</p>
      <PageTextEditor
        id="draft-text"
        v-model="editedText"
        :page-number="session.currentPageNumber"
        :confidence="draft.confidence"
      />
      <div v-if="sparseText" class="sparse-notice">
        <p role="status">
          Very little text was detected on this page. You can rescan or continue
          anyway.
        </p>
        <label
          ><input v-model="acceptSparse" type="checkbox" /> Add this page
          anyway</label
        >
      </div>
      <div class="scan-actions">
        <AppButton @click="retake">Rescan Page</AppButton>
        <AppButton :disabled="!canAdd" @click="addPage">Add Page</AppButton>
      </div>
    </div>
    <div v-if="stage === 'added'" class="document-card">
      <h2>Page added</h2>
      <p role="status">
        {{ session.pages.length }}
        {{ session.pages.length === 1 ? 'page' : 'pages' }} in your document.
      </p>
      <div class="scan-actions">
        <AppButton @click="retake">Scan Next Page</AppButton>
        <AppButton @click="finish">Finish</AppButton>
      </div>
    </div>
    <AppButton
      v-if="stage === 'capture' && session.pages.length"
      class="review-document"
      @click="finish"
      >Review Document</AppButton
    >
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
.review-document {
  margin-top: 16px;
}
.sparse-notice {
  margin: 16px 0;
  padding: 16px;
  background: #f4e9cc;
  border-radius: 8px;
}
.sparse-notice label {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 48px;
}
@media (max-width: 480px) {
  .scan-actions > * {
    flex: 1;
    justify-content: center;
  }
}
</style>
