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
CameraPreview video (useCamera owns tracks)
   |
   +-> 640px analysis bitmap, at most ~6/sec
   |       |
   |       v
   |   usePageDetection -> OpenCV Web Worker
   |       | contours, normalized corners, quality, guide signature
   |       v
   |   AutoScanMachine: alignment + stability + page-change lock
   |       |
   +-------+-> full-resolution bitmap, capped at 8 MP
               |
               v
        OpenCV worker: perspective warp, grayscale, contrast normalization
               |
        high-quality JPEG (0.94) or PNG when smaller
               |
        conservative recent fingerprint comparison
               |
        reserve numbered page; green confirmation; lock until page changes
               |
        App-owned OCR queue (max 3 images / 24 MiB, active job included)
               |
        POST /api/ocr -> Render/Express -> Google Document AI v1
               |                            |
               | failure -> Tesseract       | text/paragraphs/languages
               +----------------------------+
               |
        update original page ID; release image
               |
        Done drains queue -> Review -> edit/delete -> TXT
```

`useAutoScan.ts` coordinates scheduling and resource ownership. The typed `AutoScanMachine` owns searching, detected, stabilizing, capturing, captured, waitingForPageChange, paused, finishing, and error states. Additional refs describe actual camera/worker lifecycle and user pause. Sampling never overlaps; full-resolution processing temporarily occupies the same CV worker. Timer cadence accounts for analysis duration and naturally slows on slower devices. Main-thread work is limited to drawing/resizing and creating transferable bitmaps; contour detection, quality measurement, warping, and JPEG/PNG encoding run off the UI thread.

`scannerGeometry.ts` supplies normalized guide/corner math, candidate alignment, and output dimensions. `imageProcessing.ts` owns OpenCV operations. `usePageDetection.ts` lazily creates a module worker, correlates requests, transfers bitmap ownership, and handles crashes/timeouts. The worker closes each bitmap and deletes temporary Mats, contours, transforms, and ROI objects in finally blocks. Stop, Done, and Scan unmount terminate it; generation checks discard stale results and close snapshots returned after cancellation. Camera streams keep the existing permission, late-request, track-ended, and unmount cleanup protections.

A page-change signature is computed from the guide, while the secondary fingerprint uses the corrected page interior image. Both use mean-centered grayscale thumbnails. The machine observes turns during the green flash and queue backpressure, so a brief transition can unlock the next similarly laid-out page. Quality and anchored geometry/content stability still apply before acceptance. See `config/scanner.ts` for all primary tuning values.

`provideOcrQueue()` runs in App so navigation does not discard pending OCR. `services/ocrQueue.ts` owns temporary Blobs outside Pinia, runs one OCR job by default (configurable to two in `config/ocr.ts`), and limits retained failed images to 2 / 12 MiB. Numbers/UUIDs are assigned before OCR starts; results update by UUID rather than completion order. Retry preserves position; deleted pages ignore late results. Reset invalidates work, releases images and terminates OCR. Done stops new acceptance, drains work and releases both workers; unmounting App also disposes the queue. Ordinary navigation away from Scan stops camera/CV while accepted OCR jobs continue. Images become unreachable after successful OCR; actual heap reclamation is browser-managed. OpenCV's allocated WASM heap can remain at its high-water mark until worker termination.

Tesseract remains the existing lazy English worker with logger progress, cancellation, late-initialization cleanup, and a 3-minute watchdog. The active scanner displays counts/status instead of OCR text. Review shows failures, temporary-image Retry, sparse-text hints, raw/edited text separation, editing/deletion, and TXT export. Exports preserve edited text without inserted headings. Corrected images are uploaded through the backend to Google. Tesseract resource downloads use external CDN requests; OpenCV is served with the frontend.

## OpenCV integration decision

The pinned `@techstark/opencv-js` 5.0.0-release.1 package provides the upstream OpenCV JS build and TypeScript definitions, not a document-scanner abstraction. Its runtime is used directly in a Vite module worker. The package includes WASM inside its JS asset; Vite emits a hashed worker served by Vercel or Nginx with no extra CDN/CORS or separate WASM-path configuration. This avoids maintaining a custom OpenCV toolchain for this phase. See the [distribution README](https://github.com/TechStark/opencv-js) and [OpenCV geometric transforms](https://docs.opencv.org/4.x/dd/d52/tutorial_js_geometric_transformations.html).

The tradeoff is a ~15.6 MB uncompressed lazy worker bundle. A future custom reduced-module build can reduce download size after real-device profiling. Vite warns about externalizing Node-only fs/crypto branches; the browser branch is verified in a production browser build. Modern Web Workers, WebAssembly, createImageBitmap, and worker OffscreenCanvas/PNG encoding are required; older browser support has not been established.

## OCR backend and provider selection

The existing queue calls `createHybridOcr`, which tries `services/api.ts::ocrPage` first. FormData contains the image and capture UUID; fetch supplies the multipart boundary. Cloud success populates `rawText`, initial `editedText`, `ocrProvider`, original `paragraphs`, and `detectedLanguages` on that UUID. Google layout confidence stays on paragraphs at its native 0-1 scale; no overall Google confidence is synthesized. Tesseract keeps its existing 0-100 page confidence. Editing changes only editedText; original paragraph metadata describes the OCR, not subsequent edits.

Cloud failures, malformed responses, or timeouts trigger Tesseract. A 60-second cooldown avoids repeated uploads to an unavailable backend. There are no automatic Google retries, including SDK retries. Both queue concurrency (1 by default, maximum 2) and fallback execution are bounded; a promise mutex serializes access to the single Tesseract worker even when two Google calls fail together. AbortController and generation checks cancel uploads/ignore late results after session reset. Done drains all accepted jobs. Cancelling a browser request cannot guarantee cancellation of a Google request already submitted; it may still finish and be billed.

Backend routing is `ocr.routes.ts -> ocr.controller.ts -> documentOcr.service.ts -> Document AI`. Multer uses memory storage with 12 MiB/file, one image, one short UUID field, bounded multipart parts, and PNG/JPEG MIME allowlisting. The controller validates UUID/fields and file signatures before sending bytes to Google; Google validates full image decodability. No temp image files are written. Zod validates server config. Expected errors pass through centralized safe JSON handling; upstream SDK errors are not serialized or logged. Pino records only page ID, provider, duration, byte count, and outcome for OCR.

The official `@google-cloud/documentai` 10.1.0 client uses stable v1, the matching regional endpoint, and the processor resource name. It is created lazily and uses normal Application Default Credentials. Empty project/processor settings return 503 without initializing Google or breaking health/startup. `GET /api/ocr/status` exposes configuration presence only, never credential/processor details and never an authentication guarantee.

A 45-second backend watchdog includes SDK/auth initialization, and the RPC also has that deadline. Pending SDK calls retain their concurrency slot until they settle, even if the HTTP response has timed out, preventing unbounded underlying work. The frontend waits at most 65 seconds for each cloud attempt. The backend admits at most two simultaneous uploads and two Google operations, with 30 OCR requests/minute across the process by default. These limits are configurable via environment variables; they do not replace authentication or Google budget/quota controls. Multiple instances have independent limits.

`documentText.ts` resolves all text-anchor segments with Unicode character indices, omitted starts, and protobuf number/string/Long indices. Paragraphs come from page layout. The response uses blank lines between paragraphs only when their concatenated non-whitespace text accounts for the entire document text. Otherwise it retains the document's original text to avoid dropping headings, footnotes, or page numbers. Normalization changes CRLF, trailing spaces, and extreme blank-line runs; it does not fix words, infer punctuation, merge hyphenated line endings, or reconstruct semantics.

## Image size, privacy, and deployment

OpenCV retains the previous source-resolution cap (8 MP) and corrected longest edge (2800 px). It encodes JPEG at 0.94 and compares a lossless PNG, retaining the smaller Blob. This saves upload bandwidth without additional downscaling; the comparison does temporarily allocate both encodings inside the worker. `ocrUseSmallerPng` can disable that extra encoding if real-device CPU profiling warrants it. Generated-page testing selected a 126,719-byte JPEG that was recognized successfully by fallback OCR. This is not a real-book quality benchmark; evaluate small print on physical books with Google after setup.

Browser queue references are released after either engine succeeds; only the bounded failed-image retry cache retains failures. Express releases request image references after processing; the Google SDK can retain its request until settlement. Garbage collection reclaims unreachable memory; no permanent image storage is added. Nginx allows 13 MiB including multipart overhead, disables request buffering to disk, and has a 75-second upstream timeout. Native Render Node deployment still uses root `backend`; Vercel still uses root `frontend` and only public `VITE_API_URL`.

See [Google Cloud and Render setup](google-document-ai-setup.md) for server-only ADC and Secret File configuration. The app tells users that corrected images pass from phone through Render to Google. Credentials, full OCR text, and image data are excluded from logs. No Supabase, Cloud Storage, or disk image persistence is introduced.

## Scope

Supabase, authentication, saved sessions, image storage, AI proofreading, PDF, Google Drive, and offline/PWA work remain deferred. Recommended next: optional image-aware OCR proofreading that preserves raw transcription and requires review/acceptance without paraphrasing.
