# Automatic book capture implementation and verification

BookLens keeps its Vue 3/TypeScript scanner, Pinia session, camera ownership, typed state machine, CV worker, perspective correction, background OCR queue, Google primary OCR, Tesseract fallback, Review and TXT export. This change hardens automatic capture rather than adding another scanner. No packages were added.

The margin/steadiness follow-up removes whitespace and text-edge margin gates, uses a 300ms hold with at least two samples, and increases motion/position tolerances. Follow-up verification: 123 tests (100 frontend +23 backend), lint, typecheck and builds pass. The browser measurements below record the original pipeline before this tuning.

## Capture pipeline

1. The live video uses the existing environment-facing camera preference, ideal 1920x1080 and ideal 30fps. These are preferences, not requirements. Actual settings/resolution appear only in development debug mode.
2. `useAutoScan` schedules analysis on a new video frame when supported, otherwise on a timer. Starts are at least 170ms apart (maximum 5.88Hz). There is one worker job at a time, including full-resolution processing. Missed opportunities do not become a backlog. Browser video playback remains independent.
3. The worker samples 64x64 grayscale pixels in the last reliable page region, or the frame before a page is known. It subtracts the mean exposure difference, then computes average absolute residual / 255. Above 0.035 blocks the frame before contour, sharpness or text work. New dimensions/ROI require a new baseline. Corner translation, area and perspective changes remain secondary stability signals.
4. Canny edges and contour approximation find four ordered page corners. A relaxed convex hull handles modest gutter/finger/curl irregularity. Minimum area, plausible portrait aspect, visible corners, guide alignment/coverage, candidate ambiguity and opposite-edge ratios prevent obviously bad crops. When no reliable polygon is found, the central guide region supplies quality/text analysis; fallback OCR retains the full photograph.
5. The page region is perspective-normalized to a maximum 480px edge. Brightness is its inset interior's grayscale mean. Sharpness is the variance of its Laplacian (`CV_64F`, squared standard deviation). Defaults require brightness >=90 and variance >=35. Failed lighting/focus skips text thresholding and contours. These values depend on analysis resolution, print size and device optics; they are not universal focus measurements.
6. Adaptive Gaussian thresholding, horizontal closing and contour boxes identify line-like components. Nearby aligned lines form one padded body rectangle. Fallback requires three rows, adequate width/height; no clear margin is required. A strong, sharp page polygon allows title, illustration and footnote pages even without dense body text. The body overlay describes visual structure, not recognized words. No OCR, network, LLM or TextDetector runs during preview analysis.
7. The existing machine requires every capture gate to pass for at least two consecutive samples AND 300ms. At the usual cadence this takes approximately 340ms after the first qualifying sample. Motion, poor focus/light, unsuitable content/geometry, material corner/scale changes or a long sampling gap reset that window. Queue capacity and an unlocked page are also required. Two fast samples alone cannot trigger capture.
8. A synchronous capture lock prevents concurrent shutters. `ImageCapture(track).takePhoto()` is preferred and attempted once with a 1.8s deadline. Missing/failed/timed-out/empty native output uses the video canvas at actual video dimensions. Failed native image decoding also falls back. Both paths produce a Blob and enter the existing processing pipeline.
9. Native photo decoding uses the browser's image orientation handling. Its own downscaled image is analyzed again before any crop: normalized corners from that still are multiplied by its full decoded dimensions for perspective correction. Preview and still may have different aspect ratios/fields of view; no center-crop assumption or preview-to-photo scaling is made. An unsuitable automatic native still is discarded and the scanner seeks a fresh stable page. Video fallback shares preview coordinates. Source images are capped at 8MP, corrected output at 2800px; JPEG quality stays 0.94.
10. The worker compares compact fingerprints against eight recent accepted pages before enqueueing. Acceptance reserves UUID/page number immediately. The accepted page/text outline is frozen and flashes green for 500ms. The sweep and progress show readiness; green means accepted, not OCR finished. OCR continues in the existing background queue.
11. The machine remains locked while the same content stays visible, independently of the flash timer. Consecutive meaningful content changes rearm it. Turning during feedback/backpressure is still observed. A fresh stability window follows. Ordinary guidance has a 220ms debounce; green/error/pause/capture messages are immediate.

