# Phase 4 verification and phone tuning

Implemented September 10, 2026. Before changes, main matched origin/main at `646fe12ea62bc8a5523bc317bcdaa0c630d586ed`; existing lint, type checks, 29 frontend tests, 5 backend tests, and both builds passed.

## Delivered behavior

Start Camera -> fit one page in the guide -> hold steady -> green check -> turn page. Detection and corrected-image processing use one OpenCV worker; accepted images enter a separate sequential Tesseract queue. The camera remains usable while OCR runs. Done stops acceptance/camera, drains OCR, releases workers, and opens Review. Pause/Resume, Manual Capture, Stop Camera, text editing, deletion, raw OCR, TXT export, and confirmed new sessions are supported. Backgrounding pauses automatic scanning until Resume.

## Files created

- `frontend/src/config/scanner.ts`: documented tuning constants and development-only debug gate.
- `frontend/src/types/scanner.ts`: geometry, detection, worker messages, and scanner state types.
- `frontend/src/services/scannerGeometry.ts` and `.test.ts`: guide, corner ordering, alignment, output dimensions, fingerprint tests.
- `frontend/src/services/pageFingerprint.ts`: normalized grayscale signature/distance.
- `frontend/src/services/imageProcessing.ts`: contours, quality measurement, perspective correction, preprocessing, and OpenCV cleanup.
- `frontend/src/services/autoScanMachine.ts` and `.test.ts`: alignment, anchored stability, capture confirmation, page-change lock, pause, failure, Done.
- `frontend/src/services/ocrQueue.ts` and `.test.ts`: sequential jobs, numbering, count/byte limits, bounded retries, cancellation.
- `frontend/src/workers/imageProcessing.worker.ts`: lazy OpenCV runtime and transferable bitmap processing.
- `frontend/src/composables/usePageDetection.ts` and `.test.ts`: worker lifecycle, request correlation, timeout, transfer failures.
- `frontend/src/composables/useAutoScan.ts`: camera sampling and capture coordinator.
- `frontend/src/composables/useOcrQueue.ts`: App-owned queue injection.
- `frontend/src/components/scan/ScannerGuide.vue`: accessible visual alignment and capture overlay.
- `scripts/scanner-browser-check.mjs`: generated camera stream with real browser OpenCV/OCR checks.
- `docs/phase4-verification.md`: this report.

## Files modified

- `frontend/package.json`, `frontend/package-lock.json`: added `@techstark/opencv-js` 5.0.0-release.1; install reported zero vulnerabilities.
- `frontend/src/App.vue`: owns the OCR queue across route changes.
- `frontend/src/components/camera/CameraPreview.vue`: exposes the video element and adds the guide overlay slot.
- `frontend/src/types/Page.ts`, `frontend/src/stores/scan.ts`: capture-time reservation, statuses, fingerprints, result updates by UUID.
- `frontend/src/views/ScanView.vue`, `ScanView.test.ts`: continuous scanning UI and integration coverage, replacing the previous per-page acceptance flow.
- `frontend/src/views/ReviewView.vue`, `ReviewView.test.ts`: pending/error/ready states, retry, sparse-text hint, safe clearing and partial export confirmation.
- `frontend/.env.example`: optional local debug setting.
- `README.md`, `docs/architecture.md`: current usage, integration decision, ownership and limitations.

Backend, routing, Docker/Nginx configuration, and Vercel/Render settings are preserved. No Supabase, AI, PDF, or sharing dependencies were added.

## Detection and capture decisions

Analysis samples at most approximately 6 times/second (170 ms minimum interval) using a 640-pixel longest edge. Actual cadence falls with worker latency; jobs never overlap. OpenCV converts to grayscale, blurs, runs Canny, finds contours, approximates polygons, and scores large convex quadrilaterals with plausible aspect ratios and guide alignment.

Alignment checks visible corners, centered position, sufficient guide coverage, and distance outside the guide. Stability requires 750 ms of small corner movement from an anchor and small visual changes, with reset on sample gaps, motion, poor alignment, darkness, or blur. Laplacian variance is measured inside the candidate to avoid accepting a blurred page based only on its sharp outer edge.

Capture uses source camera dimensions capped at 8 megapixels. Normalized detected corners map to this full-resolution frame. Four-point perspective warping produces geometry-derived output dimensions capped at a 2800-pixel longest edge. Grayscale and a conservative global contrast stretch preserve text strokes; no hard/adaptive thresholding is applied.

Acceptance requires queue capacity and a sufficiently distinct corrected-page fingerprint. A numbered record is reserved immediately, followed by the green check; it confirms that the image entered the queue, not that OCR is finished. The primary lock observes a meaningful change in the guide signature for two consecutive samples before rearming. Turns are observed even during the green flash or OCR backpressure. New page alignment/stability/quality checks then apply. Secondary protection compares a mean-centered 40 x 56 grayscale fingerprint with the last four accepted pages using a conservative 0.009 distance threshold. OCR text is not used for duplicate detection.

