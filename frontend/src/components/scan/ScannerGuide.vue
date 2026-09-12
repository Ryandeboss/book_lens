<script setup lang="ts">
import { computed, useId } from 'vue';
import { guideForFrame } from '../../services/scannerGeometry';
import type { AutoScanState, Quad } from '../../types/scanner';
const props = defineProps<{
  width: number;
  height: number;
  state: AutoScanState;
  corners: Quad | null;
  textBody?: Quad | null;
  progress?: number;
}>();
const clipId = useId();
const isScanning = computed(
  () => props.state === 'stabilizing' || props.state === 'capturing',
);
const region = computed(() => props.textBody ?? props.corners);
const regionBounds = computed(() => {
  if (!region.value) return null;
  const xs = region.value.map((p) => p.x * props.width),
    ys = region.value.map((p) => p.y * props.height);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
});
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
    :class="[state, { found: !!points || !!bodyPoints }]"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="clipId">
        <polygon :points="bodyPoints || points" />
      </clipPath>
    </defs>
    <rect
      :x="guide.x * width"
      :y="guide.y * height"
      :width="guide.width * width"
      :height="guide.height * height"
    />
    <polygon v-if="points" class="page-boundary" :points="points" />
    <polygon v-if="bodyPoints" class="text-body" :points="bodyPoints" />
    <g
      v-if="isScanning && regionBounds"
      class="scanning-region"
      :clip-path="`url(#${clipId})`"
    >
      <polygon class="scanning-tint" :points="bodyPoints || points" />
      <line
        class="scan-sweep"
        :x1="regionBounds.x"
        :x2="regionBounds.x + regionBounds.width"
        :y1="regionBounds.y"
        :y2="regionBounds.y"
        :style="{ '--scan-distance': `${regionBounds.height}px` }"
      />
    </g>
    <polygon
      v-if="state === 'stabilizing' && (bodyPoints || points)"
      class="hold-progress"
      :points="bodyPoints || points"
      pathLength="100"
      :stroke-dasharray="`${Math.max(0, Math.min(1, progress ?? 0)) * 100} 100`"
    />
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
.stabilizing,
.capturing {
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

<style scoped>
.scanning-tint {
  fill: #83cfff15;
  stroke: none;
}
.scan-sweep {
  stroke: #b5edff;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
  animation: scan-sweep 1.1s ease-in-out infinite;
}
.hold-progress {
  stroke: #87ddff;
  stroke-width: 4;
  transition: stroke-dasharray 170ms linear;
}
.accepted-region {
  animation: accepted-flash 500ms ease-out;
}
@keyframes scan-sweep {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(var(--scan-distance));
  }
}
@keyframes accepted-flash {
  from {
    fill: #59f59d88;
  }
  to {
    fill: #39da7722;
  }
}
@media (prefers-reduced-motion: reduce) {
  .scan-sweep {
    animation: none;
  }
  .accepted-region {
    animation: none;
  }
  .hold-progress {
    transition: none;
  }
}
</style>
