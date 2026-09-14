# Architecture

```text
Development:

Browser
   |
   +---- Vue/Vite :5173
             |
             | HTTP/JSON (direct browser request, CORS)
             v
        Node/Express :3000
             |
             v
        Google Document AI (primary OCR)

Docker:

Browser
   |
   v
 Nginx :80
   |
   +---- / --------> Vue static build
   |
   +---- /api/ ----> Node/Express :3000
                         |
                         v
                    Google Document AI (primary OCR)
```

## Responsibilities

- `frontend/src/views`: route-level screens. Vue's `script setup` declares component state and logic; its template renders that state. `ref` is reactive state, and `onMounted` runs after mounting.
- `components/common`: reusable presentation, including AppButton. `components/camera/CameraPreview.vue` owns the video element, stream attachment, readiness, and frame capture.
- `composables/useCamera.ts`: obtains and releases camera streams and provides reactive startup, active, and error state.
- `composables/useOcr.ts`: lazily initializes an English Tesseract worker, reports its progress, handles recognition/retry/cancellation, and terminates on unmount.
- `stores/scan.ts`: Pinia state for captured pages, queued/processing/ready/error status, raw/edited text, numbering, confidence, OCR provider, original paragraphs/languages, fingerprints, and combined text. No MediaStreams or photographs live in the store.
- `components/scan/PageTextEditor.vue`: labeled textarea for ready pages in Review.
- `services/downloadText.ts`: UTF-8 Blob download and delayed object URL cleanup.
- `services/api.ts`: browser HTTP boundary, multipart image upload/cancellation, and response validation. Views do not construct URLs.
- `router`: history-mode routes. Nginx and Vercel must serve index.html on deep links so Vue can select the view.
- `backend/src/routes`: associate HTTP paths with controllers.
- `controllers`: translate HTTP requests/responses into service calls.
- `services`: business logic. Health returns process liveness without a database dependency.
- `repositories`: future Supabase data access. No database/client is created while credentials are missing.
- `schemas`: future request/domain validation. Current environment validation lives alongside configuration.
- `middleware`: centralized JSON errors. Logs redact authorization/cookie headers; internal errors are not returned to callers.
- `config`: validated runtime environment and logger.
- `app.ts`: wires middleware and routes without listening, allowing Supertest to test it.
- `server.ts`: binds the HTTP listener and handles shutdown.
- `nginx`: static-file serving and reverse proxy; it neither executes Vue source nor owns business logic.

Future request flow: route -> controller -> service -> repository -> hosted Supabase. Keep important business rules on the backend and service-role credentials server-only. Authentication and authorization will be a separate milestone; CORS is only a browser policy, not access control.

## Deployment boundaries

Vercel serves the compiled frontend; Render runs the compiled backend. Their independent lockfiles allow installation with either directory as deployment root. Docker is a local production-like alternative, not a requirement for Vercel/Render deployment. Docker service-name DNS resolves `backend`; browsers never receive that internal hostname.

Vite environment values are build-time public settings. Express environment values are runtime server settings. The Docker frontend intentionally builds with `/api`; native development uses localhost:3000/api; Vercel will use the actual Render origin.

## Continuous scanning and cloud OCR

```text
CameraPreview -> OpenCV motion/page/light/focus checks -> stable trial photo
    -> perspective correction / compressed JPEG or PNG
    -> queue.inspect -> Google Document AI (Tesseract fallback)
    -> confidence >=80% and nonblank text?
         no: discard candidate, pause with guidance; Resume retries
         yes: reserve UUID/shot position, green confirmation, two-second pause
    -> background queue.refine (reuses OCR) -> optional OpenAI cleanup
    -> duplicate text comparison -> Review -> TXT
```

`useAutoScan.ts` coordinates scheduling and resource ownership. The typed `AutoScanMachine` owns searching, detected, stabilizing, capturing, captured, cooldown, paused, finishing, and error states (legacy visual-lock helpers remain for compatibility). Additional refs describe actual camera/worker lifecycle and user pause. Sampling never overlaps; full-resolution processing temporarily occupies the same CV worker. The scheduler prefers requestVideoFrameCallback, checking elapsed time before submitting a frame. A duration-aware timer is the fallback. Only one analysis/capture occupies the worker; slow devices skip opportunities instead of queuing preview frames. Main-thread work is limited to browser image decode, canvas copying/resizing, transferable creation and (only without worker OffscreenCanvas) canvas JPEG encoding. All CV computations remain in the worker.