## Duplicate protection, ordering and cleanup

Existing matching remains conservative: 40x56 normalized gray and edge samples, a 64-bit difference hash, 24 density cells, plus up to 80 ORB features computed only for capture candidates at a maximum 640px edge. All four strict visual gates must agree, or relaxed visual gates must agree with spatial ORB evidence. Mutual nearest Hamming matches require a ratio test, position agreement, at least 18 matches and three quadrants. ORB disagreement can veto a deceptively similar layout. Uncertain evidence favors accepting the page. Generated pages with the same typography/layout but different words are retained. Matching is heuristic: severe curvature, occlusion and nearly identical pages still need phone tests. In generated comparisons, an identical page translated in frame or under dimmer exposure was rejected correctly. One mildly tilted repeat had no qualifying ORB evidence and was accepted as uncertain. A repositioned repeat can therefore still appear twice; inspect/delete it in Review. This known false-negative case is recorded by the recognition script; thresholds were not loosened to risk discarding different text.

Fingerprints have a bounded eight-page history. Full photos are not retained for matching. CV Mats, ROI views, contours, transforms and ORB allocations are deleted in finally blocks; transferred bitmaps are closed. Without OffscreenCanvas, RGBA buffers are transferred into the worker, corrected there, then transferred back for canvas JPEG encoding. The main thread does no CV computation. Temporary canvases shrink to 1x1 and object URLs are revoked. The browser controls garbage collection; WASM heap high-water usage may persist until termination.

Pause, backgrounding, Stop, Done, track loss and unmount invalidate pending analysis/captures. Pause/Stop/Done terminate the CV worker and cancel frame callbacks/timers; generation checks discard late decoded photos and results. Resume starts fresh analysis while preserving the accepted-page lock. Done immediately stops new acceptance, drains already accepted OCR, then enters Review. Accepted OCR belongs to the app, so leaving Scan does not destroy it.

The queue still allows three pending/active images and 24MiB, one OCR request by default (configurable maximum two), and two failed retry images / 12MiB. Successful OCR releases image references. UUID updates preserve capture order even if OCR completes out of order. `/api/ocr`, Google credentials, Render root `backend`, Vercel root `frontend`, and Supabase remain unchanged.

## Changed files

Created:

- `frontend/src/services/frameMotion.ts` and `frameMotion.test.ts`: compact exposure-tolerant motion gate and tests.
- `frontend/src/services/stillCapture.ts` and `stillCapture.test.ts`: native/video Blob capture, decoding, transferable frame and encoding fallbacks with tests.
- `docs/automatic-capture-verification.md`: this report and phone checklist.

Modified:

- `frontend/src/composables/useAutoScan.ts`: frame scheduling, shutter integration, native geometry refresh, cancellation, debounced guidance and diagnostics.
- `frontend/src/composables/usePageDetection.ts` and its tests: bitmap/pixel transfer, still-analysis requests, cancellable fallback encoding.
- `frontend/src/composables/useCamera.ts` and its test: ideal 30fps preference; existing permission/error/track ownership retained.
- `frontend/src/services/imageProcessing.ts`: ordered motion/page/quality/text gates, restored page detection and worker encoding fallback.
- `frontend/src/services/scannerGeometry.ts`: extreme perspective rejection.
- `frontend/src/services/autoScanMachine.ts` and its tests: explicit motion/quality failures and stability diagnostics.
- `frontend/src/config/scanner.ts`, `frontend/src/types/scanner.ts`, `frontend/src/workers/imageProcessing.worker.ts`: thresholds, transferable/result types and motion state.
- `frontend/src/views/ScanView.vue` and its tests: expanded development diagnostics, scheduling/cancellation/native geometry coverage.
- `scripts/scanner-recognition-check.mjs`, `scripts/scanner-browser-check.mjs`: real OpenCV fixtures and browser compatibility paths.
- `README.md`, `docs/architecture.md`: current behavior and compatibility architecture.

Reused unchanged: CameraPreview, ScannerGuide animation, text-body grouping, page fingerprints/ORB matching, OCR queue, scan store, Google/Tesseract services, Review and TXT export.

## Verification and limits

