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
        Supabase (future)

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
                    Supabase (future)
```

## Responsibilities

- `frontend/src/views`: route-level screens. Vue's `script setup` declares component state and logic; its template renders that state. `ref` is reactive state, and `onMounted` runs after mounting.
- `components/common`: reusable presentation, including AppButton. `components/camera/CameraPreview.vue` owns the video element, stream attachment, readiness, and frame capture.
- `composables/useCamera.ts`: obtains and releases camera streams and provides reactive startup, active, and error state.
- `composables/useOcr.ts`: lazily initializes an English Tesseract worker, reports its progress, handles recognition/retry/cancellation, and terminates on unmount.
- `stores/scan.ts`: Pinia state for captured pages, queued/processing/ready/error status, raw/edited text, numbering, confidence, fingerprints, and combined text. No MediaStreams or photographs live in the store.
- `components/scan/PageTextEditor.vue`: labeled textarea for ready pages in Review.
- `services/downloadText.ts`: UTF-8 Blob download and delayed object URL cleanup.
- `services/api.ts`: browser HTTP boundary and health-response validation. Views do not construct URLs.
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

## Continuous scanning (Phase 4)

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
        conservative recent fingerprint comparison
               |
        reserve numbered page; green confirmation; lock until page changes
               |
        App-owned OCR queue (max 3 images / 24 MiB, active job included)
               |
        one reusable Tesseract worker -> rawText + confidence
               |
        update original page ID; release image
               |
        Done drains queue -> Review -> edit/delete -> TXT
```

`useAutoScan.ts` coordinates scheduling and resource ownership. The typed `AutoScanMachine` owns searching, detected, stabilizing, capturing, captured, waitingForPageChange, paused, finishing, and error states. Additional refs describe actual camera/worker lifecycle and user pause. Sampling never overlaps; full-resolution processing temporarily occupies the same CV worker. Timer cadence accounts for analysis duration and naturally slows on slower devices. Main-thread work is limited to drawing/resizing and creating transferable bitmaps; contour detection, quality measurement, warping, and PNG encoding run off the UI thread.

`scannerGeometry.ts` supplies normalized guide/corner math, candidate alignment, and output dimensions. `imageProcessing.ts` owns OpenCV operations. `usePageDetection.ts` lazily creates a module worker, correlates requests, transfers bitmap ownership, and handles crashes/timeouts. The worker closes each bitmap and deletes temporary Mats, contours, transforms, and ROI objects in finally blocks. Stop, Done, and Scan unmount terminate it; generation checks discard stale results and close snapshots returned after cancellation. Camera streams keep the existing permission, late-request, track-ended, and unmount cleanup protections.

A page-change signature is computed from the guide, while the secondary fingerprint uses the corrected page interior image. Both use mean-centered grayscale thumbnails. The machine observes turns during the green flash and queue backpressure, so a brief transition can unlock the next similarly laid-out page. Quality and anchored geometry/content stability still apply before acceptance. See `config/scanner.ts` for all primary tuning values.

`provideOcrQueue()` runs in App so navigation does not discard pending OCR. `services/ocrQueue.ts` owns temporary Blobs outside Pinia, runs one OCR job at a time, and limits retained failed images to 2 / 12 MiB. Numbers/UUIDs are assigned before OCR starts; results update by UUID rather than completion order. Retry preserves position; deleted pages ignore late results. Reset invalidates work, releases images and terminates OCR. Done stops new acceptance, drains work and releases both workers; unmounting App also disposes the queue. Ordinary navigation away from Scan stops camera/CV while accepted OCR jobs continue. Images become unreachable after successful OCR; actual heap reclamation is browser-managed. OpenCV's allocated WASM heap can remain at its high-water mark until worker termination.

Tesseract remains the existing lazy English worker with logger progress, cancellation, late-initialization cleanup, and a 3-minute watchdog. The active scanner displays counts/status instead of OCR text. Review shows failures, temporary-image Retry, sparse-text hints, raw/edited text separation, editing/deletion, and TXT export. Exports preserve edited text without inserted headings. No camera frames are uploaded. Only Tesseract resource downloads use external CDN requests; OpenCV is served with the frontend.

## OpenCV integration decision

The pinned `@techstark/opencv-js` 5.0.0-release.1 package provides the upstream OpenCV JS build and TypeScript definitions, not a document-scanner abstraction. Its runtime is used directly in a Vite module worker. The package includes WASM inside its JS asset; Vite emits a hashed worker served by Vercel or Nginx with no extra CDN/CORS or separate WASM-path configuration. This avoids maintaining a custom OpenCV toolchain for this phase. See the [distribution README](https://github.com/TechStark/opencv-js) and [OpenCV geometric transforms](https://docs.opencv.org/4.x/dd/d52/tutorial_js_geometric_transformations.html).

The tradeoff is a ~15.6 MB uncompressed lazy worker bundle. A future custom reduced-module build can reduce download size after real-device profiling. Vite warns about externalizing Node-only fs/crypto branches; the browser branch is verified in a production browser build. Modern Web Workers, WebAssembly, createImageBitmap, and worker OffscreenCanvas/PNG encoding are required; older browser support has not been established.

## Scope

Supabase clients, authentication, persistent sessions/image storage, AI cleanup, PDF, Google Drive sharing, PWA/offline app caching, and CFML/Lucee remain unimplemented. Phase 5 is Supabase Auth/PostgreSQL for saved sessions and a real library. The Node/Render API and deployment settings are unchanged by this phase.