`scannerGeometry.ts` supplies normalized guide/corner math, candidate alignment, and output dimensions. `imageProcessing.ts` owns OpenCV operations. `usePageDetection.ts` lazily creates a module worker, correlates requests, transfers bitmap ownership, and handles crashes/timeouts. The worker closes each bitmap and deletes temporary Mats, contours, transforms, and ROI objects in finally blocks. Pause, backgrounding, Stop, Done, and Scan unmount terminate it; generation checks discard stale results and close snapshots returned after cancellation. Camera streams keep the existing permission, late-request, track-ended, and unmount cleanup protections.

Live analysis fails early in a fixed order. A 64x64 grayscale sample compares consecutive views with exposure-centered mean absolute difference. It uses the last reliable page region, or the central page guide when no border is known; changing the ROI/resolution resets its baseline. Motion skips page contours, Laplacian, and text analysis. Canny contours, quadrilateral approximation and a relaxed convex hull pass then find visible page corners. Area, aspect, guide alignment, ambiguity and opposite-edge ratios reject clipped/tiny/extremely skewed or two-page candidates while tolerating modest curl/gutter irregularities. A central guide ROI supplies fallback analysis when the paper boundary is weak.

The worker perspective-normalizes the page ROI to at most 480px and measures brightness and Laplacian variance in its inset interior. Dark or blurry frames skip adaptive thresholding and text contours. Gaussian adaptive thresholding plus horizontal morphology forms line components. `textBody.ts` groups nearby aligned rows and estimates one padded body rectangle. Text boxes supply optional overlays only. Focus, lighting, motion and stable page/guide geometry qualify a photo without a dense text block or surrounding whitespace. A guide-region fallback handles weak paper boundaries. This is local visual evidence, with no preview OCR, ML runtime, TextDetector, or network request.

The existing state machine requires both at least two consecutive acceptable samples and 300ms of stable corners, scale, body position and content. Any failed gate resets readiness. A geometry change or sample gap restarts the window. Ordinary guidance is debounced 220ms; shutter/success/error/pause messages remain immediate. Capture prevents concurrent shutters during asynchronous preparation, then awaits OCR confidence on the trial image. Only a score of at least 80% with nonblank text reserves the next page number and immutable capture position. A visual match never discards a shot. The frozen accepted region flashes green for 500ms after OCR qualifies; AI cleanup is not awaited.

`stillCapture.ts` feature-detects ImageCapture on the existing live camera track. One takePhoto attempt has a 1.8-second deadline; failure/unavailability/empty output falls back to a Blob from actual videoWidth/videoHeight. Failed native decoding also falls back. Browser image decoding handles orientation; a native still is re-analyzed at low resolution in its OWN coordinate system, so differing preview/photo aspect ratios and fields of view never reuse incorrect preview corners. The resulting normalized coordinates multiply by the decoded full-size image dimensions in the existing perspective transform. Canvas fallback uses the preview's matching normalized coordinates. The source is capped at 8MP and output at a 2800px longest edge. Text bounds affect compact matching, not the page crop, preserving headings and footnotes.

After saving, `savedShot()` clears the legacy visual page-change lock and sets a 2000ms deadline. The scheduler submits no preview analysis during this pause. When it expires, focus and fresh stability must qualify again. A held page can be photographed again; duplicate decisions happen after OCR. Manual Capture bypasses automatic timing. Pause/Stop/Done cancel scheduling; Resume preserves the capture deadline.

`textDuplicates.ts` compares raw OCR in word order. Exact normalized matches need at least 20 words; fuzzy matches need at least 40 words and at most 10% word substitutions, insertions or deletions (90% ordered similarity). Prefix/suffix trimming, a bounded dynamic-programming band and early exit limit comparison work. It does not use an unordered bag of words. The store compares as soon as accepted OCR is available, before cleanup completes, and always marks the later capture. Excluded copies skip automatic AI cleanup. Short or significantly different pages remain separate. Original shot positions, restore controls and deletion/promotion behavior remain intact.

Compact fingerprints remain bounded to eight pages for existing diagnostics. No recent fingerprint list is passed to the capture worker, so visual matching cannot reject photos before the OCR/text comparison. Temporary OpenCV objects and frames retain their existing cleanup.

