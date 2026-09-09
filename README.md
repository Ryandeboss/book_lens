# BookLens

A mobile-first web application for turning printed pages into editable text. Phase 3 supports manual camera capture, English browser OCR, multi-page editing, and a combined TXT download. Sessions are in memory only.

## Current Feature Status

- [x] Vue/Node project foundation
- [x] Mobile camera access (physical phone verification still required)
- [x] Manual page capture
- [x] Browser OCR with Tesseract.js
- [x] Multi-page scan sessions
- [x] Editable OCR review
- [x] TXT export
- [ ] Page boundary detection
- [ ] Perspective correction
- [ ] Automatic page capture
- [ ] Supabase persistence
- [ ] Authentication
- [ ] AI OCR cleanup

## Test the Camera

Run `npm.cmd run dev` from the project root and open http://localhost:5173/scan on your computer. Click Start Camera and allow webcam permission. Wait for the live preview, then Capture. Retake discards the image and reuses the active camera. Use Page starts English OCR with real per-stage progress. Review/edit the text, then Add Page. Repeat with Scan Next Page; Finish opens /review. There you can edit or delete pages, preview combined text, and Download TXT. Start New Scan asks before clearing an existing document.

Raw OCR is preserved separately from your edits. Exports use the edited text in page order, separated by three newline characters, without artificial page headings. Very short OCR results require explicit acknowledgement before adding. Failed OCR retains the image for Try Again or Retake.

Accepted pages survive navigation between /scan and /review. Refreshing or closing the tab clears them; download first. Unaccepted captures/drafts are discarded on leaving /scan. Stop Camera releases the camera; navigating away also stops all tracks. Returning to scan restarts it on request.

Capture uses the video frame's actual dimensions, not its displayed CSS size. A PNG Blob and object URL stay in memory only; no image is uploaded or persisted. The photograph is discarded on Add Page, Retake, or navigation. The camera intentionally remains on during scanning/review for a quick next capture, with a visible Stop Camera control.

Tesseract.js loads lazily on the first Use Page. One English worker is reused while /scan stays mounted, then terminated on leaving. Worker/engine/language resources download from Tesseract's default versioned CDN paths; language data may be cached in browser IndexedDB. This is an OCR resource cache, not saved user pages or offline app support. Initial use requires internet access and can be slower than later pages. If initialization is cancelled before the library returns its worker handle, cleanup occurs when that handle becomes available. A 3-minute timeout returns stalled OCR to a retryable error. See [Tesseract worker documentation](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).

Camera access requires a secure context: localhost works on desktop, but an ordinary phone LAN URL such as `http://192.168.x.x:5173` generally does not. Use the project's HTTPS Vercel deployment/preview for real phone testing. See [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

On Chrome Android and Safari iPhone, manually check rear-camera selection, allow/deny permissions, portrait/landscape layout, readable still captures, Retake, OCR progress/results, editing two pages, TXT download, Stop Camera, and the camera indicator turning off after Finish. Rear-camera and resolution constraints are preferences. Keep the tab foregrounded during OCR; mobile browsers may suspend background work. Full-resolution OCR uses substantial temporary memory; one image is processed at a time and only text is retained after acceptance. Blurry, tilted, shadowed, or curved pages may need a rescan and manual corrections until preprocessing is implemented.

## Architecture

```text
Vue/Vite -> Node/Express API -> Supabase (future)
```

Vue uses Composition API single-file components, Vue Router for navigation, and Pinia for the current text document. Camera capture, Tesseract OCR, and TXT export all run in the browser. Express keeps HTTP handling separate from future business logic and persistence. In Docker, Nginx serves the production frontend and proxies API requests. See [architecture details](docs/architecture.md).

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

The project owner has configured Vercel, Render, and an unintegrated Supabase project. The existing deployment settings below remain unchanged for Phase 3. No Supabase integration or credentials are needed for OCR.

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

- Frontend: Vue (UI), Vue Router (routes), Pinia (in-memory text session), Tesseract.js 7 (browser OCR).
- Frontend tooling: Vite and its Vue plugin (dev/build), TypeScript and vue-tsc (types), Vitest, Vue Test Utils and jsdom (component tests).
- Backend: Express (HTTP), cors (browser origins), dotenv (local configuration), Zod (environment validation), Pino and pino-http (structured/request logs).
- Backend tooling: TypeScript, tsx (dev restart), Vitest and Supertest (HTTP tests), required type declarations.
- Both apps: ESLint, typescript-eslint, eslint-config-prettier; frontend additionally uses eslint-plugin-vue. Root: concurrently (two dev processes) and Prettier (formatting).

## Planned Features

- Page boundary detection and perspective correction using OpenCV.js
- Supabase authentication/persistence and possible Storage
- Optional constrained AI OCR correction

**Next phase:** Phase 4: Add OpenCV.js image preprocessing, automatic page-boundary detection, perspective correction/cropping, and image enhancement before OCR to significantly improve recognition quality. Phase 4 has not been implemented.
