<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useScanStore } from '../../stores/scan';
import {
  apiUrl,
  cleanupFailure,
  cleanupStatusTimeoutMs,
  getProofreadStatus,
} from '../../services/api';
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
  <div class="cleanup-options">
    <label
      ><input v-model="session.cleanupEnabled" type="checkbox" /> AI cleanup for
      new pages</label
    >
    <p>
      Send OCR text to OpenAI to correct likely transcription errors. Original
      OCR is kept.
    </p>
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
        >Connected — OpenAI key missing</strong
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
    <details>
      <summary>Connection details</summary>
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
    </details>
  </div>
</template>
<style scoped>
.cleanup-options {
  border: 1px solid #9db9a8;
  border-radius: 10px;
  padding: 12px;
  margin: 12px 0;
  font-size: 0.9rem;
}
label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  min-height: 44px;
}
input {
  width: 20px;
  height: 20px;
}
p {
  margin: 6px 0;
}
.connection-result {
  padding: 8px;
  margin: 8px 0;
  border-radius: 6px;
}
.connected {
  background: #e6f4eb;
  color: #164b2d;
}
.failed,
.missing-key {
  background: #fff0db;
  color: #713d05;
}
details {
  margin-top: 10px;
  overflow-wrap: anywhere;
}
</style>
