<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import PageTextEditor from '../components/scan/PageTextEditor.vue';
import { useScanStore } from '../stores/scan';
import { downloadText } from '../services/downloadText';
import { useOcrQueue } from '../composables/useOcrQueue';

const session = useScanStore();
const router = useRouter();
const queue = useOcrQueue();
const exportError = ref('');
function removePage(id: string) {
  if (window.confirm('Delete this page from your document?')) {
    queue.forget(id);
    session.removePage(id);
  }
}
async function startNew() {
  if (
    session.pages.length &&
    !window.confirm(
      'Start a new scan? Your current document will be cleared. Download it first if you want to keep it.',
    )
  )
    return;
  await queue.reset();
  session.clearSession();
  void router.push('/scan');
}
function download() {
  if (
    session.pages.some((p) => p.status !== 'ready') &&
    !window.confirm(
      'Some pages have not been read. Download available text anyway?',
    )
  )
    return;
  exportError.value = '';
  try {
    downloadText(session.combinedText);
  } catch {
    exportError.value = 'The download could not start. Please try again.';
  }
}
</script>
<template>
  <section class="document-review">
    <p class="eyebrow">02 / REVIEW</p>
    <h1>Your document</h1>
    <p>
      {{ session.pages.length }}
      {{ session.pages.length === 1 ? 'page' : 'pages' }} · Edits stay in this
      tab. Download before refreshing or closing.
    </p>
    <p v-if="!session.pages.length">
      No pages yet. Scan a page to start your document.
    </p>
    <div class="scan-actions">
      <AppButton v-if="session.pages.length" @click="download"
        >Download TXT</AppButton
      >
      <AppButton to="/scan">{{
        session.pages.length ? 'Scan Another Page' : 'Start Scanning'
      }}</AppButton>
    </div>
    <p v-if="exportError" class="scan-error" role="alert">{{ exportError }}</p>
    <p v-if="session.duplicatePages.length" role="status">
      {{ session.duplicatePages.length }} likely duplicate(s) set aside below
      and excluded from TXT.
    </p>
    <article
      v-for="page in session.includedPages"
      :key="page.id"
      class="document-card"
    >
      <p class="scan-hint">
        Original shot {{ page.capturePosition ?? page.pageNumber }}
      </p>
      <PageTextEditor
        v-if="page.status === 'ready'"
        :id="`page-${page.id}`"
        :page-number="page.pageNumber"
        :model-value="page.editedText"
        :confidence="page.confidence"
        @update:model-value="session.updatePage(page.id, $event)"
      />
      <div v-else>
        <h2>
          Page {{ page.pageNumber }} —
          {{ page.status === 'error' ? 'OCR failed' : page.status }}
        </h2>
        <p role="status">
          {{ page.error ?? 'This page is being read in the background.' }}
        </p>
        <AppButton
          v-if="page.status === 'error' && queue.canRetry(page.id)"
          :disabled="!queue.hasCapacity.value"
          @click="queue.retry(page.id)"
          >Retry</AppButton
        >
        <p v-else-if="page.status === 'error'">
          The temporary image has been released. Delete this page and scan it
          again.
        </p>
      </div>
      <p
        v-if="page.status === 'ready' && page.rawText.trim().length < 10"
        class="scan-hint"
      >
        Very little text was detected. Review, edit, or delete this page.
      </p>
      <template v-if="page.status === 'ready'">
        <p v-if="page.cleanupStatus === 'applied'" class="scan-hint">
          AI cleanup applied. Review corrections before downloading.
        </p>
        <p
          v-else-if="
            page.cleanupStatus === 'failed' ||
            page.cleanupStatus === 'unavailable'
          "
          class="scan-hint"
        >
          AI cleanup unavailable; original OCR kept.
        </p>
        <details>
          <summary>Original OCR and corrections</summary>
          <h3>Original OCR</h3>
          <pre>{{ page.rawText }}</pre>
          <button
            type="button"
            class="secondary-button"
            @click="session.updatePage(page.id, page.rawText)"
          >
            Use original OCR
          </button>
          <template v-if="page.correctedText !== undefined">
            <h3>AI cleaned text</h3>
            <pre>{{ page.correctedText }}</pre>
            <button
              type="button"
              class="secondary-button"
              @click="session.updatePage(page.id, page.correctedText!)"
            >
              Use cleaned text
            </button>
          </template>
        </details>
        <button
          v-if="page.duplicateOf"
          type="button"
          class="secondary-button"
          @click="session.keepDuplicate(page.id, false)"
        >
          Set duplicate aside again
        </button>
      </template>
      <button
        class="secondary-button"
        type="button"
        :aria-label="`Delete Page ${page.pageNumber}`"
        @click="removePage(page.id)"
      >
        Delete Page
      </button>
    </article>
    <details v-if="session.duplicatePages.length" class="document-card" open>
      <summary>
        Likely duplicates — excluded from TXT ({{
          session.duplicatePages.length
        }})
      </summary>
      <article
        v-for="page in session.duplicatePages"
        :key="page.id"
        class="duplicate-card"
      >
        <h2>Shot {{ page.capturePosition ?? page.pageNumber }}</h2>
        <p>
          Matches original shot
          {{
            session.pages.find((p) => p.id === page.duplicateOf)
              ?.capturePosition
          }}
          ({{ Math.round((page.duplicateScore ?? 0) * 100) }}% text match). Its
          place in the scan is preserved.
        </p>
        <details>
          <summary>Inspect original OCR</summary>
          <pre>{{ page.rawText }}</pre>
        </details>
        <button
          type="button"
          class="secondary-button"
          @click="session.keepDuplicate(page.id, true)"
        >
          Keep this page in TXT
        </button>
        <button
          type="button"
          class="secondary-button"
          @click="removePage(page.id)"
        >
          Delete duplicate
        </button>
      </article>
    </details>
    <details v-if="session.pages.length" class="document-card">
      <summary>Combined document preview</summary>
      <pre>{{ session.combinedText }}</pre>
    </details>
    <button class="secondary-button" type="button" @click="startNew">
      Start New Scan
    </button>
  </section>
</template>
<style scoped>
.document-review {
  max-width: 760px;
  margin: -32px auto 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.document-review h1 {
  font-size: clamp(2rem, 5vw, 3.2rem);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
summary {
  cursor: pointer;
  min-height: 44px;
}
</style>
