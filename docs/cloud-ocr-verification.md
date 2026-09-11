# Cloud OCR upgrade verification

Completed September 11, 2026. Baseline main matched origin/main at `e164ac6ffe73a11a47c98b398e9cc9fd9d8309a3`. Existing lint, type checks, 50 frontend tests, 5 backend tests, and both builds passed before changes.

## Behavior

Automatic detection, perspective correction, stability, page-change/fingerprint protection, green acceptance, background scanning, Done, Review, editing, deletion, and TXT export remain intact. OCR is now Google Document AI first, then browser Tesseract on cloud failure. Cloud-unconfigured local development remains usable. No Supabase/authentication, AI proofreading, PDF, Drive, Cloud Storage, or permanent image storage was added.

## Created files

- `backend/src/routes/ocr.routes.ts`: bounded multipart endpoint and safe capability status.
- `backend/src/controllers/ocr.controller.ts`: UUID/image validation, forwarding and metadata-only logging.
- `backend/src/services/documentOcr.service.ts`: official v1 client, ADC, processor path, deadlines, concurrency, safe failures.
- `backend/src/services/documentText.ts`: text-anchor resolution, paragraph extraction and conservative formatting.
- `backend/src/services/ocrError.ts`: centralized safe OCR errors.
- `backend/tests/ocr.test.ts`, `backend/tests/documentText.test.ts`: mocked Google/upload/normalization coverage.
- `frontend/src/config/ocr.ts`: default one active OCR job, timeout, cooldown and upload limit.
- `frontend/src/services/hybridOcr.ts`, `hybridOcr.test.ts`: cloud-first selection, serialized fallback, cancellation and queue integration tests.
- `frontend/src/services/api.test.ts`: FormData, response validation, timeout and abort coverage.
- `frontend/src/components/scan/OcrComparison.vue`, `OcrComparison.test.ts`: explicit development-only same-image comparison.
- `docs/google-document-ai-setup.md`, `docs/cloud-ocr-verification.md`: exact setup instructions and this report.

## Modified files

- `.gitignore`, `.dockerignore`, `backend/.dockerignore`: exclude common credential/key files and secret directories.
- `backend/package.json`, `backend/package-lock.json`: official Document AI and multipart dependencies.
- `backend/.env.example`, `backend/src/config/env.ts`: optional server Google settings and resource limits.
- `backend/src/routes/index.ts`, `backend/src/middleware/error-handler.ts`: OCR routing and safe errors.
- `frontend/src/composables/useOcrQueue.ts`: connect the provider adapter to the existing App-owned queue.
- `frontend/src/services/ocrQueue.ts`: configurable bounded concurrency and page ID propagation.
- `frontend/src/services/api.ts`: abortable image FormData requests and normalized response validation.
- `frontend/src/types/Page.ts`, `frontend/src/stores/scan.ts`: provider, paragraphs and languages, preserving raw/edited text.
- `frontend/src/config/scanner.ts`, `frontend/src/services/imageProcessing.ts`: high-quality JPEG and smaller-PNG selection, existing dimensions retained.
- `frontend/src/views/ScanView.vue`: upload privacy notice and development-only comparison entry point.
- `nginx/nginx.conf`: upload allowance, no disk request buffering, upstream timeout.
- `scripts/scanner-browser-check.mjs`: verify real uploads and unavailable-cloud fallback; refuse uploads when cloud is configured so automated smoke tests do not call paid Google OCR.
- `README.md`, `docs/architecture.md`: current cloud architecture, privacy, fallback and next phase.

Added backend packages: `@google-cloud/documentai` 10.1.0, `multer` 2.3.0, development types `@types/multer` 2.2.0. npm reported zero vulnerabilities. No frontend dependency or Google credential was added.

## Implementation details

`POST /api/ocr` accepts one PNG/JPEG up to 12 MiB and a UUID `pageId`. Multer holds bytes in memory; MIME and signatures are checked. The backend sends those bytes synchronously to `projects/{project}/locations/{location}/processors/{processor}` using a lazy official v1 client and normal ADC. Missing processor settings return a safe 503 without breaking startup or health. Render authentication uses its Secret File via `GOOGLE_APPLICATION_CREDENTIALS`; no credentials reach Vercel.

Responses contain only provider, text, paragraphs and detected languages. Anchors support multiple segments, missing start indices, and Unicode. Paragraphs are joined with blank lines only if they cover all recognized non-whitespace content; otherwise original document text is preserved so headings/footnotes are not silently dropped. Paragraph confidence is retained where supplied; overall Google confidence is omitted. Line endings/trailing spaces are normalized without word replacement, punctuation inference, or automatic dehyphenation.

