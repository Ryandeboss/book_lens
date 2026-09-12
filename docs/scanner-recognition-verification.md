# Scanner recognition and duplicate prevention

## Current behavior: text rectangle, margin, focus, then photo

The automatic decision now uses the text rectangle alone, across the whole preview. It measures ink in four padded margin bands (maximum 8%) and focus/brightness inside the block (minimum Laplacian variance 35 and brightness 90/255). Three valid samples over 450 ms trigger the photograph; no paper outline, paper aspect, or portrait-guide fit is required. Nested contours ensure a paper edge cannot hide the text inside it; enclosing paper/background contours are excluded from the margin mask. Consecutive-frame text-center movement must stay within 0.015 normalized units. The fixed guide is removed from the overlay.

The full photo is retained for OCR, including visible headings/footnotes. Only duplicate fingerprints/ORB features use the detected text region. The existing queue, Google primary, browser fallback, immediate green feedback, and image cleanup remain. Only one intended page should be in the photo; multiple pages are not automatically separated. A sparse single heading or illustration lacking a clear multi-line block may need Manual Capture.

New verification covers actual margin-band ink, focus/light gating, and real OpenCV detection of normal, borderless, shifted, tilted, dim-but-readable, gutter, blank, dark, and blurred fixtures. The fixture also rejects a repeated photo and accepts different text with the same layout. The earlier sections below describe previous implementations and their historical thresholds.

Validation for the current text-first flow: **104 tests passed** (81 frontend / 23 backend), plus lint, typecheck, frontend/backend builds, formatting, Docker/Nginx, real OpenCV quality fixtures, and complete automatic scan-to-Review browser runs with and without visible borders. These use synthetic camera pages; physical phone verification remains required.

## Automatic-capture follow-up

The original implementation could stay blocked without four detectable paper corners, and it discarded text-body detection in that case. Automatic scanning now accepts a stable, credible text block when the paper border is missing or does not align. It requires at least three printed rows, a 25%-wide/12%-tall region, and clear crop margins; blank or clipped text and ambiguous spreads do not qualify. Keep the complete page text inside the guide: this mode captures the guide, rather than cropping to only the main paragraph.

A sweep animates over the detected text, with a progress outline/bar while holding steady. The green flash means capture was accepted, not that Google OCR has completed; turn the page immediately. Reduced-motion preferences disable the sweep. Stability uses normalized page content, allows 0.025 corner/0.04 body movement, requires three samples plus 750 ms, and tolerates analysis gaps up to 1500 ms for slower phones. The lock distinguishes a detection-mode switch from a page turn. No Google or queue behavior changed.

Added regression coverage: missing-border automatic capture, slow sampling, translated guide content, detection-mode changes while locked, clipped/sparse text rejection, and visible progress followed by green feedback while OCR is pending. Real OpenCV fixtures now include a borderless page and a blank scene. `node scripts/scanner-browser-check.mjs http://localhost --borderless` exercises automatic two-page capture, hold/duplicate protection, backward turns, real fallback OCR and Review without relying on a paper edge. Repeat the phone checklist with a page filling the view and with white paper on a light background.

Verification of the follow-up passed: **101 tests** (78 frontend / 23 backend), lint, typecheck, frontend/backend builds, formatting, Docker/Nginx, health/status endpoints, real OpenCV fixtures, and the complete browser scan-to-Review test both with and without visible paper borders. Phone-camera testing remains manual.

## Original recognition phase

This phase extends the working automatic scanner. Google Document AI remains primary, with the existing browser Tesseract fallback. No backend, authentication, storage, AI proofreading, PDF, or deployment configuration changes were needed. No dependencies were added.

## Reused code and behavior

The existing `useAutoScan` coordinator, `AutoScanMachine`, OpenCV worker, camera lifecycle, geometry helpers, app-owned OCR queue, Pinia session, Review, and TXT export remain in place. Capture numbers are reserved before background OCR; Google response order never controls page order. Duplicate rejection happens before reservation or upload. Done stops the camera and drains accepted OCR jobs before Review.

