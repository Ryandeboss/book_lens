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
  <section class="home-hero">
    <div class="hero-copy">
      <p class="eyebrow">A new chapter for your words</p>
      <h1>From the page.<br /><em>Into your hands.</em></h1>
      <p class="intro">
        Turn the pages you love into text you can edit, refine and keep. Just
        point your camera and let BookLens take it from there.
      </p>
      <AppButton to="/scan"
        >Start Scanning <span aria-hidden="true">&#8599;</span></AppButton
      >
      <p class="hero-note">Your camera. Your pages. Your words.</p>
      <details class="home-status">
        <summary>Service status</summary>
        <p class="api-status" role="status">{{ apiStatus }}</p>
      </details>
    </div>
    <div class="page-study" aria-hidden="true">
      <span class="study-label">PAPER, MEET POSSIBILITY</span>
      <div class="paper-back"></div>
      <div class="paper-front">
        <span class="paper-chapter">CHAPTER ONE</span>
        <h2>The words<br />we keep.</h2>
        <div class="paper-rule"></div>
        <div class="paper-lines"><i v-for="line in 9" :key="line"></i></div>
        <span class="paper-number">01</span><span class="scan-corner top"></span
        ><span class="scan-corner bottom"></span>
      </div>
      <div class="study-caption">
        <span class="caption-dot"></span> A little clarity. A world of words.
      </div>
    </div>
  </section>
  <section class="home-steps" aria-label="How BookLens works">
    <article>
      <span>01</span>
      <div>
        <h2>Capture naturally.</h2>
        <p>Hold steady. Wait for green. Turn the page.</p>
      </div>
    </article>
    <article>
      <span>02</span>
      <div>
        <h2>Make it yours.</h2>
        <p>Review the text and refine it with optional AI cleanup.</p>
      </div>
    </article>
    <article>
      <span>03</span>
      <div>
        <h2>Keep the words.</h2>
        <p>Download your document as an editable text file.</p>
      </div>
    </article>
  </section>
</template>
<style scoped>
.home-hero {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 60px;
  align-items: center;
  padding: 12px 0 64px;
}
.hero-copy h1 em {
  color: #61816a;
  font-weight: 400;
}
.hero-copy .intro {
  line-height: 1.8;
  font-size: 0.97rem;
}
.hero-note {
  color: var(--muted);
  font-size: 0.73rem;
  margin: 18px 0 0;
}
.home-status {
  color: var(--muted);
  margin-top: 4px;
}
.home-status summary {
  font-size: 0.65rem;
  min-height: 28px;
}
.home-status .api-status {
  margin-top: 0;
}
.page-study {
  position: relative;
  min-height: 460px;
  border-radius: 24px;
  background: #eaf0e6;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.study-label {
  position: absolute;
  top: 26px;
  left: 28px;
  font-size: 0.55rem;
  letter-spacing: 0.19em;
  color: #69816d;
}
.paper-back {
  position: absolute;
  width: 238px;
  height: 306px;
  background: #d4e0cb;
  transform: rotate(-11deg);
  border-radius: 3px;
}
.paper-front {
  position: relative;
  width: 238px;
  height: 306px;
  padding: 30px;
  background: #fffefa;
  transform: rotate(5deg);
  box-shadow: 0 20px 45px #284c2920;
}
.paper-chapter {
  font-size: 0.45rem;
  letter-spacing: 0.18em;
  color: #78917e;
}
.paper-front h2 {
  font-family: Georgia, serif;
  font-size: 1.9rem;
  line-height: 1.1;
  margin: 12px 0 16px;
  font-weight: 400;
}
.paper-rule {
  height: 1px;
  width: 28px;
  background: #78917e;
  margin-bottom: 20px;
}
.paper-lines {
  display: grid;
  gap: 8px;
}
.paper-lines i {
  height: 2px;
  background: #cbd2c6;
}
.paper-lines i:nth-child(3n) {
  width: 85%;
}
.paper-number {
  display: block;
  margin-top: 20px;
  text-align: center;
  font:
    0.6rem Georgia,
    serif;
  color: #78917e;
}
.scan-corner {
  position: absolute;
  width: 25px;
  height: 25px;
  border-color: #69a17d;
  border-style: solid;
}
.scan-corner.top {
  top: -10px;
  left: -10px;
  border-width: 2px 0 0 2px;
}
.scan-corner.bottom {
  bottom: -10px;
  right: -10px;
  border-width: 0 2px 2px 0;
}
.study-caption {
  position: absolute;
  bottom: 25px;
  font-size: 0.65rem;
  color: #607965;
  display: flex;
  align-items: center;
  gap: 8px;
}
.caption-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #719e78;
}
.home-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--line);
  padding-top: 28px;
  gap: 24px;
}
.home-steps article {
  display: flex;
  gap: 16px;
}
.home-steps article > span {
  font-size: 0.65rem;
  color: #7a9582;
  padding-top: 5px;
}
.home-steps h2 {
  font-size: 0.91rem;
  margin: 0 0 7px;
}
.home-steps p {
  font-size: 0.77rem;
  color: var(--muted);
  margin: 0;
}
@media (max-width: 760px) {
  .home-hero {
    grid-template-columns: 1fr;
    gap: 30px;
    padding-bottom: 32px;
  }
  .page-study {
    min-height: 340px;
  }
  .paper-front,
  .paper-back {
    scale: 0.8;
  }
  .home-steps {
    grid-template-columns: 1fr;
    gap: 22px;
  }
}
</style>
