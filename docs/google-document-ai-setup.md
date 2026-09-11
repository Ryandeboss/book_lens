# Google Document AI setup

BookLens now prefers Google Cloud **Enterprise Document OCR**, accessed only through the Node backend. Tesseract remains a browser fallback. No Google resources or service-account keys were created automatically. Real Google recognition has not been exercised without your processor/credentials; automated tests mock Google.

## 1. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/). Use the project selector at the top to choose a project or **New Project**. Use a dedicated BookLens project if you want to isolate usage and permissions. Record its **Project ID**, not its display name or numeric project number.
2. Open **Billing** and link an active billing account if the project needs one. Create a billing budget/alerts for this project.
3. Go to **APIs & Services -> Library**, search for **Cloud Document AI API**, open it, and click **Enable**. Ensure the selected project is the one recorded above. These project/billing/API steps follow [Google's setup guide](https://docs.cloud.google.com/document-ai/docs/setup).
4. Search the console for **Document AI**, open its processor area, and choose **Create processor** / **Explore processors**. Select **Enterprise Document OCR** (processor type `OCR_PROCESSOR`), not Form Parser, Layout Parser, or a custom extractor.
5. Give it a name such as `booklens-ocr`. Choose the processor location intentionally: `us` for the US multi-region or `eu` for the EU multi-region, subject to your data-location needs and available processor versions. Do not use a Render region name. Create the processor and ensure it is enabled.
6. Open the processor's details. Record **Processor ID** and **Location**, alongside the project's **Project ID**. The processor resource should match `projects/PROJECT_ID/locations/LOCATION/processors/PROCESSOR_ID`. BookLens uses the processor's default version, with no premium OCR add-ons requested. See [Google's processor creation guide](https://docs.cloud.google.com/document-ai/docs/create-processor).
7. Go to **IAM & Admin -> Service Accounts -> Create service account**. Name it `booklens-ocr` and click **Create and continue**.
8. Grant **Document AI API User** (`roles/documentai.apiUser`) in the same project. This is the predefined processing role; do not grant the runtime account Owner, Editor, or Document AI Administrator. You can leave optional user-access grants blank and finish. See the [Document AI IAM role list](https://docs.cloud.google.com/document-ai/docs/access-control/iam-roles).
9. Open that service account -> **Keys -> Add key -> Create new key -> JSON -> Create**. The browser downloads the JSON. Keep it outside the Git checkout, do not paste it into this chat, and do not place it in Vue/Vercel. If organization policy blocks key creation, ask the organization administrator for an approved authentication approach rather than weakening policy. See [Google's key instructions](https://docs.cloud.google.com/iam/docs/keys-create-delete).

You perform these dashboard steps manually. BookLens uses Google's standard Application Default Credentials (ADC); it never embeds credential JSON or base64 credential strings in source code.

## 2. Render Secret File

Open the existing BookLens **backend Web Service** in [Render Dashboard](https://dashboard.render.com/). Select **Environment** in its sidebar. Under **Secret Files**, click **+ Add Secret File**.

- **Filename:** `google-service-account.json`
- **Contents:** paste the complete contents of the downloaded service-account JSON, including its opening/closing braces. Do not paste just the private key.

Click **Save Changes**. Render makes the file available at `/etc/secrets/google-service-account.json` and deploys the change. It is not a Git file. These controls and the runtime path are documented in [Render's environment/secret-file guide](https://render.com/docs/configure-environment-variables).

## 3. Render environment variables

On that same backend service's **Environment** page, add these values using your processor details:

```dotenv
GOOGLE_CLOUD_PROJECT_ID=<your-project-id>
GOOGLE_DOCUMENT_AI_LOCATION=us
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=<your-processor-id>
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-service-account.json
```

Use `eu` instead of `us` if that is where you created the processor. Set neither value to a URL. The application automatically selects `<location>-documentai.googleapis.com`.

Keep the existing settings:

```dotenv
NODE_ENV=production
FRONTEND_URL=https://<your-vercel-domain>
```

`FRONTEND_URL` is an origin without a trailing slash. Preserve any intentional `CORS_ORIGINS`; use exact additional trusted browser origins. Render supplies `PORT`.

Optional settings already have conservative defaults:

```dotenv
OCR_MAX_CONCURRENT_REQUESTS=2
OCR_REQUESTS_PER_MINUTE=30
OCR_TIMEOUT_MS=45000
```

Save the variables and redeploy. If needed use **Manual Deploy -> Deploy latest commit**. Keep:

| Render setting    | Value                                   |
| ----------------- | --------------------------------------- |
| Root Directory    | `backend`                               |
| Build Command     | `npm ci --include=dev && npm run build` |
| Start Command     | `npm start`                             |
| Health Check Path | `/api/health`                           |
| Node              | 24.x, as declared in package.json       |

No Google variables belong on Vercel. Its existing `VITE_API_URL=https://<render-host>/api` must point to this backend. If you change that public URL, redeploy Vercel because Vite embeds it during build. Keep Vercel root `frontend`, build `npm run build`, and output `dist`.

## 4. Check configuration, then test one real page

Open these URLs using your actual Render hostname:

- `https://<render-host>/api/health`: expect `{"status":"ok","service":"booklens-api"}`.
- `https://<render-host>/api/ocr/status`: expect `{"googleDocumentAiConfigured":true}`.

**Configured means that processor settings are present. It does not prove that the key, billing, IAM role, processor location, or API access works.** A real POST is the authentication/recognition test.

Choose one JPEG/PNG of a page you want to test, under 12 MiB. From PowerShell, use `curl.exe` (not the PowerShell curl alias):

```powershell
$ocrPageId = [guid]::NewGuid().ToString()
curl.exe --fail-with-body --max-time 75 -X POST 'https://<render-host>/api/ocr' -F 'image=@C:/path/to/test-page.jpg;type=image/jpeg' -F "pageId=$ocrPageId"
```

For PNG use `.png` and `type=image/png`. You are authorizing one billable cloud OCR request when you run this command. The server accepts one image plus one UUID field; it rejects PDF, WebP, missing files, unsupported signatures, invalid fields, and oversized images. The 12 MiB limit is BookLens's limit; Google also validates the image itself. See [Google's supported formats](https://docs.cloud.google.com/document-ai/docs/file-types).

A successful response looks like:

```json
{
  "provider": "google-document-ai",
  "text": "Heading\n\nFirst paragraph...",
  "paragraphs": [{ "text": "Heading", "confidence": 0.96 }],
  "detectedLanguages": ["en"]
}
```

Text/confidence above are illustrative. Overall confidence is omitted; paragraph confidence is included only when provided. Google does not automatically fix semantics, guarantee accurate transcription, or flatten a curved book gutter.

Next open the HTTPS Vercel app on your phone, Start Camera, scan two or three pages, and turn immediately after each green check. In browser developer tools, a successful `/api/ocr` response should identify `google-document-ai`. Provider metadata is stored per page without a prominent UI badge. Tap Done; check headings, paragraph boundaries, small print, punctuation, footnotes, page numbers, raw/edit separation, and TXT export. Compare against the actual page, especially the examples that Tesseract misread.

## 5. Local development

Without Google settings, the API starts normally, status reports false, and the app uses Tesseract after its first cloud attempt. No credential setup is necessary just to keep developing the scanner.

To enable Google locally, put project/location/processor settings in **backend/.env**. For authentication choose one normal ADC option:

- Set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of your JSON file **outside the repository**. On Windows, use a path such as `C:/Users/ryanc/PrivateCredentials/booklens-service-account.json`. This guide does not create that file or directory.
- Or use a locally installed Google Cloud CLI with `gcloud auth application-default login`, an identity authorized for Document AI, and an appropriate ADC quota project. Leave `GOOGLE_APPLICATION_CREDENTIALS` unset/empty so the library can use those ADC credentials. See [local ADC setup](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev).

Restart the backend after changing environment variables. Never copy backend credentials into `frontend/.env`, a `VITE_*` variable, or tracked JSON. The Git/Docker ignore rules include common service-account/credentials filenames as a safeguard, but keep keys outside the repository regardless of filename.

Docker Compose remains a local fallback test by default: it does not automatically load backend/.env or mount a Google key. Use native local Node for the credentialed test, or explicitly supply backend environment settings and a read-only external secret mount in a private, untracked Compose override if you manage your own Docker credential setup.

## 6. Compare Google with Tesseract on identical bytes

1. Set `VITE_SCANNER_DEBUG=true` in **frontend/.env**, then restart `npm.cmd run dev`.
2. Open `/scan` with the camera stopped. Expand **Development: compare OCR engines**.
3. Choose one PNG/JPEG (up to 12 MiB), preferably a corrected image or the same photographed page used in your quality test.
4. Click **Compare this image**. The component sends that image once to Google and also runs Tesseract on the identical bytes. It does not change the scan store or your edited text.
5. Compare the two displayed texts against the source. Each explicit comparison is a new Google request; it bypasses the normal fallback-only policy so you can test both engines deliberately.

Only one comparison image is retained while processing; it is released afterward. Navigating away aborts its upload and terminates its browser OCR worker. The component is gated by development mode and the debug setting; production never runs both providers for comparison. Production does not retain completed images for later comparison.

## 7. Costs, quotas, and errors

Google bills Enterprise Document OCR by processed pages. JPEG/PNG images count as one page each. The pricing page currently lists a base tier of **$1.50 per 1,000 pages** above the displayed initial free tier, with other tiers/discounts; check current eligibility and pricing in your billing account. No premium OCR add-ons or batch/Cloud Storage workflow are enabled. [Google pricing](https://cloud.google.com/products/document-ai/pricing).

Set a project billing budget with alerts and review Document AI quotas in **IAM & Admin -> Quotas & System Limits**, filtering for the Document AI API. Billing alerts are notifications, not hard spend caps. Quotas depend on region, processor/version and request type; inspect your project instead of assuming one universal request rate. [Google quotas](https://docs.cloud.google.com/document-ai/quotas).

BookLens has no authentication in this phase. Its public endpoint admits at most 30 OCR requests/minute and two uploads/Google operations at a time per backend process by default. Multiple instances have independent limits. These controls reduce bursts and memory use, but do not prevent every form of public-endpoint abuse or provide a guaranteed budget cap. Restrict usage operationally while evaluating the app and configure Google quota/billing monitoring before broad public use.

There is **no automatic paid Google retry**, and SDK retries are disabled. After a failed attempt, the browser falls back to Tesseract and pauses new cloud attempts for 60 seconds. A manual Retry or debug comparison can submit a new paid request; a timeout or browser cancellation does not prove Google stopped processing, so avoid repeatedly retrying a timed-out page.

| Symptom / response                         | Check                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status configured=false / 503              | Project ID, processor ID and location settings on the backend; restart/redeploy after changes                                                                                      |
| Status true but 503                        | Secret filename/path, valid JSON/key, service account IAM, API enabled, billing active, enabled processor and matching project/location; inspect Google/Render service diagnostics |
| 504                                        | Backend 45-second deadline; temporary Google/auth/network delay; fallback should run                                                                                               |
| 429                                        | BookLens concurrency/rate cap or provider availability; pause and retry later, inspect quotas                                                                                      |
| 413                                        | Image over 12 MiB; use a corrected image or reduce excessive size without sacrificing small text                                                                                   |
| 400 / 415                                  | Multipart field names, UUID pageId, PNG/JPEG MIME and actual image format                                                                                                          |
| Browser network/CORS error                 | Correct VITE_API_URL and Render FRONTEND_URL; service awake/reachable; redeploy frontend after API URL changes                                                                     |
| Local fallback after fixing cloud settings | Wait for the 60-second cooldown or reload after exporting your session; direct POST/debug comparison can test configuration immediately                                            |
| Both engines fail                          | Only that page becomes error; Retry if its bounded temporary image remains, otherwise rescan                                                                                       |

The API deliberately returns generic safe upstream errors instead of SDK messages that might contain sensitive details. Render logs show page ID, provider, duration, byte size and success/failure, without book text, image contents, or credentials. Cold Render starts add latency; camera capture still proceeds until the existing bounded queue is full.

Images travel from phone through Render to Google. BookLens holds them temporarily in memory and never writes OCR images to disk, Supabase, or Cloud Storage. Review [Google's data-security documentation](https://docs.cloud.google.com/document-ai/docs/security) when choosing a region and deciding which documents to scan.

## Next phase

Add optional AI OCR proofreading that compares OCR with the captured page image, corrects only likely transcription errors without paraphrasing, preserves raw OCR separately, and lets the user review/accept changes. This phase does not implement AI, Supabase, PDF, or Drive.
