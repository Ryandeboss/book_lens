<script setup lang="ts">
import { onUnmounted, ref, shallowRef } from 'vue';
import { ocrPage } from '../../services/api';
import { useOcr } from '../../composables/useOcr';
import { ocrConfig } from '../../config/ocr';
const fallback = useOcr();
const file = shallowRef<File | null>(null),
  busy = ref(false);
const google = ref(''),
  tesseract = ref(''),
  message = ref('');
let controller: AbortController | null = null,
  disposed = false;
function select(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0];
  input.value = '';
  file.value = null;
  message.value = '';
  if (
    selected &&
    ['image/jpeg', 'image/png'].includes(selected.type) &&
    selected.size <= ocrConfig.maxUploadBytes
  )
    file.value = selected;
  else message.value = 'Choose one PNG/JPEG up to 12 MiB.';
}
async function compare() {
  if (!import.meta.env.DEV || !file.value || busy.value) return;
  busy.value = true;
  google.value = '';
  tesseract.value = '';
  const image = file.value;
  file.value = null;
  controller = new AbortController();
  const results = await Promise.allSettled([
    ocrPage(image, crypto.randomUUID(), controller.signal),
    fallback.recognize(image),
  ]);
  if (!disposed) {
    google.value =
      results[0].status === 'fulfilled'
        ? results[0].value.text
        : 'Google OCR unavailable. Check backend configuration.';
    tesseract.value =
      results[1].status === 'fulfilled' && results[1].value
        ? results[1].value.rawText
        : 'Tesseract failed.';
    busy.value = false;
  }
  await fallback.terminate();
}
onUnmounted(() => {
  disposed = true;
  controller?.abort();
  file.value = null;
});
</script>
<template>
  <details class="ocr-comparison">
    <summary>Development: compare OCR engines</summary>
    <p>
      Select one corrected page or test image. Compare uploads it to Google once
      (billable when configured) and also runs Tesseract. Results do not change
      your scan.
    </p>
    <input
      type="file"
      accept="image/png,image/jpeg"
      aria-label="OCR comparison image"
      :disabled="busy"
      @change="select"
    />
    <p v-if="file">{{ file.name }}</p>
    <p v-if="message">{{ message }}</p>
    <button type="button" :disabled="!file || busy" @click="compare">
      {{ busy ? 'Comparing...' : 'Compare this image' }}
    </button>
    <h3>Google Document AI</h3>
    <pre>{{ google }}</pre>
    <h3>Tesseract</h3>
    <pre>{{ tesseract }}</pre>
  </details>
</template>
<style scoped>
.ocr-comparison {
  padding: 16px;
  margin-top: 16px;
  border: 1px solid #999;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
input {
  max-width: 100%;
}
</style>
