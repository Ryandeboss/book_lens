<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppButton from '../components/common/AppButton.vue';
import { getHealth } from '../services/api';

const apiStatus = ref('Checking API…');
onMounted(async () => {
  try {
    await getHealth();
    apiStatus.value = 'API connected';
  } catch {
    apiStatus.value = 'API unavailable';
  }
});
</script>

<template>
  <section class="hero">
    <p class="eyebrow">FROM PAPER TO POSSIBILITY</p>
    <h1>Turn printed pages<br />into editable text.</h1>
    <p class="intro">A simple home for the words you want to keep.</p>
    <AppButton to="/scan"
      >Start Scanning <span aria-hidden="true">↗</span></AppButton
    >
    <p class="api-status" role="status">{{ apiStatus }}</p>
  </section>
</template>