## Queue and resource ownership

One existing Tesseract worker runs sequential OCR. The queue includes the active job in a maximum of 3 images / 24 MiB. Backpressure pauses acceptance until capacity is available. Results update the original UUID, preserving capture order and raw/edited separation. Failure marks only that page and continues the queue. At most 2 failed images / 12 MiB remain for Retry; older/oversized failed images require rescanning. Retry keeps its page number and reenters queued/processing states.

Blobs stay outside Pinia. Successful jobs release their image references; failed ones are bounded; reset/disposal clears retained jobs. Every OpenCV Mat, ROI, contour and transform is deleted in finally blocks, transferred bitmaps are closed, and scanner worker termination releases its WASM heap. Canvas buffers are reset on Stop/unmount. Camera tracks stop on Done, Stop, navigation, or disconnection. Accepted OCR can continue after ordinary route navigation because App owns its queue. Done releases the OCR worker after draining, and new-session/App cleanup cancels and invalidates late results. Actual garbage collection remains browser-managed.

## Automated results

| Check                                             | Result                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Frontend/backend lint                             | Passed                                                                                 |
| Frontend/backend type checks                      | Passed                                                                                 |
| Frontend tests                                    | 50 passed across 11 files                                                              |
| Backend tests                                     | 5 passed                                                                               |
| Formatting and Git whitespace checks              | Passed                                                                                 |
| Frontend/backend production builds                | Passed                                                                                 |
| Docker frontend/backend build and Compose startup | Passed                                                                                 |
| Nginx configuration                               | Passed                                                                                 |
| Native and Nginx-proxied `/api/health`            | Both returned `status: ok`, `service: booklens-api`                                    |
| Real browser OpenCV + Tesseract                   | Passed through Vite and production Nginx                                               |
| Generated-image motion/stability and page turn    | No moving-page capture; steady page captured; held page locked; next page captured     |
| Perspective correction                            | Tilted synthetic second page detected, corrected, and recognized in production browser |
| Green confirmation and manual duplicate rejection | Passed                                                                                 |
| Capture order and Done                            | Two text pages in correct order, Review after completion                               |
| Camera/worker release                             | Camera track ended; exactly two workers created and two terminated (one CV, one OCR)   |
| Mobile viewport                                   | 390 x 844 screenshot inspected; no horizontal overflow                                 |

Unit tests mock camera, vision, and OCR boundaries where necessary. They cover camera permission/cleanup regressions, scanner transitions, motion, quality gates, lock/rearming during flash/backpressure, sample gaps, conservative fingerprinting, guide geometry, queue order/capacity/failure/retry/reset, Done while OCR is pending, foreground/background controls, stop/restart, worker timeout/transfer failure, raw/edited text, download, deletion, and new-session confirmation. Browser tests use native video/canvas/worker/WASM APIs and actual OCR, but generated canvas input replaces physical camera hardware. Synthetic tests do not prove detection accuracy, memory stability, or acceptable latency across real phones and books.

The OpenCV production worker is approximately 15.6 MB before transfer compression. Vite reports externalized Node-only `fs` and `crypto` branches from the upstream distribution; the actual browser branch passed the production test. No generated worker assets, scanned images, language caches, browser profiles, or credentials belong in Git.

Hosted Render health and the canonical Vercel URL still require the project's actual public URLs. Local/backend regression results do not establish hosted availability. GitHub deployment status will be checked after pushing when accessible.

