<script setup lang="ts">
import { computed } from 'vue';
import { guideForFrame } from '../../services/scannerGeometry';
import type { AutoScanState, Quad } from '../../types/scanner';
const props = defineProps<{
  width: number;
  height: number;
  state: AutoScanState;
  corners: Quad | null;
  textBody?: Quad | null;
}>();
const guide = computed(() => guideForFrame(props.width, props.height));
const asPoints = (quad?: Quad | null) =>
  quad?.map((p) => `${p.x * props.width},${p.y * props.height}`).join(' ');
const points = computed(() => asPoints(props.corners));
const bodyPoints = computed(() => asPoints(props.textBody));
const center = computed(() => {
  const region = props.textBody ?? props.corners;
  return region
    ? {
        x: (region.reduce((n, p) => n + p.x, 0) * props.width) / 4,
        y: (region.reduce((n, p) => n + p.y, 0) * props.height) / 4,
      }
    : null;
});
</script>
<template>
  <svg
    class="scanner-guide"
    :class="[state, { found: !!points }]"
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
    <polygon v-if="points" class="page-boundary" :points="points" />
    <polygon v-if="bodyPoints" class="text-body" :points="bodyPoints" />
    <polygon
      v-if="state === 'captured' && (bodyPoints || points)"
      class="accepted-region"
      :points="bodyPoints || points"
    />
    <text
      v-if="state === 'captured' && center"
      :x="center.x"
      :y="center.y"
      :font-size="Math.min(width, height) * 0.12"
      text-anchor="middle"
      dominant-baseline="central"
      fill="currentColor"
      stroke="#143c27"
      stroke-width="1"
    >
      &#10003;
    </text>
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
rect {
  stroke-width: 1.5;
  stroke-dasharray: 8 6;
  opacity: 0.65;
}
.found rect {
  opacity: 0.18;
}
.page-boundary {
  stroke-width: 3;
}
.text-body {
  stroke-width: 1.5;
  stroke-dasharray: 5 3;
  opacity: 0.9;
}
.detected,
.duplicate {
  color: #ffd16a;
}
.stabilizing {
  color: #bce5d1;
}
.captured {
  color: #59f59d;
}
.accepted-region {
  fill: #39da7744;
  stroke-width: 3;
}
</style>