Live analysis remains at most about six checks per second on a 640px frame. A 480px normalized page preview finds likely printed lines with adaptive thresholding and horizontal morphology. Nearby lines merge into one main text-body region; page numbers and large illustration contours are filtered by dimensions. The region is optional and approximate. Inverse homography maps it onto the camera preview. No preview frame goes to Google, and neither Tesseract nor ORB runs continuously.

The page outline follows four detected corners. A convex-hull/relaxed contour approximation accommodates modest irregularities; ambiguous wide spreads prompt centering one page. This is still planar perspective correction, not curved-page dewarping. A strong page outline and thinner body outline replace the old emphasis on the fixed guide. The SVG uses the same contain fit as the video.

A page must remain aligned, bright, sharp, and stable for 750 ms. Corner/perspective movement, area change, guide-content change, and body-position change restart the stability window. Missing text-body evidence does not block title/image pages. Manual Capture retains its existing quality/stability bypass and duplicate check.

After the queue accepts a page, the accepted body (or page when body is absent) flashes green for 500 ms, with a checkmark and ?Page N scanned - Turn the page.? The captured geometry is frozen, so an immediate turn does not move the success mask onto the next page. A timer expires the flash even when sampling is paused. OCR completion is unrelated to this feedback.

## Two distinct duplicate protections

1. **Held-page lock:** normalized content compares contrast-normalized/mean-centered gray, edges, difference hash, and ink density. Two changed signals over two consecutive samples rearm. Small phone shifts and global exposure changes are normalized away. When page geometry disappears, the existing guide signature can observe a physical turn. Turns are still observed during green feedback and queue backpressure.
2. **Recent-page check:** the worker compares each stable capture against the last eight accepted pages. Four strict visual thresholds must agree, or four relaxed gates plus consistent ORB matches must agree. Feature disagreement vetoes deceptively similar low-resolution layouts. Strong matches show amber **Already scanned. Turn to the next page.** and consume neither a queue slot nor a page number. The page is relocked, preventing repeated automatic warnings; diagnostic notification counting is limited to once per 1600 ms.

Each retained fingerprint contains 2,240 gray numbers, 2,240 edge numbers, a 16-character/64-bit difference hash, 24 ink-density cells, and optionally at most 80 normalized keypoint positions and 2,560 descriptor bytes. The legacy gray field references the same array. Only eight accepted pages retain fingerprint metadata; older OCR text/provider/paragraphs stay intact. No full image is retained for matching. Optional OCR-text fingerprinting was not added: duplicate decisions remain immediate and independent of Google latency.