Baseline: lint, typecheck, tests (81 frontend +23 backend), and both builds passed before edits; local main matched fetched origin/main.

Added unit/component coverage includes identical/exposure-shifted/moving frames, resolution reset, pass/pass/fail/pass stability, one-shot capture, non-overlapping video frame scheduling, native photo success/failure/empty/timeout/unavailable, late-photo cancellation, canvas pixel/encoding fallback, native coordinate re-detection, Pause/Resume stale analysis and pending processing after Pause/Done/Stop. Existing scanner, duplicate, queue ordering, mocked Google/fallback, Review and TXT tests remain.

Real OpenCV generated fixtures cover text, shifted/tilted pages, dim readable paper, a curved gutter, sparse title, illustration, borderless text, two-page spread, blank/dark/heavily blurred frames, motion short-circuit/recovery and distinct words with the same layout. Production Nginx browser checks exercise automatic capture, no capture during motion, animated text bounds, green feedback, held-page lock, next/backward page handling, manual duplicate rejection, upload validation/503, real browser Tesseract, ordered Review, camera shutdown and worker cleanup. Additional runs disable OffscreenCanvas in both browser and worker, and simulate a native 1600x1600 photo from a 900x1200 preview to exercise differing aspect/FOV mapping. They never call paid Google OCR.

Measured desktop headless Edge example: 75 post-warmup samples, median worker round trip 18.4ms, p95 32.3ms, about 4.98 analysis starts/sec including capture intervals. The synthetic camera runs at 20fps; these are not measurements of physical-phone preview FPS, focus, heat or battery. Real iPhone Safari/Android tests and configured Google transcription quality remain manual. Do not interpret device emulation or simulated native photos as physical-camera certification.

Final checks passed: root lint, typecheck, test (99 frontend +23 backend =122), build, Prettier formatting, and Docker frontend/backend builds. Nginx `/api/health` returned 200 with status ok; `/api/ocr/status` returned unconfigured as expected. The delivery message includes the commit SHA. Use the checked-in scripts against an isolated browser debugging endpoint, following the browser setup in `docs/phase4-verification.md`. Production smoke checks refuse to upload unless `/api/ocr/status` explicitly says Google is unconfigured. Test real Google OCR manually on the deployed HTTPS site after following `docs/google-document-ai-setup.md`.

## Phone checklist and tuning

On the Vercel HTTPS site, start a new scan, allow camera access, aim at one page and wait for green before turning. Use real books in addition to any printed test sheet. Repeat these cases on available phones:

| Test                                 | Expected behavior / useful tuning                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Bright room                       | Capture after a brief steady hold; avoid glare. Review tiny text afterward.                                                                       |
| 2. Dim room                          | Ask for more light or focus; improve lighting before lowering `minBrightness` (90).                                                               |
| 3. White modern page                 | Page and optional body outline, one automatic capture.                                                                                            |
| 4. Yellowed page                     | Exposure normalization should tolerate paper color; examine brightness and adaptive `textThresholdOffset` (12).                                   |
| 5. Small paperback                   | Move closer if page coverage is small; inspect `minPageArea` (0.12), `minGuideCoverage` (0.58), and print legibility.                             |
| 6. Large textbook                    | Include one page's corners; `singlePageMaxAspect` (1.12) and `minAspect` (0.4) control aspect acceptance.                                         |
| 7. Curved gutter                     | Mild curl should work; flatten severe curvature. Tune `contourRelaxedEpsilon` (0.045) only with visual crop review.                               |
| 8. Slight hand shake                 | Wait until steady; `motionDifference` (0.035), `cornerMovement` (0.04), `pageAreaMovement` (0.15) control tolerance.                              |
| 9. Very blurry movement              | No capture; `minSharpness` (35) and motion gate should block. Raise sharpness threshold if blurry pages get through.                              |
| 10. Mostly text                      | Body overlay and progress appear; fallback uses `textCaptureMinLines` (3), minimum body dimensions; no whitespace margin.                         |
| 11. Title page                       | Strong page boundary/focus permits sparse text without requiring three rows.                                                                      |
| 12. Illustration                     | A sharp, well-framed page can qualify despite uncertain dense-text evidence.                                                                      |
| 13. Footnotes                        | Verify final crop/OCR includes bottom notes and page number; do not crop to the main body.                                                        |
| 14. Hold same page 5+ seconds        | Exactly one accepted page; flash ending alone never rearms it.                                                                                    |
| 15. Move phone slightly on same page | It stays locked or rejects a known duplicate; inspect closest-page debug scores before changing thresholds.                                       |
| 16. Next very similar-looking page   | New page must be accepted. If stuck, inspect `pageChangeGray/Edges/Hash/Density` and `pageChangeSamples` (2). Avoid loosening duplicate matching. |
| 17. Go backward                      | A recently scanned page should show Already scanned without consuming another page number. History intentionally covers only eight pages.         |
| 18. Scan 10+ pages quickly           | Page order remains capture order, queue pauses/resumes within limits, Review/TXT remain usable.                                                   |
| 19. iPhone Safari                    | Test portrait/landscape, permission denial, tab background/Resume, Stop/restart. Expect canvas fallback where native photo is unavailable.        |
| 20. Chrome Android                   | Test native shutter on physical hardware, orientation/FOV changes, and fallback if the device rejects takePhoto.                                  |

