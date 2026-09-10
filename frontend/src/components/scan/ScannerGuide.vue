<script setup lang="ts">
import { computed } from 'vue';
import { guideForFrame } from '../../services/scannerGeometry';
import type { AutoScanState, Quad } from '../../types/scanner';
const props = defineProps<{
  width: number;
  height: number;
  state: AutoScanState;
  corners: Quad | null;
}>();
const guide = computed(() => guideForFrame(props.width, props.height));
const points = computed(() =>
  props.corners
    ?.map((p) => `${p.x * props.width},${p.y * props.height}`)
    .join(' '),
);
</script>
<template>
  <svg
    class="scanner-guide"
    :class="state"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <rect
      :x="guide.x * width"
      :y="guide.y * height"
      :width="guide.width * width"
      :height="guide.height * height"
    />
    <polygon v-if="points" :points="points" />
  </svg>
</template>
<style scoped>
.scanner-guide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  color: #fff;
}
rect,
polygon {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}
polygon {
  stroke-width: 1;
  stroke-dasharray: 5 4;
}
.detected {
  color: #ffd16a;
}
.stabilizing {
  color: #bce5d1;
}
.captured {
  color: #59f59d;
  background: #39da7722;
}
</style>
