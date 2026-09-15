<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { downloadText } from '../../services/downloadText';
import { downloadBlob } from '../../services/downloadBlob';
import { createAudio } from '../../services/speechExport';
import { printPdf } from '../../services/printPdf';
const formatsOpen = ref(false);
const props = defineProps<{ pages: string[]; pending: boolean }>();
const text = computed(() => props.pages.join('\n\n\n'));
const error = ref(''),
  audioMessage = ref(''),
  audioUrl = ref('');
const documentBusy = ref(false),
  audioBusy = ref(false);
let controller: AbortController | undefined;
function allowed() {
  return (
    !props.pending ||
    window.confirm(
      'Some pages are still being processed. Export the available text anyway?',
    )
  );
}
function txt() {
  if (!allowed()) return;
  formatsOpen.value = false;
  error.value = '';
  try {
    downloadText(text.value);
  } catch {
    error.value = 'The download could not start. Please try again.';
  }
}
async function docx() {
  if (!allowed() || documentBusy.value) return;
  formatsOpen.value = false;
  const pages = [...props.pages];
  error.value = '';
  documentBusy.value = true;
  try {
    const { createDocx } = await import('../../services/documentExport');
    downloadBlob(createDocx(pages), 'booklens-scan.docx');
  } catch {
    error.value = 'The Word document could not be created. Please try again.';
  } finally {
    documentBusy.value = false;
  }
}
function pdf() {
  if (!allowed()) return;
  error.value = '';
  try {
    printPdf([...props.pages]);
    formatsOpen.value = false;
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : 'PDF preview could not open. Please try again.';
  }
}
function releaseAudio() {
  controller?.abort();
  controller = undefined;
  audioBusy.value = false;
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
  audioUrl.value = '';
}
function cancelAudio() {
  releaseAudio();
  audioMessage.value = 'Audio creation cancelled. Your scan is kept.';
}
async function audio() {
  if (audioBusy.value || !allowed()) return;
  releaseAudio();
  const current = new AbortController();
  controller = current;
  audioBusy.value = true;
  audioMessage.value = '';
  error.value = '';
  try {
    const blob = await createAudio(
      text.value,
      current.signal,
      (done, total) => {
        if (controller === current)
          audioMessage.value = `Creating audio: ${done} of ${total} sections complete`;
      },
    );
    if (current.signal.aborted) return;
    audioUrl.value = URL.createObjectURL(blob);
    audioMessage.value = 'Your audio is ready.';
  } catch (cause) {
    if (!current.signal.aborted) {
      audioMessage.value = '';
      error.value =
        cause instanceof Error
          ? cause.message
          : 'Audio export failed. Please try again.';
    }
  } finally {
    if (controller === current) {
      controller = undefined;
      audioBusy.value = false;
    }
  }
}
watch(text, () => {
  if (audioBusy.value || audioUrl.value) {
    releaseAudio();
    audioMessage.value =
      'The text changed. Create audio again to include your latest edits.';
  }
});
onUnmounted(releaseAudio);
</script>

<template>
  <section class="downloads" aria-label="Download your document">
    <div class="scan-actions export-actions">
      <button
        class="secondary-button"
        type="button"
        :disabled="!text.trim() || documentBusy"
        :aria-expanded="formatsOpen"
        aria-controls="text-export-formats"
        @click="formatsOpen = !formatsOpen"
      >
        {{ documentBusy ? 'Preparing document...' : 'Download text' }}
      </button>
      <button
        v-if="!audioUrl"
        class="secondary-button"
        type="button"
        :disabled="!text.trim() || audioBusy"
        @click="audio"
      >
        {{ audioBusy ? 'Creating audio...' : 'Create audio' }}
      </button>
      <a
        v-else
        class="secondary-button"
        :href="audioUrl"
        download="booklens-scan.mp3"
        >Download audio</a
      >
    </div>
    <div
      v-if="formatsOpen"
      id="text-export-formats"
      class="format-options"
      @keydown.esc="formatsOpen = false"
    >
      <p class="format-label">Choose a format</p>
      <div class="scan-actions">
        <button class="secondary-button" type="button" @click="txt">TXT</button>
        <button class="secondary-button" type="button" @click="pdf">PDF</button>
        <button class="secondary-button" type="button" @click="docx">
          DOCX
        </button>
      </div>
      <p class="scan-hint">
        PDF opens print preview. Choose “Save as PDF” to save your document.
      </p>
    </div>
    <p class="scan-hint audio-note">
      Audio creates an MP3 using Google speech. Usage charges may apply.
    </p>
    <div v-if="audioBusy || audioMessage || audioUrl" class="audio-export">
      <button
        v-if="audioBusy"
        class="secondary-button"
        type="button"
        @click="cancelAudio"
      >
        Cancel audio
      </button>
      <p v-if="audioMessage" class="scan-hint" role="status">
        {{ audioMessage }}
      </p>
      <audio
        v-if="audioUrl"
        :src="audioUrl"
        controls
        preload="metadata"
        aria-label="Preview your scanned document"
      />
    </div>
    <p v-if="error" class="scan-error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.downloads {
  margin: 16px 0 24px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
.audio-export {
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.export-actions > .secondary-button {
  flex: 1;
  justify-content: center;
  text-align: center;
}
.format-options {
  margin-top: 14px;
  padding: 14px;
  border-radius: 8px;
  background: var(--background, #f7f9f5);
}
.format-label {
  margin: 0 0 10px;
  font-size: 0.8rem;
  font-weight: 600;
}
.audio-note {
  margin-bottom: 0;
}
audio {
  display: block;
  width: 100%;
  margin-top: 12px;
}
a.secondary-button {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
