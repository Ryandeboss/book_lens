<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { downloadText } from '../../services/downloadText';
import { downloadBlob } from '../../services/downloadBlob';
import { createAudio } from '../../services/speechExport';
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
  error.value = '';
  try {
    downloadText(text.value);
  } catch {
    error.value = 'The download could not start. Please try again.';
  }
}
async function docx() {
  if (!allowed() || documentBusy.value) return;
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
    <div class="scan-actions">
      <button
        class="secondary-button"
        type="button"
        :disabled="!text.trim()"
        @click="txt"
      >
        Download TXT
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="!text.trim() || documentBusy"
        @click="docx"
      >
        {{ documentBusy ? 'Preparing DOCX...' : 'Download DOCX' }}
      </button>
    </div>
    <details class="audio-export">
      <summary>Listen to your document</summary>
      <p class="scan-hint">
        Create an MP3 from the text shown below. Text is sent to Google for
        speech generation; usage charges may apply. Longer documents take more
        time.
      </p>
      <div class="scan-actions">
        <button
          v-if="!audioUrl"
          class="secondary-button"
          type="button"
          :disabled="!text.trim() || audioBusy"
          @click="audio"
        >
          {{ audioBusy ? 'Creating MP3...' : 'Create MP3' }}
        </button>
        <button
          v-if="audioBusy"
          class="secondary-button"
          type="button"
          @click="cancelAudio"
        >
          Cancel audio
        </button>
        <a
          v-if="audioUrl"
          class="secondary-button"
          :href="audioUrl"
          download="booklens-scan.mp3"
          >Download MP3</a
        >
      </div>
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
    </details>
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
summary {
  cursor: pointer;
  min-height: 32px;
  font-size: 0.9rem;
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
