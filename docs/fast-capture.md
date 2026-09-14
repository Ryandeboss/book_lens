# Fast whole-page capture

Fast capture is the default. Capture and recognition now have separate timing: the target is about three seconds between saved photos, while OCR and cleanup may take much longer. This is not a three-second promise for Google or OpenAI completion. Camera warm-up, mobile processing, page turning, autofocus and queue backpressure affect capture speed.

1. Start Camera with **Fast capture — OCR in background** selected.
2. Show one full page, including all four edges, with some surrounding background. Use a contrasting surface; white paper on white paper/background and a hidden book gutter can prevent automatic capture.
3. Hold still and in focus. The preview outlines the detected page, rather than just one text block.
4. Green means **the photo is queued in this tab**. Turn the page during the two-second pause; Google OCR and optional AI cleanup continue in the background.
5. Press Done and keep the tab open while processing finishes. Review low-confidence or incomplete text, restore any incorrectly flagged duplicate, then export TXT.

## What changed

- Fast mode skips the foreground 80% OCR gate and the potentially slow native camera shutter. It uses the camera's actual video resolution, capped at 8 MP, with high-quality compressed output capped at a 2800px longest edge.
- Paper contours must pass the existing size, alignment, clipping, perspective and ambiguity checks. A new check samples brightness across all four candidate edges; an interior paragraph rectangle with no paper/background boundary does not qualify.
- The exact captured image is analyzed again at low resolution before queuing. A shifted, clipped, dark or blurry photo is rejected locally without a paid OCR call. Manual Capture retains these whole-page/focus/light checks but skips the hold timer.
- Fast mode sends the **whole camera frame**, retaining surrounding context. It does not crop to a guessed text rectangle or page polygon. Google handles recognition of the photographed page; this change introduces no new provider, LLM image input or extra paid OCR request.
- The background queue exposes original OCR and confidence as soon as recognition finishes, checks duplicates in capture order, then performs optional cleanup. Later duplicates skip automatic cleanup. Low/missing confidence remains in the scan with a Review warning; the user decides whether to edit, rescan or delete it.
- Concurrency remains bounded at one job by default, configurable up to two in the existing OCR configuration. At 30 pending images / 48 MiB, capture waits for processing to free capacity. A failed image is retryable within the two-image / 12 MiB retry cache. Successful jobs release their images after processing. No permanent storage was added.

Full-page detection is a geometric/contrast heuristic. It cannot prove a sheet contains every word of a book page or distinguish every illustration from paper. Curled gutters, fingers covering edges, weak contrast and a two-page spread remain difficult. Keeping the entire camera frame prevents the crop itself from throwing away visible content; it cannot recover text outside the camera view. AI cleanup sees text only and cannot reconstruct unseen passages reliably.

## Previous workflow and rollback

Stop Camera and select **Verify OCR before saving — previous workflow** to return to the prior capture behavior without a deployment. That mode retains native photo capture, perspective correction/guide fallback, and the inclusive 80% confidence gate before accepting a shot. The selector is disabled while the camera or Done processing is active.

The exact working version preceding this change is saved remotely as:

```text
Tag: scanner-before-fast-capture-2026-09-14
Commit: 4ba71bd
```

For a code rollback, revert the fast-capture commit on `main` and push normally, then let both deployments finish. For an isolated inspection of the old code, create a branch from the tag. Do not reset shared `main` or force push. No environment variables, database migration, credentials or backend provider configuration need reverting.

## Verification

Unit/integration checks cover physical-edge evidence, missing/clipped edges, interior text rectangles, the exact-photo recheck, three captures with a stalled OCR promise, capture numbering, raw OCR before cleanup, duplicate cleanup skipping and low-confidence review. Existing verified-mode tests are preserved.

All 203 automated tests (157 frontend, 46 backend), lint, typechecks, formatting and frontend/backend production builds passed. Docker/Nginx built and started healthy. The final fast browser run rejected both invalid-page scenarios and averaged **2.87 seconds per photo**; the previous verified-mode browser run also passed capture, duplicate exclusion, review and worker/camera cleanup. No paid provider calls were used in these checks.

The browser check supports `node scripts/scanner-browser-check.mjs http://localhost --fast`. It uses generated camera pages, real OpenCV and Tesseract, and credential-free Docker services. Fast mode checks that borderless and bottom-clipped pages are rejected, then deliberately delays the cloud request for 12 seconds to verify photos continue queuing; it measures the average interval over the next two photos. The initial fast run measured **2.63 seconds between captures** on the local desktop browser, with three photos queued before OCR completed. This is synthetic test evidence, not a physical phone benchmark. The default invocation still exercises verified mode. Physical phone autofocus, real provider latency and varied books require manual testing.
