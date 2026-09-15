<script setup lang="ts">
import { computed, useId } from 'vue';
import type { AutoScanState } from '../../types/scanner';
const props = defineProps<{
  width: number;
  height: number;
  state: AutoScanState;
  progress?: number;
}>();
const clipId = useId();
const isScanning = computed(
  () => props.state === 'stabilizing' || props.state === 'capturing',
);
// The overlay always covers the complete camera image, never a detected text box.
const points = computed(
  () =>
    '0,0 ' +
    props.width +
    ',0 ' +
    props.width +
    ',' +
    props.height +
    ' 0,' +
    props.height,
);
const regionBounds = computed(() => ({
  x: 0,
  y: 0,
  width: props.width,
  height: props.height,
}));
const center = computed(() => ({ x: props.width / 2, y: props.height / 2 }));
</script>
<template>
  <svg
    class="scanner-guide"
    :class="state"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="clipId">
        <polygon :points="points" />
      </clipPath>
    </defs>
    <polygon v-if="points" class="page-boundary" :points="points" />
    <g
      v-if="isScanning && regionBounds"
      class="scanning-region"
      :clip-path="`url(#${clipId})`"
    >
      <polygon class="scanning-tint" :points="points" />
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
      v-if="state === 'stabilizing' && points"
      class="hold-progress"
      :points="points"
      pathLength="100"
      :stroke-dasharray="`${Math.max(0, Math.min(1, progress ?? 0)) * 100} 100`"
    />
    <polygon
      v-if="state === 'captured' && points"
      class="accepted-region"
      :points="points"
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
  stroke: #188fb9;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
  animation: scan-sweep 1.1s ease-in-out infinite;
}
.hold-progress {
  stroke: #188fb9;
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