The installed OpenCV bundle **does support ORB**. The real browser fixture confirmed 80 extracted features. Extraction runs only in the capture worker, at a maximum 640px edge. Matching uses mutual nearest Hamming descriptors, a 0.7 ratio test, maximum distance 40, positional tolerance 0.045, at least 18 matches across three quadrants, and a final matched-feature proportion of at least 0.35. The relaxed image gates must also pass. This permits slightly changed views without trusting generic book layout alone. Missing/failed features fall back to strict visual evidence. See [OpenCV's ORB explanation](https://docs.opencv.org/4.x/d1/d89/tutorial_py_orb.html).

Uncertain comparisons are accepted. These heuristics cannot prove that two photographed pages are identical: near-identical text, large shadows, reflections, significant gutter curvature, or occlusion can still cause missed duplicates or require tuning. A gutter fixture was detected correctly but conservatively not classified as identical to its unobstructed counterpart. Blank/no-information signatures do not trigger rejection. Always test adjacent real pages as well as duplicates before loosening thresholds.

## Cleanup and diagnostics

OpenCV Mats, contour vectors, keypoint vectors, descriptors, transforms, and ROIs are deleted in finally blocks; incoming ImageBitmaps are closed by the worker. Recent fingerprints contain copied compact arrays, not WASM references. Stop/unmount terminate CV work and discard stale results. OCR continues using its existing pending limit of three images / 24 MiB and retry limit of two images / 12 MiB. Successful Google or Tesseract OCR releases the queued Blob. No permanent images are stored or sent to Supabase. WASM heap capacity may stay at its high-water mark until worker termination; JavaScript memory is reclaimed by the browser.

Set `VITE_SCANNER_DEBUG=true` in **frontend/.env** locally and restart Vite. Open **Scanner debug** during scanning for page/body geometry, heuristic detection confidence (not an OCR probability), relaxed-boundary flag, alignment, sharpness, brightness, stability, page-change score, closest recent page, four comparison distances, ORB score, duplicate verdict/notice count, and analysis FPS. Production builds always hide it. The existing stopped-camera **Development: compare OCR engines** tool remains unchanged.

## Important thresholds

All settings live in `frontend/src/config/scanner.ts`; normalized distances are dimensionless, and lower comparison distances mean more similar images.

| Area                      | Defaults                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sampling and body preview | 170 ms, 640px analysis edge, 480px body preview                                                                                                                 |
| Stability                 | 750 ms; corner movement 0.018; guide difference 0.045; area change 0.10; body movement 0.025                                                                    |
| Page geometry             | existing approximation 0.025; relaxed convex hull 0.045; maximum single-page aspect 1.12; competing candidate score within 12%                                  |
| Body extraction           | adaptive block 31 / offset 12; horizontal kernel 9px; minimum line width 0.06; maximum line height 0.09; merge gap 0.065; minimum body area 0.008; margin 0.015 |
| Page change               | gray 0.015, edges 0.015, hash 0.16, density 0.035; any two, sustained over two samples; absent-page guide change 0.10                                           |
| Strict duplicate          | gray 0.009, hash 0.065, edges 0.022, density 0.025; all must pass                                                                                               |
| ORB comparison gates      | gray 0.025, hash 0.18, edges 0.035, density 0.04; all plus feature match must pass                                                                              |
| History and feedback      | last eight fingerprints (previously four); flash 500 ms; duplicate notification cooldown 1600 ms                                                                |

Most likely phone tuning: corner/body movement tolerance, 750 ms hold duration, sharpness threshold (35), lighting threshold (45/255), Canny contrast thresholds (50/150), text line dimensions/gaps, and page-change thresholds. Weak book borders may need contour tuning. Adjust duplicate thresholds only after collecting same-page and adjacent-page debug distances. Increasing tolerated duplicate distances or lowering ORB match requirements raises false-rejection risk. Change sampling interval before increasing memory limits on a slow phone.

## Files

Created:

- `frontend/src/services/textBody.ts`
- `frontend/src/services/textBody.test.ts`
- `frontend/src/services/pageFingerprint.test.ts`
- `scripts/scanner-recognition-check.mjs`
- `docs/scanner-recognition-verification.md`

Modified:

- `frontend/src/services/imageProcessing.ts`, `pageFingerprint.ts`, `autoScanMachine.ts`, `autoScanMachine.test.ts`, and `ocrQueue.ts`
- `frontend/src/workers/imageProcessing.worker.ts`
- `frontend/src/composables/useAutoScan.ts` and `usePageDetection.ts`
- `frontend/src/config/scanner.ts`
- `frontend/src/types/scanner.ts` and `Page.ts`
- `frontend/src/stores/scan.ts` and `scan.test.ts`
- `frontend/src/components/scan/ScannerGuide.vue`
- `frontend/src/views/ScanView.vue` and `ScanView.test.ts`
- `scripts/scanner-browser-check.mjs`
- `README.md` and `docs/architecture.md`

## Automated verification

Baseline: lint, typecheck, builds, and all 84 existing tests passed before edits. Final results are recorded after the checks below. Backend Google tests mock the SDK; no paid Google request is needed for verification.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run format:check
docker compose up --build -d
Invoke-RestMethod http://localhost/api/health
Invoke-RestMethod http://localhost/api/ocr/status
```

Use a dedicated hidden Edge/Chromium instance with remote debugging port 9225 and a temporary profile; the setup command is in [Phase 4 browser verification](phase4-verification.md). Do not use a browser containing unrelated work. With Vite running:

```powershell
node scripts/scanner-recognition-check.mjs http://localhost:5173
node scripts/scanner-browser-check.mjs http://localhost
```

The new fixture script uses the real OpenCV worker with generated text, shifted/tilted/exposure variants, a gutter, title page, image page, a wide spread, and different text sharing the same layout. It checks body/page detection, ORB availability, duplicate matching, and content-based rearming without requiring an empty transition. It makes **no OCR calls**. The extended full-app smoke test checks moving-page rejection, green regional feedback, holding a page five seconds, next-page capture, manual duplicate rejection, backward-page rejection, unchanged count/order, real Tesseract recognition, Done, and camera/worker cleanup. It uploads only if the backend explicitly reports Google unconfigured; otherwise it refuses to upload. Docker deliberately supplies no Google credentials.

New unit coverage tests conservative multi-signal matching, bounded history, exposure tolerance, feature consistency/veto, uncertain blank content, line grouping, sparse headings, normalized-content locking, body motion, feedback expiry, duplicate cooldown, queue exclusion/page numbering, frozen feedback while OCR is pending, and fingerprint pruning. Existing camera, queue cancellation/order/error, Google/fallback, Review, TXT, API, and worker lifecycle tests remain.

**Results:** all 96 tests passed (73 frontend, 23 backend); lint, typecheck, frontend/backend builds, and repository formatting passed. Both Docker images built and the backend is healthy. Nginx `/api/health` returned `status: ok`; `/api/ocr/status` returned `googleDocumentAiConfigured: false` in the intentionally unconfigured Docker environment. The real OpenCV fixture script and production Nginx scan-to-Review smoke test passed, including real Tesseract fallback. Vercel frontend/root and Render backend/root/build configuration remain compatible and unchanged. The existing OpenCV Node-module externalization notices remain non-fatal build warnings. Physical phone and configured Google OCR tests remain manual; synthetic browser fixtures are not a real-camera quality benchmark.

## Exact phone procedure

Use the deployed HTTPS Vercel site on Chrome Android and Safari iPhone, after the frontend deploy finishes. Use a fresh scan and a book with readable page numbers so you can compare the final order.

1. Hold one page still with all corners visible in good light.
2. Verify the strong detected outline follows the actual page when tilted slightly.
3. Verify the thinner main text-body outline appears around printed content.
4. Hold steady; verify automatic green regional flash/checkmark and the page count increments.
5. Keep that same page visible for five seconds.
6. Confirm no second capture or count increment occurs.
7. Move the phone slightly without turning the page; settle again.
8. Confirm the same page still does not capture twice.
9. Turn to the next page immediately after a green check.
10. Confirm the scanner rearms and shows Hold steady.
11. Confirm that page captures automatically and increments the count once.
12. Go backward to the prior page.
13. Confirm amber Already scanned; the count must stay unchanged.
14. Scan several consecutive text-heavy pages with similar headings/margins/layout.
15. Confirm each different page is accepted; note any false rejection with its page number and debug distances.
16. Scan a sparse title page; missing body detection must not permanently block it.
17. Scan a page containing an image; verify page/body overlays and accepted crop.
18. Scan near the gutter with mild curvature, then with a small finger near an edge. Center one page when both are visible. Confirm text is not cropped; severe curvature may need flattening/manual recapture.
19. Test low light; expect a useful lighting/blur prompt and no premature blurry capture.
20. Apply mild phone shake, then steady it; capture should resume only after the stability hold.
21. Press Done while OCR is still processing; confirm the camera stops and pending work finishes.
22. In Review, confirm every accepted page appears exactly once, in capture order. Edit a page and download TXT; verify edits and paragraph breaks.
23. Confirm configured Google OCR fills the correct pages and preserves raw text. Also test backend-unavailable fallback separately; failures must not erase other pages. Repeat Pause/Resume, orientation changes, background/foreground, and a 20-50-page session to assess mobile heat and responsiveness.

Report device/browser, lighting, page style, failed step, and debug values for tuning. Keep downloaded text before closing the tab. Google credentials and processor settings remain backend-only; no new environment variables or dashboard setup are needed for this scanner phase.
