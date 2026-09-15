# BookLens

A mobile-first web application for turning printed pages into editable text. BookLens supports continuous automatic scanning, perspective correction, Google Document AI Enterprise OCR with browser Tesseract fallback, multi-page editing, and TXT download. Sessions are in memory only.

## Current Feature Status

- [x] Vue/Node project foundation
- [x] Mobile camera access (physical phone verification still required)
- [x] Manual page capture
- [x] Google Document AI primary OCR (manual cloud setup required)
- [x] Browser OCR fallback with Tesseract.js
- [x] Multi-page scan sessions
- [x] Editable OCR review
- [x] TXT export
- [x] Fixed full-frame scan animation and green saved-shot feedback
- [x] Reversible duplicate-text exclusion with original shot positions
- [x] Page boundary detection
- [x] Perspective correction
- [x] Automatic page capture
- [ ] Supabase persistence
- [ ] Authentication
- [x] Optional OpenAI OCR cleanup with original text preserved

## Scan a book

Run `npm.cmd run dev` and open http://localhost:5173/scan. Start Camera and center one page. BookLens checks motion, lighting and focus, then takes a temporary trial photo after a brief steady hold. **A shot is queued and flashes green as soon as local photo preparation finishes.** Google OCR and AI cleanup run in the background; low or missing confidence does not hold up capture. There are no margin or cut-off line checks. Strong perspective distortion prompts you to hold the phone parallel to the page, without an extra OCR call or hold time. Printed-line evidence plus focus qualifies the shot; a focused object or paper-shaped outline alone is insufficient. The fixed animation covers the camera image, and the full photo is queued without a text-region crop. Turn the page during the two-second pause; the camera then looks for another clear, steady shot. No clear margin is required.

A detected page is perspective-corrected, including headings and footnotes. Without reliable page corners, the full visible photograph is retained. Native still-photo capture is preferred where supported; otherwise the actual video resolution is used. Images are compressed at high quality. Up to 30 pending photos / 48 MiB can queue while optional AI cleanup runs independently of capture. OCR confidence appears after recognition finishes and is informational. At the memory limit, scanning waits for capacity automatically. Photos exist temporarily in this tab, not in a persistent gallery; keep it open.

Holding the same page can save it again after the pause. Once OCR finishes, a conservative text comparison sets likely duplicates aside with their original shot numbers. Review lets you inspect and restore them. Short pages and ambiguous matches stay in the document to avoid losing content.

See the [automatic capture report and phone tuning checklist](docs/automatic-capture-verification.md) for the exact gates, compatibility fallbacks, tests, and settings. Physical iPhone/Android testing is still required.

If page analysis fails, BookLens tries a compatible pixel-transfer path once. Resume rebuilds page detection and restarts a paused preview. Loading/initialization failures now provide specific recovery guidance. After a scanner update is deployed, reload the site once to load the new code.

Pause stops automatic acceptance. Resume restarts detection; Manual Capture bypasses the visual stability gates and refreshes detection before photographing the visible preview. Manual captures also enter the OCR queue and are checked for duplicate text afterward. Stop Camera releases the camera; accepted pages remain available in Review. Backgrounding pauses scanning and requires an explicit Resume.

Done stops the camera and new captures, discards any unaccepted trial photo, waits for accepted-page cleanup, then opens Review. Edit or delete pages and Download TXT. Raw OCR and AI-corrected text stay separate from editable text. Use original OCR / Use cleaned text switches representations without losing either. TXT uses edited text in capture order, excluding set-aside duplicates, separated by three newlines. Failed pages offer Retry while their temporary image remains available, or instructions to delete/rescan. Nearly blank OCR results are marked for review. Start New Scan asks before clearing the document.

Sessions stay in this tab: download before refreshing or closing. Text, original OCR paragraphs/languages, provider, status, and small fingerprints live in Pinia. OpenCV runs in a browser worker. Corrected page images are temporarily uploaded to Render, then Google Document AI. BookLens does not persist them. Tesseract is the fallback, not the preferred primary engine. Finishing the background job releases the queued image. Pending and retry images have separate count and byte limits.

OpenCV is loaded lazily from the application's bundled worker (~15.6 MB before transfer compression). If cloud OCR fails, Tesseract lazily downloads its English worker/engine/language resources from its default versioned CDN paths; language data may be cached in browser IndexedDB. Initial use requires internet access and can take longer. OpenCV requests time out after 60 seconds. Cloud uploads have a 65-second frontend deadline and a 45-second backend processing deadline; failed cloud attempts fall back without an automatic paid retry. Subsequent pages use Tesseract during a 60-second cloud cooldown. Tesseract has its existing 3-minute deadline. See [Tesseract worker documentation](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).