`provideOcrQueue()` runs in App so navigation does not discard pending OCR. `services/ocrQueue.ts` owns temporary Blobs outside Pinia, runs one OCR job by default (configurable to two in `config/ocr.ts`), and limits retained failed images to 2 / 12 MiB. A trial UUID correlates the confidence request; page numbers/positions are assigned only when it passes; results update by UUID rather than completion order. Retry preserves position; deleted pages ignore late results. Reset invalidates work, releases images and terminates OCR. Done stops new acceptance, drains work and releases both workers; unmounting App also disposes the queue. Ordinary navigation away from Scan stops camera/CV while accepted OCR jobs continue. Images become unreachable after successful OCR; actual heap reclamation is browser-managed. OpenCV's allocated WASM heap can remain at its high-water mark until worker termination.

Tesseract remains the existing lazy English worker with logger progress, cancellation, late-initialization cleanup, and a 3-minute watchdog. The active scanner displays counts/status instead of OCR text. Review shows failures, temporary-image Retry, sparse-text hints, raw/edited text separation, editing/deletion, and TXT export. Exports preserve edited text without inserted headings. Corrected images are uploaded through the backend to Google. Tesseract resource downloads use external CDN requests; OpenCV is served with the frontend.

## OpenCV integration decision

The pinned `@techstark/opencv-js` 5.0.0-release.1 package provides the upstream OpenCV JS build and TypeScript definitions, not a document-scanner abstraction. Its runtime is used directly in a Vite module worker. The package includes WASM inside its JS asset; Vite emits a hashed worker served by Vercel or Nginx with no extra CDN/CORS or separate WASM-path configuration. This avoids maintaining a custom OpenCV toolchain for this phase. See the [distribution README](https://github.com/TechStark/opencv-js) and [OpenCV geometric transforms](https://docs.opencv.org/4.x/dd/d52/tutorial_js_geometric_transformations.html).

The tradeoff is a ~15.6 MB uncompressed lazy worker bundle. A future custom reduced-module build can reduce download size after real-device profiling. Vite warns about externalizing Node-only fs/crypto branches; the browser branch is verified in a production browser build. Web Workers and WebAssembly are required for CV. ImageCapture, requestVideoFrameCallback, createImageBitmap and OffscreenCanvas are progressive enhancements: native video capture, timer scheduling and transferable RGBA pixels provide fallbacks. Without OffscreenCanvas the worker returns corrected RGBA for browser canvas JPEG encoding. No DeviceMotion permission is requested. Actual iPhone Safari and Android hardware performance remains a manual verification item.

## OCR backend and provider selection

The existing queue calls `createHybridOcr`, which tries `services/api.ts::ocrPage` first. FormData contains the image and capture UUID; fetch supplies the multipart boundary. Cloud success populates `rawText`, initial `editedText`, `ocrProvider`, original `paragraphs`, and `detectedLanguages` on that UUID. Google paragraph confidence stays on paragraphs at its native 0-1 scale; a separate character-weighted token score on a 0-100 scale is derived only when scored tokens cover the complete OCR text. Tesseract keeps its existing 0-100 page confidence. Editing changes only editedText; original paragraph metadata describes the OCR, not subsequent edits.

Cloud failures, malformed responses, or timeouts trigger Tesseract. A 60-second cooldown avoids repeated uploads to an unavailable backend. There are no automatic Google retries, including SDK retries. Both queue concurrency (1 by default, maximum 2) and fallback execution are bounded; a promise mutex serializes access to the single Tesseract worker even when two Google calls fail together. AbortController and generation checks cancel uploads/ignore late results after session reset. Done drains all accepted jobs. Cancelling a browser request cannot guarantee cancellation of a Google request already submitted; it may still finish and be billed.

Backend routing is `ocr.routes.ts -> ocr.controller.ts -> documentOcr.service.ts -> Document AI`. Multer uses memory storage with 12 MiB/file, one image, one short UUID field, bounded multipart parts, and PNG/JPEG MIME allowlisting. The controller validates UUID/fields and file signatures before sending bytes to Google; Google validates full image decodability. No temp image files are written. Zod validates server config. Expected errors pass through centralized safe JSON handling; upstream SDK errors are not serialized or logged. Pino records only page ID, provider, duration, byte count, and outcome for OCR.

The official `@google-cloud/documentai` 10.1.0 client uses stable v1, the matching regional endpoint, and the processor resource name. It is created lazily and uses normal Application Default Credentials. Empty project/processor settings return 503 without initializing Google or breaking health/startup. `GET /api/ocr/status` exposes configuration presence only, never credential/processor details and never an authentication guarantee.

A 45-second backend watchdog includes SDK/auth initialization, and the RPC also has that deadline. Pending SDK calls retain their concurrency slot until they settle, even if the HTTP response has timed out, preventing unbounded underlying work. The frontend waits at most 65 seconds for each cloud attempt. The backend admits at most two simultaneous uploads and two Google operations, with 30 OCR requests/minute across the process by default. These limits are configurable via environment variables; they do not replace authentication or Google budget/quota controls. Multiple instances have independent limits.

`documentText.ts` resolves all text-anchor segments with Unicode character indices, omitted starts, and protobuf number/string/Long indices. Paragraphs come from page layout. The response uses blank lines between paragraphs only when their concatenated non-whitespace text accounts for the entire document text. Otherwise it retains the document's original text to avoid dropping headings, footnotes, or page numbers. Normalization changes CRLF, trailing spaces, and extreme blank-line runs; it does not fix words, infer punctuation, merge hyphenated line endings, or reconstruct semantics.

## Image size, privacy, and deployment

OpenCV retains the previous source-resolution cap (8 MP) and corrected longest edge (2800 px). It encodes JPEG at 0.94 and compares a lossless PNG, retaining the smaller Blob. This saves upload bandwidth without additional downscaling; the comparison does temporarily allocate both encodings inside the worker. `ocrUseSmallerPng` can disable that extra encoding if real-device CPU profiling warrants it. Generated-page testing selected a 126,719-byte JPEG that was recognized successfully by fallback OCR. This is not a real-book quality benchmark; evaluate small print on physical books with Google after setup.

Browser queue references are released after the OCR/cleanup job finishes; only the bounded failed-image retry cache retains failures. Express releases request image references after processing; the Google SDK can retain its request until settlement. Garbage collection reclaims unreachable memory; no permanent image storage is added. Nginx allows 13 MiB including multipart overhead, disables request buffering to disk, and has a 75-second upstream timeout. Native Render Node deployment still uses root `backend`; Vercel still uses root `frontend` and only public `VITE_API_URL`.

See [Google Cloud and Render setup](google-document-ai-setup.md) for server-only ADC and Secret File configuration. The app tells users that corrected images pass from phone through Render to Google. Credentials, full OCR text, and image data are excluded from logs. No Supabase, Cloud Storage, or disk image persistence is introduced.

## Scope

Supabase, authentication, saved sessions, permanent image storage, PDF, Google Drive, and offline/PWA work remain deferred. Current proofreading is text-only; image-aware proofreading is not implemented.

## Optional text cleanup

`createProofreadingOcr` wraps the existing Google/Tesseract recognizer. It snapshots the cleanup preference when a job starts, then sends raw OCR via `POST /api/proofread` (JSON `{pageId, text}`). `Done` waits for both stages. Cleanup failure or missing configuration returns the successful OCR unchanged. It makes no automatic paid retries and skips further attempts for 60 seconds after an unavailable response. Reset aborts active cleanup and ignores late results by generation.

Express uses a route/controller/service boundary with Zod UUID and 1?20000-character validation, two active requests, a per-process request-rate limit, and a 45-second upstream abort. The service calls the Responses API using Node's native fetch, `store: false`, no tools, and a capped output. Its instruction treats book text as data and requests conservative transcription corrections without paraphrasing. Incomplete/refused/empty or dramatically changed outputs are rejected. Provider errors are sanitized; logs contain ID, duration and status only.

The store preserves `rawText`, `correctedText`, `editedText` and cleanup status. Initially the editor uses corrected text when available; Review can restore the raw version. Only edited text from included pages goes to TXT. No page images are sent to OpenAI and no OpenAI key reaches Vite. See [setup, costs and privacy](photo-flow-and-cleanup.md).

## 80% pre-acceptance OCR gate

`queue.inspect()` runs the primary/fallback OCR without reserving a page or starting AI cleanup. `useAutoScan` awaits the result while the shutter is busy. `meetsOcrConfidence` accepts only finite 0-100 scores >=80 with nonblank text. Rejection releases the temporary candidate and pauses with guidance, avoiding repeated paid calls until Resume. The inspected UUID/result pass into `enqueue`; `refine` applies cleanup to that result without re-reading the image. Manual capture uses the same gate. Trial inspection has its own AbortController; canceling it does not terminate accepted-page cleanup. Done/Stop/Pause/navigation reject stale candidate results.

Google confidence is explicitly derived as the non-whitespace-character-weighted mean of token layout confidence, scaled from 0-1 to 0-100. Every scored token must have a valid confidence and the anchors must account for all recognized non-whitespace text. Otherwise the overall score is omitted. Tesseract already uses 0-100. Neither score is proof of transcription accuracy; paragraph layout confidence is not substituted for OCR token confidence.
