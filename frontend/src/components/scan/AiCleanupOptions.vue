<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useScanStore } from '../../stores/scan';
import { getProofreadStatus } from '../../services/api';
const session = useScanStore();
const status = ref('Checking backend cleanup configuration...');
const checking = ref(false);
let controller: AbortController | null = null;
let disposed = false;
async function refresh() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  checking.value = true;
  const timeout = setTimeout(() => request.abort(), 8000);
  try {
    const configured = await getProofreadStatus(request.signal);
    if (!disposed && controller === request)
      status.value = configured
        ? 'OpenAI key detected on the backend. A cleanup request will verify model access.'
        : 'The backend reports no OpenAI key. Check OPENAI_API_KEY on the Render service and redeploy.';
  } catch {
    if (!disposed && controller === request)
      status.value =
        'Cannot reach cleanup status. Check the backend connection or deployment, then check again.';
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
    <p role="status">{{ status }}</p>
    <button
      type="button"
      class="secondary-button"
      :disabled="checking"
      @click="refresh"
    >
      {{ checking ? 'Checking cleanup...' : 'Check cleanup connection' }}
    </button>
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
</style>
