<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useScanStore } from '../../stores/scan';
import {
  apiUrl,
  cleanupFailure,
  cleanupStatusTimeoutMs,
  getProofreadStatus,
} from '../../services/api';
defineProps<{ compact?: boolean }>();
const session = useScanStore();
const status = ref('Checking backend cleanup configuration...');
const checking = ref(false);
const result = ref<'connected' | 'missing-key' | 'failed' | null>(null);
const websiteOrigin = window.location.origin;
const endpoint = apiUrl;
let controller: AbortController | null = null;
let disposed = false;
async function refresh() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  checking.value = true;
  const timeout = setTimeout(() => request.abort(), cleanupStatusTimeoutMs);
  try {
    const configured = await getProofreadStatus(request.signal);
    if (!disposed && controller === request) {
      result.value = configured ? 'connected' : 'missing-key';
      status.value = configured
        ? 'OpenAI key detected on the backend. A cleanup request will verify model access.'
        : 'The backend reports no OpenAI key. Check OPENAI_API_KEY on the Render service and redeploy.';
    }
  } catch (error) {
    if (!disposed && controller === request) {
      result.value = 'failed';
      status.value = cleanupFailure(error);
    }
  } finally {
    clearTimeout(timeout);
    if (controller === request) checking.value = false;
  }
}
onMounted(() => {
  void refresh();
});
onUnmounted(() => {
  disposed = true;
  controller?.abort();
});
</script>
<template>
  <div class="cleanup-options" :class="{ compact }">
    <div class="cleanup-heading">
      <label
        ><span>AI cleanup <small>for new pages</small></span
        ><input v-model="session.cleanupEnabled" type="checkbox" role="switch"
      /></label>
      <span class="cleanup-badge" :class="result">{{
        checking
          ? 'Checking...'
          : result === 'connected'
            ? 'Connected'
            : result === 'missing-key'
              ? 'Not configured'
              : 'Connection issue'
      }}</span>
    </div>
    <p v-if="!compact" class="cleanup-description">
      Refine transcription with OpenAI. Your original text is always kept.
    </p>
    <details>
      <summary>Connection details</summary>
      <div
        role="status"
        aria-live="polite"
        :class="['connection-result', result]"
      >
        <strong v-if="checking"
          >Checking connection (allow up to a minute)...</strong
        >
        <strong v-else-if="result === 'connected'"
          >Connected to cleanup backend</strong
        >
        <strong v-else-if="result === 'missing-key'"
          >Connected; OpenAI key missing</strong
        >
        <strong v-else-if="result === 'failed'"
          >Cleanup connection check failed</strong
        >
        <p v-if="!checking">{{ status }}</p>
      </div>
      <button
        type="button"
        class="secondary-button"
        :disabled="checking"
        @click="refresh"
      >
        {{
          checking
            ? 'Checking cleanup...'
            : result
              ? 'Check again'
              : 'Check cleanup connection'
        }}
      </button>
      <p v-if="result === 'connected'">
        This check does not run AI cleanup. In Review, use “Clean up with AI” to
        retry a failed page.
      </p>
      <p>
        API address: <code>{{ endpoint }}</code>
      </p>
      <p>
        Website origin: <code>{{ websiteOrigin }}</code>
      </p>
      <p>
        In Vercel, set VITE_API_URL to your Render URL followed by /api, then
        redeploy the frontend. In Render, set FRONTEND_URL (or add to
        CORS_ORIGINS) to the website origin above, then redeploy the backend.
      </p>
      <p>
        With cleanup enabled, OCR text is sent to OpenAI. Original OCR is kept
        for review.
      </p>
    </details>
  </div>
</template>
<style scoped>
.cleanup-options {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 18px;
  margin: 18px 0;
  background: #fff;
  font-size: 0.8rem;
}
.cleanup-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
label {
  display: flex;
  align-items: center;
  gap: 14px;
  font-weight: 600;
  min-height: 36px;
  cursor: pointer;
}
small {
  font-weight: 400;
  color: var(--muted);
}
input {
  appearance: none;
  -webkit-appearance: none;
  width: 34px;
  height: 20px;
  padding: 3px;
  margin: 0;
  border-radius: 14px;
  border: 0;
  background: #c7d2c8;
  flex-shrink: 0;
  cursor: pointer;
}
input::before {
  content: '';
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px #0002;
  transition: transform 0.15s;
}
input:checked {
  background: var(--accent);
}
input:checked::before {
  transform: translateX(14px);
}
.cleanup-badge {
  font-size: 0.65rem;
  white-space: nowrap;
  color: var(--muted);
  background: #f0f3ef;
  padding: 3px 8px;
  border-radius: 5px;
}
.cleanup-badge.connected {
  color: #326349;
  background: #eef5ec;
}
.cleanup-badge.failed,
.cleanup-badge.missing-key {
  color: #835b24;
  background: #fff5e5;
}
p {
  margin: 7px 0;
  color: var(--muted);
}
.cleanup-description {
  margin: 2px 0 6px;
}
details {
  overflow-wrap: anywhere;
}
summary {
  color: var(--muted);
  font-size: 0.7rem;
  min-height: 32px;
  padding: 6px 0;
}
.connection-result {
  margin-top: 8px;
  padding: 12px;
  background: #f4f6f2;
  border-radius: 8px;
}
.connection-result.failed,
.connection-result.missing-key {
  background: #fff5e5;
}
.compact {
  margin: 12px 0 0;
  padding: 8px 14px;
}
.compact .cleanup-heading {
  min-height: 32px;
}
@media (max-width: 380px) {
  small {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  input::before {
    transition: none;
  }
}
</style>
