<script setup lang="ts">
import { RouterLink } from 'vue-router';
defineProps<{ to?: string }>();
</script>

<template>
  <RouterLink v-if="to" class="app-button" :to="to"><slot /></RouterLink>
  <button v-else class="app-button" type="button"><slot /></button>
</template>
