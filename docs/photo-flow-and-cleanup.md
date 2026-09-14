# Photo capture and optional OCR cleanup

**Fast capture is now the default.** It queues a whole-frame photo before OCR and flags low-confidence text afterward. The 80% pre-save workflow described below remains available through **Verify OCR before saving**. See [the fast-capture guide](fast-capture.md) for the new flow, timing, whole-page checks and the saved rollback version. AI cleanup configuration is unchanged.

## What the user sees

1. Center a page and hold it still with sufficient light and focus.
2. A temporary photo is read by OCR. Keep the page in view. Green means **OCR confidence reached at least 80% and the shot was accepted**.
3. Turn the page during the two-second pause. The camera then seeks another clear shot.
4. AI cleanup runs behind the scenes. The OCR confidence check must finish before each acceptance; press Done when finished photographing.
5. Keep the tab open until processing finishes. Review, undo corrections or restore duplicates, then Download TXT.

Low or unavailable confidence pauses without saving the candidate or using a page number. Improve the camera position, lighting or focus, then Resume. Manual Capture has the same confidence requirement. Rejected images are released; they do not go to AI cleanup. Repeated paid OCR is not triggered automatically on rejection. There is no visual page-turn lock. Repeated photos are allowed and checked after OCR. The queue retains at most 30 pending images / 48 MiB, with one active cleanup job by default (two configurable through the existing OCR setting). At the limit it waits for capacity. A failed OCR image can be retried within the existing two-image / 12 MiB retry cache. Success releases the image after the job; reset releases the queue. These are temporary browser objects, not durable saved photos.

## Enable OpenAI on Render

The existing Render service still uses root directory `backend`. Google OCR setup stays unchanged.