The scanner encodes corrected images at the existing resolution, capped at 8 MP source / 2800-pixel corrected longest edge. It compares JPEG quality 0.94 with PNG and keeps the smaller. The generated-browser fixture selected a 126,719-byte JPEG and retained recognizable small text. This does not establish quality on every photographed book; evaluate real pages after configuring Google.

The queue defaults to one active job (configurable up to two), reserves IDs/numbers at capture, and fills results by ID. Google failure starts Tesseract without duplicating the page. Browser fallback remains serialized even if two cloud calls fail together. No automatic paid retries occur; a 60-second cloud cooldown protects an unavailable service. Backend processing deadline is 45 seconds, upload/fetch deadline 65 seconds. Cancellation aborts fetch and ignores stale results; an already-submitted Google request can still complete or be billed.

Existing pending-image bounds (3 / 24 MiB) and failed retry bounds (2 / 12 MiB) remain. Successful cloud or fallback jobs release their images. Both failures mark only that page error and retain its image if the retry budget allows. Express releases request image references after processing; SDK references remain bounded until settlement. Workers/bitmaps/OpenCV resources preserve their cleanup lifecycle. The Node API and Nginx do not write OCR images to disk. Actual heap reclamation is garbage-collector managed.

Backend limits default to two uploads/Google operations and 30 OCR requests/minute per process. There is no authentication in this phase; these limits and CORS do not provide authorization or a guaranteed spend cap. See the setup guide's costs/quotas section before enabling public paid OCR.

## Results

| Check                                                       | Result                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Frontend tests                                              | 61 passed across 14 files                                                            |
| Backend tests                                               | 23 passed across 3 files                                                             |
| Frontend/backend lint and type checks                       | Passed                                                                               |
| Frontend/backend production builds                          | Passed                                                                               |
| Formatting and Git whitespace checks                        | Passed                                                                               |
| Docker frontend/backend build and startup                   | Passed                                                                               |
| Nginx configuration                                         | Passed                                                                               |
| Native/proxied API health                                   | Passed                                                                               |
| OCR status without configuration                            | false; backend remains healthy                                                       |
| Real browser scanner through Vite and Nginx                 | Passed with generated pages                                                          |
| Corrected image upload                                      | Real multipart upload reached backend and received expected unconfigured 503         |
| Real fallback OCR                                           | Tesseract recognized both pages in capture order                                     |
| Detection, motion, green capture, held-page lock, page turn | Passed                                                                               |
| Manual duplicate rejection, Done and Review                 | Passed                                                                               |
| Camera/worker cleanup                                       | Camera ended, one CV and one Tesseract worker both terminated                        |
| Development comparison                                      | Same image sent to both providers only on explicit action; separate unit test passed |
| Production comparison                                       | Development component excluded from production build                                 |
| Real Google API/accuracy                                    | Not run: requires user's manual processor and credential setup                       |

Backend tests never call Google. They mock the official client and cover success, JPEG/PNG forwarding, missing/invalid fields, MIME/signature/size rejection, unconfigured startup, safe upstream errors, timeout, missing document, active request bounds, Unicode anchors, and paragraph/text handling. Frontend tests cover cloud success/provider/structure, fallback/cooldown, both failures/retry, out-of-order completion with two jobs, serial fallback, cancellation, multipart boundaries, malformed responses, and explicit comparison. Existing scanner/camera/review/export regression tests remain.

Browser checks use generated non-copyrighted text pages, native canvas/video/worker APIs, actual OpenCV, HTTP upload, and real Tesseract. They do not use physical cameras. The smoke script checks the backend capability before sending the image and requires cloud OCR to be unconfigured, preventing an automated paid Google call. Use the explicit one-page command or development comparison in the setup guide for your manual credentialed test.

## Reproduce

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run format:check
docker compose up --build -d
docker compose exec frontend nginx -t
Invoke-RestMethod http://localhost/api/health
Invoke-RestMethod http://localhost/api/ocr/status
node scripts/scanner-browser-check.mjs http://localhost
```

The browser script needs the dedicated Chromium/Edge debugging session documented in [Phase 4 verification](phase4-verification.md), port 9225 by default. Do not target an unrelated personal browser. Generated images, browser profiles and screenshots remain ignored under `.docker-local`.

Follow [Google Cloud and Render setup](google-document-ai-setup.md) for exact dashboard steps, environment settings, a real-page POST, development comparison, privacy, costs and troubleshooting. Hosted Google recognition and physical phone quality remain manual checks. Earlier Phase 2-4 reports describe their historical implementations, not the current cloud privacy model.

Recommended next: optional image-aware AI OCR proofreading with conservative transcription corrections, preserved raw OCR and user review/acceptance. It is not implemented here.
