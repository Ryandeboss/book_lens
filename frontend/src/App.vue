<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <header class="site-header">
    <RouterLink class="brand" to="/">BookLens</RouterLink>
    <nav aria-label="Main navigation">
      <RouterLink to="/scan">Scan</RouterLink>
      <RouterLink to="/review">Review</RouterLink>
      <RouterLink to="/library">Library</RouterLink>
    </nav>
  </header>
  <main id="main"><RouterView /></main>
  <footer>A little clarity for the pages you keep.</footer>
</template>
