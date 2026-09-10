// Central tuning values. Detection coordinates are normalized to the camera frame.
export const scannerConfig = {
  analysisIntervalMs: 170, // At most ~6 checks/sec; only one analysis job in flight.
  analysisMaxEdge: 640,
  guideAspect: 0.72, // Portrait page guide, not an enforced page aspect ratio.
  guideCoverage: 0.84,
  minPageArea: 0.12, // Fraction of camera frame.
  minAspect: 0.4,
  maxAspect: 1.4,
  edgeMargin: 0.012, // Reject clipped corners.
  alignmentTolerance: 0.16, // Relative to guide dimensions.
  minGuideCoverage: 0.58,
  stabilityMs: 750,
  maxSampleGapMs: 650,
  cornerMovement: 0.018, // Distance in normalized frame coordinates, from stability anchor.
  stableVisualDifference: 0.045,
  minSharpness: 35, // Variance of Laplacian in the page interior at analysis size.
  minBrightness: 45, // 0..255.
  pageChangeDifference: 0.1,
  pageChangeSamples: 2,
  duplicateDifference: 0.009, // Very conservative normalized content fingerprint distance.
  recentFingerprints: 4,
  fingerprintWidth: 40,
  fingerprintHeight: 56,
  flashMs: 500,
  maxPendingImages: 3, // Includes currently processing image.
  maxPendingBytes: 24 * 1024 * 1024,
  maxRetryImages: 2,
  maxRetryBytes: 12 * 1024 * 1024,
  captureMaxPixels: 8_000_000,
  correctedMaxEdge: 2800,
  workerTimeoutMs: 60000,
  cannyLow: 50,
  cannyHigh: 150,
  contourEpsilon: 0.025,
} as const;
export const scannerDebug =
  import.meta.env.DEV && import.meta.env.VITE_SCANNER_DEBUG === 'true';
