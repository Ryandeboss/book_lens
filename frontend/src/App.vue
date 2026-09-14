<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { provideOcrQueue } from './composables/useOcrQueue';
provideOcrQueue();
const route = useRoute();
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
    <RouterView />
  </main>
  <footer v-if="route.path !== '/scan'">
    <span>BookLens</span><span>A little clarity for the pages you keep.</span>
  </footer>
</template>