If readiness takes too long with a truly steady page, inspect the blocked gate before changing settings. `stabilityMs` (300) and `stabilityMinSamples` (2) are BOTH required. Lowering them admits shorter holds; increasing them improves caution at the cost of speed. Geometry and focus thresholds should be tuned against sharp AND blurred samples. Keep duplicate thresholds conservative: wrongfully discarding a different page is worse than retaining a duplicate.

For performance, run a 5–10 minute session on each phone with 10+ pages. Observe preview smoothness, hand warmth, battery change and any long pauses. Use browser remote inspection/performance recording when available; compare preview frame rate, worker timing, long tasks and memory before, during and after Stop. Debug mode requires a local development build with `VITE_SCANNER_DEBUG=true` and shows actual camera settings, analysis dimensions/FPS/duration, motion, page coverage/alignment, focus/light, text presence/body, stable count/duration, current gate/state, closest duplicate and queue length. It is excluded from production.

If the preview stalls or the phone heats up, increase `analysisIntervalMs` before reducing analysis resolution. Reducing `analysisMaxEdge` (640) / `textPreviewMaxEdge` (480) requires retuning sharpness/text thresholds. Disable `ocrUseSmallerPng` to avoid the second encoding, or `orbEnabled` to measure feature-extraction cost. Do not increase queue/concurrency to hide a slow network. Check that memory plateaus and drops after Stop; immediate GC or WASM heap shrinking is not guaranteed.

## Browser API references

Native still support is feature-detected because [ImageCapture/takePhoto](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto) is not universal. [requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) follows video presentation, with the existing timer fallback for older browsers. [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) accelerates worker image handling; transferable RGBA and ordinary canvas encoding keep it optional. No new motion permission or platform-only text API is needed.

## Camera-analysis recovery follow-up

Resume now invalidates old work, terminates the analysis worker, resets frame scheduling, restarts a paused video and submits a fresh frame immediately. Previously it only reset the state machine, so a worker with failed initialization could fail repeatedly. Accepted pages and the OCR queue are preserved.

The scanner makes one bounded recovery attempt using a fresh worker and transferable RGBA pixels when initial analysis fails. Bitmap creation that rejects despite API presence falls back to pixels as well. Worker image encoding returns RGBA for browser canvas encoding if its OffscreenCanvas context or encoder is unusable. CV computations remain in the worker. Safe errors distinguish loading, initialization, timeout and analysis failures without displaying raw runtime errors or page data.

Verification: 129 tests (106 frontend +23 backend), lint, typecheck and builds pass. Tests cover worker replacement on Resume, paused video playback, Stop during pending Resume, failed bitmap conversion, automatic pixel recovery and safe worker error reporting. The Docker/Nginx browser smoke test passes with `--broken-worker-canvas`, deliberately advertising a worker canvas API whose context returns null. It recovers, captures two ordered pages, uploads corrected JPEG, uses real Tesseract fallback, rejects known duplicates, and terminates all three created workers. The exact original failure on the user's phone has not been observed directly; physical-device confirmation is still needed.
