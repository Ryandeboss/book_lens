<script setup lang="ts">
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { onUnmounted, provide } from 'vue';
import { provideOcrQueue } from './composables/useOcrQueue';
import { useScanStore } from './stores/scan';
import { createScanDraft } from './services/scanDraft';
import { scanDraftKey } from './composables/useScanDraft';
import AppButton from './components/common/AppButton.vue';
const session = useScanStore();
const queue = provideOcrQueue();
const draft = createScanDraft(session, queue);
provide(scanDraftKey, draft);
void draft.init();
onUnmounted(draft.dispose);
const route = useRoute();
const router = useRouter();
async function resumeDraft() {
  if (await draft.resume()) await router.push('/review');
}
</script>

<template>
  <header class="site-header">
    <RouterLink class="brand" to="/" aria-label="BookLens home">
      <svg
        class="brand-mark"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="9" fill="currentColor" />
        <path
          d="M8 9h5c2 0 3 1 3 2 0-1 1-2 3-2h5v14h-5c-2 0-3 1-3 1s-1-1-3-1H8V9Z"
          stroke="#fff"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <path d="M16 11v13" stroke="#fff" stroke-width="1.5" />
      </svg>
      BookLens<span class="brand-caption">Words worth keeping.</span>
    </RouterLink>
    <nav aria-label="Main navigation">
      <RouterLink to="/scan">Scan</RouterLink>
      <RouterLink to="/review">Review</RouterLink>
    </nav>
  </header>
  <main id="main" :class="{ 'scan-layout': route.path === '/scan' }">
    <p v-if="!draft.ready.value" role="status">Checking for a saved scan...</p>
    <section
      v-else-if="draft.previous.value"
      class="draft-recovery"
      aria-labelledby="resume-title"
    >
      <p class="eyebrow">Welcome back</p>
      <h1 id="resume-title">Resume previous scan?</h1>
      <p>
        {{ draft.previous.value.pages.length }}
        {{ draft.previous.value.pages.length === 1 ? 'page' : 'pages' }} saved
        on this device. Last saved
        {{ new Date(draft.previous.value.updatedAt).toLocaleString() }}.
      </p>
      <p>
        Continue reviewing your text or scanning more pages. Unfinished drafts
        expire after 24 hours without changes.
      </p>
      <div class="scan-actions">
        <AppButton :disabled="draft.saving.value" @click="resumeDraft"
          >Resume scan</AppButton
        >
        <button
          class="secondary-button"
          :disabled="draft.saving.value"
          @click="draft.discard"
        >
          Discard draft
        </button>
      </div>
    </section>
    <RouterView v-else />
    <p v-if="draft.error.value" class="draft-warning" role="alert">
      {{ draft.error.value }}
    </p>
    <p
      v-else-if="session.pages.length && !draft.previous.value"
      class="draft-status"
      role="status"
    >
      {{
        draft.expired.value
          ? 'Local draft expired. Download TXT or make an edit to save again.'
          : draft.saving.value
            ? 'Saving draft...'
            : draft.savedAt.value
              ? 'Draft saved on this device · available for 24 hours'
              : 'Saving draft...'
      }}
    </p>
  </main>
  <footer v-if="route.path !== '/scan'">
    <span>BookLens</span><span>A little clarity for the pages you keep.</span>
  </footer>
</template>
<style scoped>
.draft-recovery {
  max-width: 640px;
  margin: 32px auto;
  padding: 28px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.draft-recovery p {
  color: var(--muted);
}
.draft-status {
  color: var(--muted);
  font-size: 0.75rem;
  text-align: center;
  margin: 12px 0;
}
.draft-warning {
  color: #835b24;
  background: #fff5e5;
  border-radius: 8px;
  padding: 12px;
  font-size: 0.85rem;
}
</style>