1. Open the [OpenAI API dashboard](https://platform.openai.com/), create/select an API project, enable API billing, and create a project API key. API usage is billed separately from a ChatGPT subscription. Keep the key private.
2. In Render, select the BookLens backend service, then **Environment → Add Environment Variable**.
3. Add the following values; paste your real key only in Render's value field:

   ```env
   OPENAI_API_KEY=<your-project-api-key>
   OPENAI_PROOFREAD_MODEL=gpt-5.4-nano
   PROOFREAD_TIMEOUT_MS=45000
   PROOFREAD_REQUESTS_PER_MINUTE=30
   ```

4. Save and redeploy the backend. Reload the deployed frontend after its deployment completes.
5. Open `https://YOUR-RENDER-SERVICE.onrender.com/api/proofread/status`. `{"configured":true}` means a key exists, not that billing/model access has been verified.
6. Leave **AI cleanup for new pages** checked before starting the camera. Scan one page, press Done, then inspect **Original OCR and corrections** in Review. An unavailable service leaves original OCR usable.

For local development, put these settings in ignored `backend/.env` and restart the backend. Do not use root `.env` for backend API settings, do not overwrite existing Google settings, and never add `VITE_OPENAI_API_KEY` or put the key in Vercel. Docker intentionally remains credential-free by default; configure runtime secrets separately if using Docker with paid providers.

The model is configurable, but replacements must support the Responses API text input and the supplied parameters. No new package is needed: the backend uses Node 24's native fetch against the official Responses API.

## Test one real cleanup request

This makes one paid request if configured. PowerShell:

```powershell
$payload = @{
  pageId = [guid]::NewGuid().ToString()
  text = "This makes 70 sense. The reader turned the page."
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://YOUR-RENDER-SERVICE.onrender.com/api/proofread' -ContentType 'application/json' -Body $payload
```

Expected: `status: applied` and `correctedText`. Without a key, it returns `status: unavailable`. Authentication/billing errors, timeouts or refused/incomplete output produce a sanitized error and the browser keeps raw OCR. There are no automatic paid retries. To test capture timing, keep the same page still through two green confirmations, then turn to a different page and press Done. Long near-identical OCR should put the repeat in **Likely duplicates**, labelled with both original shot positions. Restore it with **Keep this page in TXT**.

## Duplicate and correction limits

Duplicates are compared using original OCR in sequence, before considering AI output. Exact normalized repeats of at least 20 words qualify; longer pages (at least 40 words) qualify when word edit distance is at most 10% of the longer page. Small typos, missing words, extra words and OCR number differences can therefore still match. Shared short headings and substantially reordered/different pages stay separate. The later copy is marked with the original shot number and excluded from both combined preview and TXT. Nothing is deleted automatically; restore it if a near-identical page should be kept.

Cleanup corrects likely OCR typos and formatting without intentional paraphrasing. It sees text only, so it cannot reliably recover missing passages or prove a guessed word matches the photograph. Conservative output guards reject large changes but cannot guarantee correctness. Raw OCR is immutable through editing; Review offers the original and corrected representations separately.

## Costs, privacy and limits

The [GPT-5.4 nano model page](https://developers.openai.com/api/docs/models/gpt-5.4-nano) lists $0.20 per million input tokens and $1.25 per million output tokens at implementation time. A hypothetical 1,000 input + 1,000 output tokens costs about $0.00145 for cleanup, excluding Google OCR. Actual costs depend on token counts and current rates. Check [current pricing](https://developers.openai.com/api/docs/pricing), project usage and limits in the API dashboard. This service's request/concurrency limits are per backend process, not authentication or a guaranteed spending cap; the existing public API can be called outside the browser.

Images travel phone → Render → Google for OCR; browser Tesseract is the fallback. With cleanup enabled, recognized text travels browser → Render → OpenAI. BookLens adds no permanent image/text storage or Supabase integration. It requests `store: false`; that does not eliminate provider-side abuse-monitoring retention. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). API keys, page images and full OCR text are not logged by BookLens.

Automated tests mock OpenAI and Google, covering cleanup success/failure/cancellation, unconfigured behavior, safe responses, duplicate restoration/order and the two-second photo loop. Real API quality and physical phone autofocus must be evaluated with your own configured service and book pages.

## Verification for this change

- Confidence-gate tests cover scores below/exactly/above 80%, missing/invalid scores, blank text, cancellation, no page-number consumption on rejection and reuse of accepted OCR without another paid call. Paid provider calls are mocked.
- Lint, TypeScript checks and frontend/backend production builds pass. Docker images build and Nginx/API start healthy.
- Real Edge browser checks use generated moving/still camera frames, real OpenCV correction, real multipart uploads to the credential-free backend, and real Tesseract fallback. They verify the saved-shot flash, no analysis during the two-second pause, repeated capture while processing continues, duplicate-text exclusion, page order, Done drain and worker/camera cleanup.
- The borderless-page variant also deliberately breaks worker canvas support and verifies the pixel-transfer recovery path. Both browser variants pass without paid requests.
- Physical phone autofocus/lighting and real OpenAI/Google transcription quality remain manual checks. Older scanner verification documents describe the previous visual page-lock behavior; this document describes the current photo-first flow.

## Confidence semantics

The backend explicitly requests `pages.tokens` in the Document AI field mask, including the token layout scores and text anchors needed for this calculation. An earlier request mask omitted tokens, so even successful Google transcription had no usable percentage. The endpoint regression test now emulates Google's field filtering to catch this omission. See [Google's process request field-mask reference](https://docs.cloud.google.com/document-ai/docs/reference/rest/v1/projects.locations.processors/process).

The scanner displays **OCR confidence: measuring this photo** while OCR is pending and keeps **Last photo OCR confidence: 87.2% — 80% required** visible after the response, including below-threshold results. This is a score for a completed trial photo, not a live camera focus score or OCR progress percentage. Missing scores display **unavailable (not 0%)** and do not bypass the 80% gate. The reading indicator is indeterminate until the response arrives. No extra paid OCR call is needed for the readout.

Google Document AI provides confidence on token layouts. BookLens derives a character-weighted mean of the token scores, reported on a 0-100 scale, **only when scored token anchors cover all recognized text**. Missing/invalid scores or incomplete coverage leave confidence unavailable and the shot is not accepted. Paragraph confidence keeps Google's original 0-1 scale and is not used for acceptance. See the [Document AI layout/token reference](https://docs.cloud.google.com/document-ai/docs/reference/rest/v1/Document#Layout).

Tesseract already reports its OCR confidence on a 0-100 scale. Both engines use the same inclusive 80-point acceptance threshold; blank text cannot pass. These scores estimate the engine's certainty, not a guarantee that 80% of the words are correct, and scores from different engines are not perfectly calibrated against each other. AI cleanup cannot raise the acceptance score: it runs only after acceptance. The accepted OCR result is reused for cleanup/review, avoiding a second OCR call.

Pause, Stop, Done and navigation abort the confidence check and discard late results. Previously accepted pages and their background cleanup remain intact. No additional environment variable is required; the threshold is in `frontend/src/services/ocrAcceptance.ts`.

The updated workflow passes 186 automated tests (143 frontend, 43 backend), lint, typechecks, production builds and Docker. A real browser run with generated pages confirms successful Tesseract OCR before green acceptance, continued cleanup, duplicate exclusion and resource cleanup. Real Google confidence extraction is covered by mocked token/layout tests; physical phone and configured Google quality checks remain manual.

## Finding and retrying AI cleanup

### If the browser cannot connect

The connection panel keeps a visible **Connected**, **OpenAI key missing**, or **Check failed** result after a check finishes. The button becomes **Check again**. Checking only reads backend configuration; it does not retry page cleanup or verify OpenAI billing. Use **Clean up with AI** in Review to retry a page.

Open **Connection details** to see the actual API address used by the built frontend and the website origin used by your browser. For this deployment:

1. In Vercel, open the frontend project → Settings → Environment Variables. Set `VITE_API_URL=https://book-lens.onrender.com/api` for Production (and Preview if needed). Redeploy; Vite embeds this value at build time.
2. In Render, open the backend service → Environment. Set `FRONTEND_URL` to the exact scanner website origin shown in Connection details, for example `https://your-project.vercel.app`. Additional scanner domains go in `CORS_ORIGINS`, separated by commas. Save and redeploy. Do not use the Render backend address as `FRONTEND_URL`.
3. Reload the scanner after both deployments finish and check again. A direct visit to `/api/proofread/status` can work even when browser cross-origin requests are blocked; it does not by itself verify CORS.

API base URLs now accept a Render origin with or without `/api`. Backend origin configuration tolerates trailing slashes and URL paths while still allowing only explicitly configured origins. The status check allows up to 60 seconds for a sleeping service. Invalid/HTML responses, missing routes, network failures and timeouts have separate safe messages. Browser network errors cannot reliably distinguish CORS rejection from an unavailable network; the panel gives the settings to verify rather than claiming one particular cause.

Never put the OpenAI key in Vercel. These connection settings contain public URLs only.

The earlier checkbox disappeared when the camera started, and Review had no action to request cleanup. The AI cleanup panel now stays visible on Scan and Review. It reads `/api/proofread/status` from the same backend used for OCR and distinguishes a detected key, a missing key, and an unreachable backend. Detecting a key does not prove model access or API billing.

In Review, choose **Clean remaining pages with AI** for included pages that have not been cleaned, or **Clean up with AI** on one page. These actions use existing raw OCR, require no image upload or OCR retry, and work even if automatic cleanup was disabled or previously failed. Requests run one at a time; a backend failure stops the bulk operation. Raw OCR and manual edits are preserved. If you edited a page yourself, choose **Use cleaned text** to replace those edits after reviewing the result. Excluded duplicates are skipped unless restored.

Known failures now show safe guidance for rejected keys, inaccessible/missing models, invalid model settings, exhausted API quota/credits and rate limits. Check the visible status and error before changing Render settings. Keep `OPENAI_API_KEY` and `OPENAI_PROOFREAD_MODEL` only on the backend; no extra variables or credentials belong in Vercel. The automatic confidence threshold is now 80% for both manual and automatic capture.