Camera access requires HTTPS or desktop localhost. A phone LAN URL such as `http://192.168.x.x:5173` generally cannot use the camera. Use the HTTPS Vercel site for phone testing. See [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

See the current [scanner recognition report and exact phone checklist](docs/scanner-recognition-verification.md), plus the earlier [Phase 4 verification](docs/phase4-verification.md). Browser tests exercise real OpenCV and OCR using generated pages, but physical camera quality and speed still need testing on Chrome Android and Safari iPhone. This is flat-page perspective correction; curved book gutters, glossy pages, sparse text, and weak edge contrast remain difficult.

## Google OCR setup and privacy

[Follow the exact Google Cloud and Render instructions](docs/google-document-ai-setup.md). The guide includes the four backend Google settings, Secret File installation, local ADC, a real-page request, development comparison, pricing/quota links, and troubleshooting. [OCR upgrade verification](docs/cloud-ocr-verification.md) lists changed files and test evidence.

`POST /api/ocr` accepts one PNG/JPEG up to 12 MiB plus a UUID `pageId` in multipart FormData. `GET /api/ocr/status` exposes only whether processor settings are present; it does not verify authentication. `/api/health` remains independent of Google.

Images follow **phone -> Render -> Google Document AI**. BookLens holds them temporarily in browser/server memory and does not create image files, database records, Cloud Storage objects, or Supabase uploads. Logs include page ID, provider, timing, byte size, and success, not images, OCR text, or credential contents. Google is a separate data processor; choose a suitable processor region and review its [data security documentation](https://docs.cloud.google.com/document-ai/docs/security). Browser language caches contain Tesseract resources, not scanned pages.

Use `VITE_SCANNER_DEBUG=true` locally, restart Vite, and open Scan with the camera stopped to see **Development: compare OCR engines**. Select one PNG/JPEG and click **Compare this image**. This explicitly runs Google once and Tesseract on identical bytes without changing your session. It is unavailable in production. No Google variables or credentials belong in `frontend/.env` or Vercel.

The public OCR endpoint has per-process concurrency and request-rate limits, but this phase does not add authentication. CORS is not access control. Configure Google quotas/billing alerts before enabling paid OCR on a public service; the limits are not a guaranteed spending cap.

## Optional AI text cleanup

[Enable cleanup on Render and test a page](docs/photo-flow-and-cleanup.md). The default model is `gpt-5.4-nano`, configured with a backend-only `OPENAI_API_KEY`. No key is required for scanning or OCR. The AI cleanup checkbox stays visible before and during scanning, and in Review, and controls cleanup for new pages. When enabled and configured, OCR text passes through Render to OpenAI; images are not sent to OpenAI. Cleanup can correct likely transcription errors and paragraph formatting, but inferred words may be wrong: review before exporting. Raw OCR is always retained. No local model server is required.

## Architecture

```text
Camera -> current focus/stability checks + visible text-edge check
       -> prepared photo -> queue + green -> two-second pause -> next photo
Background queue -> Google OCR (Tesseract fallback) -> raw text/confidence
                 -> duplicate detection -> optional AI cleanup -> Review -> TXT
```

Vue uses Composition API single-file components, Vue Router for navigation, and Pinia for the current text document. Camera capture, OpenCV processing, fallback Tesseract OCR, and TXT export run in the browser. The official Google Document AI client and Application Default Credentials exist only in the backend. Express keeps HTTP handling separate from future business logic and persistence. In Docker, Nginx serves the production frontend and proxies API requests. See [architecture details](docs/architecture.md).

The root is a simple command runner, not an npm workspace. Each application has its own package.json and lockfile so Vercel and Render can install independently from their configured root directories.

## Prerequisites

- Node.js 24.x and npm (Node 24 is also used in Docker)
- Git
- Docker Desktop running with Linux containers for Docker verification

## Local Development

In PowerShell:

```powershell
cd C:\Users\ryanc\Documents\Projects\Book_Lens
npm.cmd install
Copy-Item frontend/.env.example frontend/.env
Copy-Item backend/.env.example backend/.env
npm.cmd run dev
```

Copy the example files only on first setup; preserve your existing values on subsequent runs. `npm.cmd` avoids this machine's PowerShell script execution restriction without changing security settings. In cmd.exe or a shell that permits npm scripts, `npm` works too.

Root installation installs frontend and backend dependencies automatically. For reproducible clean installs, use `npm.cmd ci --ignore-scripts`, `npm.cmd --prefix frontend ci`, and `npm.cmd --prefix backend ci`.

- Frontend: http://localhost:5173
- API identification: http://localhost:3000/
- API health: http://localhost:3000/api/health

Vite reloads Vue changes; tsx restarts the API on changes. The browser directly requests `VITE_API_URL` and Express allows the frontend origin using CORS. Stop both with Ctrl+C.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run format:check
```

## Docker Development / Production-like Test

From the repository root:

```powershell
docker compose up --build
```

Open http://localhost, http://localhost/api/health, and deep links such as http://localhost/scan. Stop with Ctrl+C, then remove the project's containers/network with:

```powershell
docker compose down
```

For detached operation use `docker compose up --build -d`; inspect with `docker compose ps` and `docker compose logs`.

Docker builds static Vue files and compiled Node code in separate build stages. Only the runtime files and dependencies reach the final images. The backend runs as the unprivileged `node` user. Nginx waits for the API health check before starting. There are no source mounts or hot reloads: rebuild after code changes.

Nginx publishes port 80; Express port 3000 is internal to the Compose network. The frontend build uses `/api`, so the browser calls the same origin. Nginx forwards `/api/health` to `http://backend:3000/api/health`, preserving the path. `try_files` falls back to index.html for Vue Router refreshes.

If port 80 is occupied, copy `.env.example` to `.env`, set `WEB_PORT=8080`, and use http://localhost:8080. Native development and Docker can run together because Docker does not publish API port 3000.

## Environment Variables

| Location      | Variable                  | Meaning                                                                                               |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| frontend/.env | VITE_SCANNER_DEBUG        | Optional `true` for local scanner metrics; disabled in production builds                              |
| frontend/.env | VITE_API_URL              | `http://localhost:3000/api` locally; Render API URL plus `/api` on Vercel                             |
| backend/.env  | PORT                      | Local default 3000; honor Render's supplied value                                                     |
| backend/.env  | NODE_ENV                  | development, test, or production                                                                      |
| backend/.env  | FRONTEND_URL              | Allowed browser origin, locally `http://localhost:5173`; use the eventual Vercel origin in production |
| backend/.env  | CORS_ORIGINS              | Optional additional comma-separated exact origins                                                     |
| backend/.env  | SUPABASE_URL              | Reserved; unused until Supabase integration                                                           |
| backend/.env  | SUPABASE_ANON_KEY         | Reserved; unused                                                                                      |
| backend/.env  | SUPABASE_SERVICE_ROLE_KEY | Reserved server-only secret; unused                                                                   |
| root .env     | WEB_PORT                  | Docker host port; default 80                                                                          |

Defaults allow native development without credentials. Supabase is not initialized. Never place secrets in `VITE_*`: Vite embeds these values in public JavaScript at **build time**. Rebuild/redeploy when changing the frontend API URL. All actual `.env` files are ignored; example files are tracked. Compose supplies its own runtime values and does not load backend/.env.

## Deployment

The project owner has configured Vercel, Render, and an unintegrated Supabase project. Existing Vercel/Render roots and build commands remain unchanged. Follow [Google Cloud and Render OCR setup](docs/google-document-ai-setup.md) to enable cloud OCR. Without Google configuration, scanning remains usable with Tesseract. No Supabase integration is needed.

### Vercel

Connect `Ryandeboss/book_lens` on main.

- Root Directory: `frontend`
- Framework: Vite
- Node version: 24.x
- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- Set `VITE_API_URL=https://<render-backend-url>/api` using the actual Render URL.

`frontend/vercel.json` supplies the SPA rewrite required for history-mode deep links. See [Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite).

### Render

The Node web service uses:

- Root Directory: `backend`
- Build: `npm ci --include=dev && npm run build`
- Start: `npm start`
- Health Check Path: `/api/health`
- Set `NODE_ENV=production` and `FRONTEND_URL=https://<actual-vercel-domain>` (origin only, no trailing slash).
- Use the service-provided `PORT`; the server binds to `0.0.0.0`.

The include-dev install flag ensures the TypeScript compiler is present during the build even with production NODE_ENV. Node 24.x is declared in package.json. Add CORS_ORIGINS only for specific additional trusted origins. No Supabase variables are needed yet. See [Render's Express guide](https://render.com/docs/deploy-node-express-app). A Blueprint is intentionally omitted; the settings above keep the initial setup small.

## Dependencies

- Frontend: Vue (UI), Vue Router (routes), Pinia (in-memory text session), Tesseract.js 7 (browser OCR), @techstark/opencv-js 5.0.0-release.1 (upstream OpenCV browser build and types).
- Frontend tooling: Vite and its Vue plugin (dev/build), TypeScript and vue-tsc (types), Vitest, Vue Test Utils and jsdom (component tests).
- Backend: @google-cloud/documentai 10.1.0 (official v1 OCR client), multer 2.3.0 (bounded memory multipart uploads), Express (HTTP), cors (browser origins), dotenv (local configuration), Zod (environment validation), Pino and pino-http (structured/request logs).
- Backend tooling: TypeScript, tsx (dev restart), Vitest and Supertest (HTTP tests), required type declarations.
- Both apps: ESLint, typescript-eslint, eslint-config-prettier; frontend additionally uses eslint-plugin-vue. Root: concurrently (two dev processes) and Prettier (formatting).

## Planned Features

- Supabase authentication/persistence and possible Storage
- Optional constrained AI OCR correction

**Next phase:** Optional AI OCR proofreading that compares OCR with the captured page image, corrects likely transcription errors without paraphrasing, preserves raw OCR, and lets the user review/accept changes. It is not implemented. Supabase, authentication, saved scans, PDF, and Drive also remain deferred.
