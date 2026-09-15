<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import PageTextEditor from '../components/scan/PageTextEditor.vue';
import { useScanStore } from '../stores/scan';
import { downloadText } from '../services/downloadText';
import { useOcrQueue } from '../composables/useOcrQueue';
import AiCleanupOptions from '../components/scan/AiCleanupOptions.vue';
import { useReviewCleanup } from '../composables/useReviewCleanup';
import { useScanDraft } from '../composables/useScanDraft';

const session = useScanStore();
const router = useRouter();
const queue = useOcrQueue();
const cleanup = useReviewCleanup();
const draft = useScanDraft();
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
  await draft?.flush();
  void router.push('/scan');
}
async function finishScan() {
  if (
    !window.confirm(
      'Finish and clear this scan from this device? Download your TXT first if you want to keep it.',
    )
  )
    return;
  await queue.reset();
  session.clearSession();
  await draft?.flush();
  void router.push('/');
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
    <p class="eyebrow">Your document studio</p>
    <h1>Your document</h1>
    <p class="review-intro">A final look before the words are yours to keep.</p>
    <details class="review-tools">
      <summary>AI cleanup &amp; settings</summary>
      <AiCleanupOptions />
      <button
        class="secondary-button"
        type="button"
        :disabled="cleanup.busy.value || !cleanup.remaining.value.length"
        @click="cleanup.cleanRemaining"
      >
        {{
          cleanup.busy.value
            ? 'Cleaning text...'
            : 'Clean remaining pages with AI'
        }}
      </button>
      <p class="scan-hint">
        Cleanup uses existing OCR, without scanning again. Your manual edits
        stay in place; use the cleaned version below when ready.
      </p>
    </details>
    <p class="document-summary">
      {{ session.pages.length }}
      {{ session.pages.length === 1 ? 'page' : 'pages' }} · Download TXT to keep
      a permanent copy.
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
        <button
          type="button"
          class="secondary-button"
          :disabled="
            cleanup.busy.value ||
            !page.rawText.trim() ||
            page.rawText.length > 20000
          "
          @click="cleanup.cleanPage(page.id)"
        >
          {{
            cleanup.activeId.value === page.id
              ? 'Cleaning this page...'
              : page.cleanupStatus === 'applied'
                ? 'Run AI cleanup again'
                : 'Clean up with AI'
          }}
        </button>
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
          {{
            page.cleanupError ??
            'AI cleanup unavailable; original OCR kept. Use Clean up with AI to retry.'
          }}
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
    <button
      v-if="session.pages.length"
      class="secondary-button"
      type="button"
      @click="finishScan"
    >
      Finish scan
    </button>
  </section>
</template>
<style scoped>
.document-review {
  max-width: 760px;
  margin: 0 auto;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.review-intro {
  color: var(--muted);
  margin-top: -4px;
  font-size: 0.9rem;
}
.review-tools {
  margin: 22px 0 12px;
  padding: 4px 18px;
  background: #edf2eb;
  border-radius: 10px;
}
.review-tools > summary {
  color: #4d7058;
  font-weight: 550;
  font-size: 0.79rem;
}
.document-summary {
  font-size: 0.75rem;
  color: var(--muted);
}
.document-card > .scan-hint:first-child {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.6rem;
  margin: 0 0 18px;
  color: #7c9583;
}
.document-card > .secondary-button:last-child {
  color: #946459;
  background: transparent;
  border-color: transparent;
  font-size: 0.73rem;
}
.document-card > details {
  border-top: 1px solid var(--line);
  margin-top: 20px;
}
.duplicate-card {
  border-top: 1px solid var(--line);
  margin-top: 18px;
  padding-top: 14px;
}
.duplicate-card p {
  font-size: 0.8rem;
  color: var(--muted);
}
.document-card pre {
  padding: 18px;
  background: #f7f9f5;
  border-radius: 8px;
  font-size: 0.85rem;
  line-height: 1.8;
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
