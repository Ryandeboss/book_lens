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
- `stores/scan.ts`: Pinia state for accepted text pages, raw/edited text, numbering, confidence, and combined text. No MediaStreams or photographs live in the store.
- `components/scan/PageTextEditor.vue`: shared labeled textarea used for a draft and accepted pages.
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

## Camera capture (Phase 2)

```text
Phone Camera (or desktop webcam)
     |
     v
 useCamera: getUserMedia, state, stop tracks
     |
     v
 CameraPreview: MediaStream -> video.srcObject
     |
     | manual Capture at videoWidth x videoHeight
     v
 Canvas -> PNG Blob -> object URL -> captured page image
```

ScanView coordinates Start, Capture, Retake, and Use Page to begin OCR. The camera starts only after a user action. Video uses muted autoplay and playsinline; capture is disabled until the video is playing with a decoded frame and valid dimensions. The entire frame is drawn at its actual resolution, without cropping or detection.

MediaStream and Blob use shallowRef so native browser objects are not deeply proxied. Streams remain owned by useCamera; unmount and Stop Camera stop all tracks. A request counter invalidates pending permission requests, stopping any stream returned after cancellation or navigation. External track termination clears active state and displays a helpful error.

CameraPreview detaches srcObject on unmount. ScanView keeps the live preview mounted while viewing the still image so Retake can reuse it, revokes object URLs on discard/unmount, and ignores canvas encoding results after stop/navigation. PNG preserves image quality for future OCR without base64 strings in reactive state. No backend or storage calls are involved in capture.

## OCR and document flow (Phase 3)

```text
Captured PNG Blob
     |
     v
useOcr -> Tesseract.js Web Worker (English)
     |
     v
rawText + confidence -> editable draft (editedText)
     |
     | Add Page; release photograph
     v
Pinia scan store: ordered text pages
     |
     +--> Scan Next Page (reuse worker/camera)
     |
     v
/review -> edit/delete -> combinedText -> UTF-8 TXT Blob download
```

The first Use Page dynamically imports Tesseract.js and initializes its worker. The worker is reused across pages while ScanView is mounted. Finishing or navigating away terminates it, while Pinia retains accepted text until explicit clearing or a full reload. Returning to Scan creates a worker lazily again; Tesseract's browser language cache avoids unnecessary repeat language downloads.

Cancellation invalidates pending results, races library work against a cancellation promise, and terminates available workers. An initializing worker is terminated when its handle resolves. Failed recognition clears the worker so retry can recreate it. A 3-minute watchdog provides recovery from stalled downloads/worker crashes. The UI displays actual per-stage logger percentages, not simulated overall progress.

Each ScannedPage contains a UUID, contiguous pageNumber, immutable-by-action rawText, mutable editedText, and optional actual OCR confidence. Deleting renumbers remaining pages. Combined text joins editedText in array/page-number order with three newline characters and does not insert labels or rewrite contents. TXT export uses text/plain;charset=utf-8 and releases its temporary URL after download begins.

Images never leave the browser for recognition. The only OCR network requests retrieve worker/engine/language resources from the default Tesseract CDNs. No OCR, image-upload, database, or auth endpoints were added to Express.

## Scope

No page detection, image preprocessing, automatic capture, Supabase clients, authentication, persistent sessions/image storage, AI, PWA, offline app cache, or CFML/Lucee is implemented. Remaining placeholder directories are retained with .gitkeep files until their first actual feature.