## Reproduce checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run format:check
docker compose up --build -d
docker compose exec frontend nginx -t
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost/api/health
```

For real browser checks, run a dedicated Chromium/Edge session with remote debugging on port 9225 and a temporary profile, then run the script from the project root. For example on this Windows machine:

```powershell
$scannerProfile = Join-Path (Get-Location) '.docker-local/phase4-edge'
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -WindowStyle Hidden -ArgumentList @('--headless=new', '--remote-debugging-port=9225', ('--user-data-dir="' + $scannerProfile + '"'), 'about:blank')
node scripts/scanner-browser-check.mjs http://localhost
# With npm.cmd run dev in another terminal:
node scripts/scanner-browser-check.mjs http://localhost:5173
```

The script targets a page in that dedicated browser, replaces its camera with generated non-copyrighted text pages, and saves an ignored screenshot under `.docker-local`. It needs Node 24, reachable browser debugging (override `BROWSER_DEBUG_URL` if needed), and internet for initial Tesseract resources. Do not point it at a browser containing unrelated work. Stop the dedicated browser process after verification.

## Exact phone checklist

Use the HTTPS Vercel site on Chrome Android and Safari iPhone. Start a fresh test session and download it before refresh. Check all of these conditions:

1. **Bright room / white page:** allow the rear camera; fit all corners, hold steady, observe green/check and increasing captured count. Hold that same page for 5 seconds: it must not duplicate.
2. **Dim room / yellowed page:** verify useful lighting/blur prompts and readable OCR without unstable capture behavior.
3. **Small paperback / large textbook:** verify guide fit, complete page boundaries, correct crop, and readable small text. Keep the full page inside the guide.
4. **Slightly curved page:** check gutter text and crop; compare OCR with the original. Flatten gently or rescan if distortion remains.
5. **Page with images / little text:** inspect accepted text and sparse-text hints. Manual Capture should work when reliable automatic detection is difficult.
6. **Portrait / landscape:** rotate before and during scanning. Verify guide alignment with the actual video, visible controls, no clipped text/corners, and a fresh stability window after orientation changes.
7. **Fast page turning:** turn immediately after each green check, including during the flash. Scan 10-20 distinct pages; compare count, order, adjacent similar layouts, and OCR results. Capture can pause for queue capacity; hold the next page until it resumes.
8. **Slow page turning:** keep each accepted page visible for several seconds, turn slowly, and check there are no repeated captures or skipped pages.
9. **Motion / focus:** move the page or phone, briefly defocus, and then hold steady. It should avoid blurred automatic captures and accept once stable/sharp.
10. **Background / Pause:** Pause blocks automatic capture; Manual Capture still works. Background and reopen the tab: tap Resume and verify the loop continues. Stop/start the camera and navigate away/back; confirm camera indicators turn off when stopped.
11. **Done / Review:** tap Done while OCR is pending, wait for Review, inspect all page numbers, edit text, delete a page, export TXT, and confirm new-session clearing. Failed OCR must leave other pages intact and offer Retry or rescan instructions.
12. **Longer session:** monitor warmth, responsiveness, initial worker-loading time, and whether performance deteriorates over 20-50 pages. Note device/browser, lighting, approximate timings, and debug values when reporting problems.

## Likely tuning values

All main settings are in `frontend/src/config/scanner.ts`. Set `VITE_SCANNER_DEBUG=true` in frontend/.env during local development to show alignment, corners, stability, sharpness, brightness, page-change/fingerprint scores, and analysis rate. Production always hides this panel.

| Symptom                                            | Values to inspect                                                               | Current defaults / direction                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Capture takes too long with normal handheld motion | `stabilityMs`, `cornerMovement`, `stableVisualDifference`                       | 750 ms, 0.018 normalized movement, 0.045 signature distance; cautiously relax after measuring |
| Captures while still moving                        | Same stability values, `minSharpness`                                           | Increase hold duration or tighten movement; verify real focus                                 |
| Bright/sharp pages fail quality checks             | `minSharpness`, `minBrightness`                                                 | 35 Laplacian variance, 45/255 brightness; measure before lowering                             |
| Weak page boundary / yellow paper                  | `cannyLow`, `cannyHigh`, `contourEpsilon`                                       | 50, 150, 0.025; test contrast and false candidates together                                   |
| Small/large pages cannot align                     | `minPageArea`, `minGuideCoverage`, `alignmentTolerance`, aspect limits          | 0.12 frame area, 0.58 guide area, 0.16 tolerance, 0.4-1.4 aspect                              |
| A real turn is missed                              | `pageChangeDifference`, `pageChangeSamples`                                     | 0.10, 2 samples; lower threshold cautiously, test held-page noise                             |
| Similar adjacent pages rejected                    | `duplicateDifference`                                                           | 0.009; lowering makes secondary duplicate rejection less aggressive                           |
| Exact duplicates slip through                      | `duplicateDifference`, primary page-change/stability settings                   | Compare signatures first; do not aggressively merge similar book layouts                      |
| Low-end phone gets hot/sluggish                    | `analysisIntervalMs`, `analysisMaxEdge`, `captureMaxPixels`, `correctedMaxEdge` | 170 ms, 640, 8 MP, 2800; sample less often or reduce dimensions                               |
| Queue often full                                   | `maxPendingImages`, `maxPendingBytes`                                           | 3, 24 MiB; optimize resolution/OCR first, avoid blindly increasing memory                     |

## Limits and next phase

Detection recognizes page-like geometry rather than understanding books. Center/area/quality gates reject many background rectangles, but a textured rectangular object deliberately filling the guide can still look like a document. Similar layouts, weak borders, fingers, glossy reflections, shadows, blank pages, or page turns too fast to appear in sampled frames can confuse detection. Manual capture bypasses automatic quality/stability gates; it still requires working image-processing browser APIs and checks duplicates. Perspective correction handles planar skew, not curved-page dewarping. Very similar pages can still need threshold tuning. English OCR, in-memory sessions, modern worker/OffscreenCanvas support, first-use downloads, and foreground processing remain assumptions.

Recommended Phase 5: integrate Supabase Auth and PostgreSQL so users can create accounts, save completed scan sessions, reopen/edit previous scans, and start new scans without losing their library. Phase 5 is intentionally not implemented here.
