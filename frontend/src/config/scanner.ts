// Central tuning values. Detection coordinates are normalized to the camera frame.
export const scannerConfig = {
  analysisIntervalMs: 170, // At most ~6 checks/sec; only one analysis job in flight.
  analysisMaxEdge: 640,
  motionSize: 64, // Tiny grayscale ROI; higher sizes cost more per tick.
  motionDifference: 0.035, // Exposure-centered mean absolute difference / 255.
  stillTimeoutMs: 1800, // One native shutter attempt, then video fallback.
  pageOppositeEdgeRatio: 0.45, // Reject extreme perspective; allow book curl.
  statusHoldMs: 220, // Debounce ordinary guidance, never success/errors.
  guideAspect: 0.72, // Portrait page guide, not an enforced page aspect ratio.
  guideCoverage: 0.84,
  minPageArea: 0.12, // Fraction of camera frame.
  minAspect: 0.4,
  edgeMargin: 0.012, // Reject clipped corners.
  alignmentTolerance: 0.16, // Relative to guide dimensions.
  minGuideCoverage: 0.58,
  stabilityMs: 300,
  stabilityMinSamples: 2,
  maxSampleGapMs: 1500,
  cornerMovement: 0.04, // Distance in normalized frame coordinates, from stability anchor.
  stableVisualDifference: 0.06,
  minSharpness: 35, // Variance of Laplacian in the page interior at analysis size.
  minBrightness: 90, // 0..255.
  pageChangeDifference: 0.1,
  pageChangeSamples: 2,
  duplicateDifference: 0.009, // Very conservative normalized content fingerprint distance.
  recentFingerprints: 8,
  fingerprintWidth: 40,
  fingerprintHeight: 56,
  flashMs: 500,
  maxPendingImages: 3, // Includes currently processing image.
  maxPendingBytes: 24 * 1024 * 1024,
  maxRetryImages: 2,
  maxRetryBytes: 12 * 1024 * 1024,
  captureMaxPixels: 8_000_000,
  correctedMaxEdge: 2800,
  ocrImageType: 'image/jpeg',
  ocrJpegQuality: 0.94, // Keep small text legible; dimensions unchanged from Phase 4.
  ocrUseSmallerPng: true, // Clean synthetic/text pages sometimes compress better losslessly.
  workerTimeoutMs: 60000,
  cannyLow: 50,
  cannyHigh: 150,
  contourEpsilon: 0.025,
  contourRelaxedEpsilon: 0.045, // Allow mild gutter/finger irregularities via convex hull.
  singlePageMaxAspect: 1.12, // Wider candidates prompt centering one page.
  candidateAmbiguity: 0.12,
  textPreviewMaxEdge: 480,
  textThresholdBlock: 31,
  textThresholdOffset: 12,
  textLineKernelWidth: 9,
  textLineMinWidth: 0.06,
  textLineMaxHeight: 0.09,
  textLineMergeGap: 0.065,
  textCaptureMinLines: 3,
  textCaptureMinWidth: 0.25,
  textCaptureMinHeight: 0.12,
  textBodyMinArea: 0.008, // Sparse headings remain eligible; body is optional.
  textBodyMargin: 0.015,
  textBodyMovement: 0.06,
  textCenterMovement: 0.025,
  pageAreaMovement: 0.15,
  pageChangeGray: 0.015,
  pageChangeEdges: 0.015,
  pageChangeHash: 0.16,
  pageChangeDensity: 0.035,
  duplicateHash: 0.065,
  duplicateEdges: 0.022,
  duplicateDensity: 0.025,
  duplicateMessageCooldownMs: 1600,
  orbEnabled: true, // Runtime-probed; failure falls back to compact signatures.
  orbMaxFeatures: 80,
  orbMaxEdge: 640,
  orbMinMatches: 18,
  orbMatchRatio: 0.7,
  orbMaxHamming: 40,
  orbPositionTolerance: 0.045,
  orbDuplicateScore: 0.35,
  orbGrayGate: 0.025,
  orbHashGate: 0.18,
  orbEdgeGate: 0.035,
  orbDensityGate: 0.04,
} as const;
export const scannerDebug =
  import.meta.env.DEV && import.meta.env.VITE_SCANNER_DEBUG === 'true';
