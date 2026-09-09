<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { CapturedPage } from '../../types/capture';
const props = withDefaults(
  defineProps<{ stream: MediaStream | null; visible?: boolean }>(),
  { visible: true },
);
const emit = defineEmits<{
  ready: [value: boolean];
  error: [message: string];
}>();
const video = ref<HTMLVideoElement | null>(null);
function updateReadiness() {
  const element = video.value;
  emit(
    'ready',
    Boolean(
      props.stream &&
      element &&
      element.srcObject === props.stream &&
      !element.paused &&
      element.readyState >= 2 &&
      element.videoWidth > 0 &&
      element.videoHeight > 0,
    ),
  );
}
watch(
  [() => props.stream, video, () => props.visible],
  async ([stream, element, visible], _previous, onCleanup) => {
    let stale = false;
    onCleanup(() => {
      stale = true;
    });
    emit('ready', false);
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    if (!stream || !visible) return;
    // Safari may pause a hidden video; resume it when Retake reveals the preview.
    try {
      element.muted = true;
      await element.play();
      if (!stale) updateReadiness();
    } catch {
      if (!stale)
        emit(
          'error',
          'The camera preview could not play. Stop the camera and try again.',
        );
    }
  },
  { flush: 'post' },
);
async function captureFrame(): Promise<CapturedPage> {
  const element = video.value;
  if (
    !props.stream ||
    !element ||
    element.srcObject !== props.stream ||
    element.paused ||
    element.readyState < 2 ||
    !element.videoWidth ||
    !element.videoHeight
  ) {
    throw new Error('Wait for the live camera preview before capturing.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = element.videoWidth;
  canvas.height = element.videoHeight;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('This browser could not create a captured image.');
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  // Lossless PNG retains the original frame dimensions for future OCR.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(
              new Error('The image could not be captured. Please try again.'),
            ),
      'image/png',
    );
  });
  return { blob, width: canvas.width, height: canvas.height };
}
onBeforeUnmount(() => {
  if (video.value) video.value.srcObject = null;
  emit('ready', false);
});
defineExpose({ captureFrame });
</script>
<template>
  <div class="camera-preview">
    <video
      ref="video"
      autoplay
      playsinline
      muted
      aria-label="Live camera preview"
      @loadeddata="updateReadiness"
      @canplay="updateReadiness"
      @playing="updateReadiness"
      @resize="updateReadiness"
      @pause="emit('ready', false)"
      @emptied="emit('ready', false)"
      @error="
        emit(
          'error',
          'The camera preview was interrupted. Stop the camera and try again.',
        )
      "
    />
  </div>
</template>
<style scoped>
.camera-preview {
  background: #14201b;
  border-radius: 12px;
  overflow: hidden;
}
video {
  display: block;
  width: 100%;
  height: min(58svh, 620px);
  min-height: 220px;
  object-fit: contain;
}
@media (orientation: landscape) and (max-height: 600px) {
  video {
    height: 65svh;
    min-height: 180px;
  }
}
</style>
