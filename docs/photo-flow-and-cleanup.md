# Photo capture and optional OCR cleanup

## What the user sees

1. Center a page and hold it still with sufficient light and focus.
2. The animated outline shows readiness. Green means **shot saved in temporary memory**.
3. Turn the page during the two-second pause. The camera then seeks another clear shot.
4. OCR and optional cleanup run behind the scenes; press Done when finished photographing.
5. Keep the tab open until processing finishes. Review, undo corrections or restore duplicates, then Download TXT.

There is no visual page-turn lock. Repeated photos are allowed and checked after OCR. The queue retains at most 30 pending images / 48 MiB, with one active OCR/cleanup job by default (two configurable through the existing OCR setting). At the limit it waits for capacity. A failed OCR image can be retried within the existing two-image / 12 MiB retry cache. Success releases the image after the job; reset releases the queue. These are temporary browser objects, not durable saved photos.

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
6. Leave **Clean up OCR text with AI when available** checked before starting the camera. Scan one page, press Done, then inspect **Original OCR and corrections** in Review. An unavailable service leaves original OCR usable.

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

Duplicates are compared using original OCR, before considering the cleanup output. At least 50 words, nearly equal lengths and a 96% five-word sequence match are required; exact normalized matches also qualify. Different number sequences prevent a fuzzy match. Shared headings, brief title pages or imperfect OCR may remain as separate pages. Nothing is silently deleted. Original shot numbers survive deletion and out-of-order processing; included text keeps capture order.

Cleanup corrects likely OCR typos and formatting without intentional paraphrasing. It sees text only, so it cannot reliably recover missing passages or prove a guessed word matches the photograph. Conservative output guards reject large changes but cannot guarantee correctness. Raw OCR is immutable through editing; Review offers the original and corrected representations separately.

## Costs, privacy and limits

The [GPT-5.4 nano model page](https://developers.openai.com/api/docs/models/gpt-5.4-nano) lists $0.20 per million input tokens and $1.25 per million output tokens at implementation time. A hypothetical 1,000 input + 1,000 output tokens costs about $0.00145 for cleanup, excluding Google OCR. Actual costs depend on token counts and current rates. Check [current pricing](https://developers.openai.com/api/docs/pricing), project usage and limits in the API dashboard. This service's request/concurrency limits are per backend process, not authentication or a guaranteed spending cap; the existing public API can be called outside the browser.

Images travel phone → Render → Google for OCR; browser Tesseract is the fallback. With cleanup enabled, recognized text travels browser → Render → OpenAI. BookLens adds no permanent image/text storage or Supabase integration. It requests `store: false`; that does not eliminate provider-side abuse-monitoring retention. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). API keys, page images and full OCR text are not logged by BookLens.

Automated tests mock OpenAI and Google, covering cleanup success/failure/cancellation, unconfigured behavior, safe responses, duplicate restoration/order and the two-second photo loop. Real API quality and physical phone autofocus must be evaluated with your own configured service and book pages.

## Verification for this change

- 149 automated tests pass (113 frontend, 36 backend); paid provider calls are mocked.
- Lint, TypeScript checks and frontend/backend production builds pass. Docker images build and Nginx/API start healthy.
- Real Edge browser checks use generated moving/still camera frames, real OpenCV correction, real multipart uploads to the credential-free backend, and real Tesseract fallback. They verify the saved-shot flash, no analysis during the two-second pause, repeated capture while processing continues, duplicate-text exclusion, page order, Done drain and worker/camera cleanup.
- The borderless-page variant also deliberately breaks worker canvas support and verifies the pixel-transfer recovery path. Both browser variants pass without paid requests.
- Physical phone autofocus/lighting and real OpenAI/Google transcription quality remain manual checks. Older scanner verification documents describe the previous visual page-lock behavior; this document describes the current photo-first flow.
